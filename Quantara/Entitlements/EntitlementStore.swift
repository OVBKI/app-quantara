import Foundation
import Observation
import StoreKit

/// Fonctionnalités soumises à l'abonnement (§25).
///
/// Le contrôle passe toujours par ce type, jamais par un `if isPremium` disséminé dans
/// les vues : changer le périmètre du gratuit ne doit demander qu'une seule modification.
enum Feature: String, CaseIterable, Sendable {
    case advisorChat
    case budgetOptimization
    case savingsPlans
    case advancedSimulations
    case monthlyAnalysis
    case unlimitedGoals
    case investmentEducation
    case bankSync

    var localizationKey: String { "feature.\(rawValue)" }

    var isPremium: Bool {
        switch self {
        case .advisorChat, .budgetOptimization, .savingsPlans,
             .advancedSimulations, .monthlyAnalysis, .unlimitedGoals,
             .investmentEducation, .bankSync:
            return true
        }
    }
}

/// Limites de la version gratuite.
enum FreeTierLimits {
    static let maxGoals = 3
    static let historyMonths = 3
}

@MainActor
protocol EntitlementStore: AnyObject, Observable {
    var isPremium: Bool { get }
    var isLoading: Bool { get }
    func has(_ feature: Feature) -> Bool
    func refresh() async
    func purchase() async throws
    func restore() async throws
}

extension EntitlementStore {
    func has(_ feature: Feature) -> Bool {
        feature.isPremium ? isPremium : true
    }

    func canAddGoal(currentCount: Int) -> Bool {
        isPremium || currentCount < FreeTierLimits.maxGoals
    }
}

/// Implémentation StoreKit 2.
///
/// L'identifiant de produit est déclaré ici ; la validation côté serveur reste à
/// brancher avant mise en production (une vérification purement locale est contournable).
@MainActor
@Observable
final class StoreKitEntitlementStore: EntitlementStore {

    static let subscriptionGroupID = "quantara.premium"
    static let monthlyProductID = "app.quantara.premium.monthly"
    static let yearlyProductID = "app.quantara.premium.yearly"

    private(set) var isPremium: Bool = false
    private(set) var isLoading: Bool = false
    private(set) var products: [Product] = []
    private var updatesTask: Task<Void, Never>?

    init() {
        // L'écoute des transactions doit démarrer immédiatement : une transaction
        // approuvée hors de l'app (Ask to Buy, remboursement) arrive par ce canal.
        updatesTask = Task { [weak self] in
            for await update in StoreKit.Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                await transaction.finish()
                await self?.refresh()
            }
        }
    }

    deinit { updatesTask?.cancel() }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        var active = false
        for await result in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.revocationDate == nil,
               transaction.productID.hasPrefix("app.quantara.premium") {
                active = true
            }
        }
        isPremium = active

        products = (try? await Product.products(
            for: [Self.monthlyProductID, Self.yearlyProductID]
        )) ?? []
    }

    func purchase() async throws {
        guard let product = products.first(where: { $0.id == Self.yearlyProductID })
            ?? products.first else { return }
        let result = try await product.purchase()
        if case .success(.verified(let transaction)) = result {
            await transaction.finish()
            await refresh()
        }
    }

    func restore() async throws {
        try await AppStore.sync()
        await refresh()
    }
}

/// Implémentation de test et d'aperçu.
@MainActor
@Observable
final class PreviewEntitlementStore: EntitlementStore {
    var isPremium: Bool
    var isLoading: Bool = false

    init(isPremium: Bool = true) {
        self.isPremium = isPremium
    }

    func refresh() async {}
    func purchase() async throws { isPremium = true }
    func restore() async throws {}
}
