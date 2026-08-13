import Foundation

/// Point d'accès au modèle.
///
/// Deux fournisseurs possibles : le relais Quantara (production) et l'appel direct
/// (développement). Une clé d'API embarquée dans un binaire iOS est extractible en
/// quelques minutes : en production, la clé reste côté serveur.
protocol AdvisorEndpointProvider: Sendable {
    func endpoint() async throws -> AdvisorEndpoint
}

struct AdvisorEndpoint: Sendable {
    let url: URL
    let headers: [String: String]
}

/// Relais Quantara : détient la clé d'API, authentifie l'appareil, applique les quotas
/// du modèle freemium, et permet de changer de modèle sans publier une mise à jour.
struct ProxyEndpointProvider: AdvisorEndpointProvider {
    let baseURL: URL
    /// Jeton d'appareil, stocké dans le Trousseau. Ce n'est pas une clé d'API : il ne
    /// donne accès qu'au relais, avec le quota de cet utilisateur.
    let deviceTokenProvider: @Sendable () async throws -> String

    func endpoint() async throws -> AdvisorEndpoint {
        let token = try await deviceTokenProvider()
        return AdvisorEndpoint(
            url: baseURL.appendingPathComponent("v1/advisor/messages"),
            headers: [
                "content-type": "application/json",
                "authorization": "Bearer \(token)"
            ]
        )
    }
}

#if DEBUG
/// Appel direct à l'API, **développement uniquement**.
/// La clé est lue dans le Trousseau et n'est jamais écrite dans le dépôt.
struct DirectAnthropicEndpointProvider: AdvisorEndpointProvider {
    let apiKeyProvider: @Sendable () async throws -> String

    func endpoint() async throws -> AdvisorEndpoint {
        let key = try await apiKeyProvider()
        return AdvisorEndpoint(
            url: URL(string: "https://api.anthropic.com/v1/messages")!,
            headers: [
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01"
            ]
        )
    }
}
#endif

// MARK: - Réponse assemblée

/// Message assistant reconstitué à partir du flux SSE.
///
/// `@unchecked Sendable` assumé : les blocs sont des dictionnaires issus de JSON, donc
/// des types valeur immuables (chaînes, nombres, booléens, tableaux, dictionnaires).
/// Le vérificateur ne peut pas le prouver à travers `Any`, mais rien de mutable ni de
/// référencé ne transite ici.
struct AssembledMessage: @unchecked Sendable {
    /// Blocs de contenu, conservés tels que reçus. Ils sont renvoyés **inchangés** au
    /// tour suivant : modifier un bloc de raisonnement invalide sa signature.
    let contentBlocks: [[String: Any]]
    let stopReason: String?
    let refusalCategory: String?

    var textOutput: String {
        contentBlocks
            .filter { $0["type"] as? String == "text" }
            .compactMap { $0["text"] as? String }
            .joined()
    }

    var toolUses: [(id: String, name: String, input: [String: Any])] {
        contentBlocks.compactMap { block in
            guard block["type"] as? String == "tool_use",
                  let id = block["id"] as? String,
                  let name = block["name"] as? String
            else { return nil }
            return (id, name, block["input"] as? [String: Any] ?? [:])
        }
    }
}

// MARK: - Client

/// Client HTTP minimal pour l'API Messages.
///
/// Écrit à la main plutôt qu'adossé à un SDK : il n'existe pas de SDK Anthropic officiel
/// pour Swift, et l'appel passe de toute façon par le relais Quantara en production.
struct AnthropicClient: Sendable {

    static let model = "claude-opus-5"

    let endpointProvider: any AdvisorEndpointProvider
    let session: URLSession

    init(endpointProvider: any AdvisorEndpointProvider, session: URLSession = .shared) {
        self.endpointProvider = endpointProvider
        self.session = session
    }

    /// Corps de requête.
    ///
    /// Notes d'implémentation :
    /// - La réflexion adaptative est active par défaut sur ce modèle : on ne passe pas
    ///   de paramètre `thinking`.
    /// - `max_tokens` plafonne la réflexion **et** la réponse : le laisser trop bas
    ///   tronque la réponse au milieu d'une phrase.
    /// - Un point de césure de cache est posé sur le bloc système, qui est invariant.
    static func requestBody(
        system: String,
        messages: [[String: Any]],
        tools: [[String: Any]],
        maxTokens: Int,
        effort: String,
        stream: Bool
    ) -> [String: Any] {
        var body: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "system": [
                [
                    "type": "text",
                    "text": system,
                    "cache_control": ["type": "ephemeral"]
                ]
            ],
            "messages": messages,
            "output_config": ["effort": effort]
        ]
        if !tools.isEmpty { body["tools"] = tools }
        if stream { body["stream"] = true }
        return body
    }

    /// Envoie une requête en streaming et restitue les fragments de texte au fur et à
    /// mesure, tout en assemblant le message complet pour la boucle d'outils.
    func stream(
        body: [String: Any],
        onTextDelta: @escaping @Sendable (String) -> Void
    ) async throws -> AssembledMessage {

        let endpoint = try await endpointProvider.endpoint()
        var request = URLRequest(url: endpoint.url)
        request.httpMethod = "POST"
        for (key, value) in endpoint.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 120

        let (bytes, response) = try await session.bytes(for: request)

        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            if http.statusCode == 429 {
                let retryAfter = (http.value(forHTTPHeaderField: "retry-after")).flatMap(Int.init)
                throw AdvisorError.rateLimited(retryAfter: retryAfter)
            }
            throw AdvisorError.transport("HTTP \(http.statusCode)")
        }

        var accumulator = StreamAccumulator()
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard !payload.isEmpty, payload != "[DONE]" else { continue }
            guard let data = payload.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }

            if let text = accumulator.consume(event) {
                onTextDelta(text)
            }
        }

        return accumulator.finish()
    }
}

// MARK: - Assemblage du flux

/// Reconstruit le message assistant à partir des événements SSE.
///
/// Les blocs sont conservés dans leur forme d'origine : ils doivent être renvoyés
/// inchangés au tour suivant de la boucle d'outils.
struct StreamAccumulator {

    private var blocks: [Int: [String: Any]] = [:]
    /// JSON partiel des entrées d'outil, accumulé fragment par fragment.
    private var partialToolInput: [Int: String] = [:]
    private var stopReason: String?
    private var refusalCategory: String?

    /// Traite un événement et renvoie le fragment de texte à afficher, s'il y en a un.
    mutating func consume(_ event: [String: Any]) -> String? {
        guard let type = event["type"] as? String else { return nil }

        switch type {
        case "content_block_start":
            guard let index = event["index"] as? Int,
                  let block = event["content_block"] as? [String: Any]
            else { return nil }
            blocks[index] = block
            if block["type"] as? String == "tool_use" { partialToolInput[index] = "" }
            return nil

        case "content_block_delta":
            guard let index = event["index"] as? Int,
                  let delta = event["delta"] as? [String: Any],
                  let deltaType = delta["type"] as? String
            else { return nil }

            switch deltaType {
            case "text_delta":
                guard let text = delta["text"] as? String else { return nil }
                let existing = blocks[index]?["text"] as? String ?? ""
                blocks[index]?["text"] = existing + text
                return text

            case "thinking_delta":
                guard let thinking = delta["thinking"] as? String else { return nil }
                let existing = blocks[index]?["thinking"] as? String ?? ""
                blocks[index]?["thinking"] = existing + thinking
                return nil

            case "signature_delta":
                // La signature authentifie le bloc de raisonnement : elle doit être
                // conservée telle quelle, sinon le tour suivant est rejeté.
                if let signature = delta["signature"] as? String {
                    blocks[index]?["signature"] = signature
                }
                return nil

            case "input_json_delta":
                guard let fragment = delta["partial_json"] as? String else { return nil }
                partialToolInput[index, default: ""] += fragment
                return nil

            default:
                return nil
            }

        case "content_block_stop":
            guard let index = event["index"] as? Int else { return nil }
            if let json = partialToolInput[index] {
                let parsed = (try? JSONSerialization.jsonObject(with: Data(json.utf8)))
                    as? [String: Any]
                blocks[index]?["input"] = parsed ?? [:]
                partialToolInput[index] = nil
            }
            return nil

        case "message_delta":
            if let delta = event["delta"] as? [String: Any] {
                stopReason = delta["stop_reason"] as? String
                if let details = delta["stop_details"] as? [String: Any] {
                    refusalCategory = details["category"] as? String
                }
            }
            return nil

        case "error":
            if let error = event["error"] as? [String: Any],
               let message = error["message"] as? String {
                blocks[Int.max] = ["type": "text", "text": message]
            }
            return nil

        default:
            return nil
        }
    }

    func finish() -> AssembledMessage {
        let ordered = blocks
            .sorted { $0.key < $1.key }
            .map(\.value)
            // Un bloc d'outil dont l'entrée n'a jamais été close est inexploitable :
            // le renvoyer produirait un appel d'outil vide.
            .filter { block in
                guard block["type"] as? String == "tool_use" else { return true }
                return block["input"] != nil
            }
        return AssembledMessage(
            contentBlocks: ordered,
            stopReason: stopReason,
            refusalCategory: refusalCategory
        )
    }
}
