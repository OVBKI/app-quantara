import Foundation
import QuantaraCore

struct AdvisorMessage: Identifiable, Hashable, Sendable {
    let id: UUID
    let isFromUser: Bool
    var text: String
    let date: Date

    init(id: UUID = UUID(), isFromUser: Bool, text: String, date: Date = Date()) {
        self.id = id
        self.isFromUser = isFromUser
        self.text = text
        self.date = date
    }
}

/// Fragment produit par le conseiller pendant sa réponse.
enum AdvisorChunk: Sendable {
    case text(String)
    /// Un outil de calcul est en cours d'exécution — affiché à l'utilisateur pour qu'un
    /// temps d'attente ne ressemble pas à un blocage.
    case toolInProgress(String)
    case done
}

enum AdvisorError: LocalizedError {
    case notConfigured
    case privacyDisallowsNetwork
    case refused(category: String?)
    case transport(String)
    case decoding(String)
    case rateLimited(retryAfter: Int?)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return String(localized: "advisor.error.notConfigured")
        case .privacyDisallowsNetwork:
            return String(localized: "advisor.error.privacy")
        case .refused:
            return String(localized: "advisor.error.refused")
        case .transport(let detail):
            return String(localized: "advisor.error.network") + " (\(detail))"
        case .decoding(let detail):
            return String(localized: "advisor.error.decoding") + " (\(detail))"
        case .rateLimited:
            return String(localized: "advisor.error.rateLimited")
        }
    }
}

/// Conseiller financier.
///
/// Deux implémentations : `LocalAdvisor` (déterministe, hors ligne, toujours disponible)
/// et `ClaudeAdvisor` (conversationnel, soumis au consentement de l'utilisateur).
/// L'interface est identique afin que l'application fonctionne pleinement sans réseau.
protocol AdvisorService: Sendable {
    func respond(
        to question: String,
        analysis: FinancialAnalysis,
        history: [AdvisorMessage],
        task: AdvisorPrompt.Task
    ) -> AsyncThrowingStream<AdvisorChunk, Error>
}

extension AdvisorService {
    func respond(
        to question: String,
        analysis: FinancialAnalysis,
        history: [AdvisorMessage] = []
    ) -> AsyncThrowingStream<AdvisorChunk, Error> {
        respond(to: question, analysis: analysis, history: history, task: .chat)
    }
}
