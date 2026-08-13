import Foundation
import QuantaraCore

/// Conseiller conversationnel adossé au modèle.
///
/// Le modèle n'effectue **aucun calcul** : il reçoit le pack de faits produit par
/// `QuantaraCore` et, pour toute question qui le dépasse, appelle un outil exécuté
/// localement par le même moteur. C'est ce qui rend les chiffres affichés vérifiables.
struct ClaudeAdvisor: AdvisorService {

    let client: AnthropicClient
    let privacy: AdvisorPrivacyLevel
    let languageCode: String

    /// Plafond de tours d'outils. Au-delà, le modèle tourne en rond : mieux vaut
    /// répondre avec ce qu'on a que boucler aux frais de l'utilisateur.
    private static let maxToolIterations = 6

    init(
        client: AnthropicClient,
        privacy: AdvisorPrivacyLevel,
        languageCode: String = Locale.current.language.languageCode?.identifier ?? "fr"
    ) {
        self.client = client
        self.privacy = privacy
        self.languageCode = languageCode
    }

    func respond(
        to question: String,
        analysis: FinancialAnalysis,
        history: [AdvisorMessage],
        task: AdvisorPrompt.Task
    ) -> AsyncThrowingStream<AdvisorChunk, Error> {

        AsyncThrowingStream { continuation in
            let work = Task {
                do {
                    guard privacy.allowsNetwork else {
                        throw AdvisorError.privacyDisallowsNetwork
                    }

                    let facts = FinancialFactsBuilder.build(from: analysis, privacy: privacy)
                    let factsJSON = try FinancialFactsBuilder.json(facts)
                    let system = AdvisorPrompt.system(task: task, languageCode: languageCode)
                    let runner = AdvisorToolRunner(analysis: analysis)

                    // Historique : seulement le texte. Les blocs de raisonnement des
                    // tours précédents ne sont pas rejoués — ils appartiennent à leur tour.
                    var messages: [[String: Any]] = history.suffix(10).map { message in
                        [
                            "role": message.isFromUser ? "user" : "assistant",
                            "content": message.text
                        ]
                    }
                    messages.append([
                        "role": "user",
                        "content": AdvisorPrompt.userMessage(factsJSON: factsJSON, question: question)
                    ])

                    var iteration = 0
                    while iteration < Self.maxToolIterations {
                        iteration += 1

                        let body = AnthropicClient.requestBody(
                            system: system,
                            messages: messages,
                            tools: AdvisorToolSchemas.all,
                            maxTokens: task == .chat ? 8_000 : 16_000,
                            effort: task == .chat ? "medium" : "high",
                            stream: true
                        )

                        let assembled = try await client.stream(body: body) { delta in
                            continuation.yield(.text(delta))
                        }

                        // Le refus est vérifié avant toute lecture du contenu : celui-ci
                        // peut être vide ou partiel.
                        if assembled.stopReason == "refusal" {
                            throw AdvisorError.refused(category: assembled.refusalCategory)
                        }

                        guard assembled.stopReason == "tool_use", !assembled.toolUses.isEmpty else {
                            continuation.yield(.done)
                            continuation.finish()
                            return
                        }

                        // Le tour assistant est renvoyé tel quel, blocs de raisonnement
                        // compris : les modifier invaliderait leur signature.
                        messages.append([
                            "role": "assistant",
                            "content": assembled.contentBlocks
                        ])

                        // Tous les résultats d'outils repartent dans un **seul** message
                        // utilisateur : les répartir sur plusieurs tours apprend au modèle
                        // à ne plus paralléliser ses appels.
                        var results: [[String: Any]] = []
                        for use in assembled.toolUses {
                            continuation.yield(.toolInProgress(use.name))
                            let output = runner.run(tool: use.name, input: use.input)
                            results.append([
                                "type": "tool_result",
                                "tool_use_id": use.id,
                                "content": output
                            ])
                        }
                        messages.append(["role": "user", "content": results])
                    }

                    // Plafond atteint : on termine proprement plutôt que de boucler.
                    continuation.yield(.done)
                    continuation.finish()

                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in work.cancel() }
        }
    }
}
