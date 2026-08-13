import Foundation
import SwiftUI
import SwiftData
import Observation
import QuantaraCore

/// Conteneur d'injection de dépendances.
///
/// Tous les services sont derrière un protocole : les vues restent testables, et les
/// implémentations différées (connexion bancaire, autre plateforme) se branchent sans
/// toucher à l'interface.
@MainActor
@Observable
final class AppEnvironment {

    let store: DataStore
    let lock: AppLockManager
    let entitlements: any EntitlementStore
    let notifications: any NotificationScheduling

    /// Conseiller courant. Recalculé à chaque changement du niveau de confidentialité :
    /// en mode « local uniquement », aucun objet capable d'émettre une requête réseau
    /// n'est même instancié.
    var advisor: any AdvisorService {
        switch store.settings.advisorPrivacy {
        case .localOnly:
            return LocalAdvisor(locale: locale)
        case .aggregated, .detailed:
            guard let client = makeClient() else { return LocalAdvisor(locale: locale) }
            return ClaudeAdvisor(client: client, privacy: store.settings.advisorPrivacy)
        }
    }

    var locale: Locale { .current }

    /// URL du relais Quantara, lue dans `Info.plist` afin de différer par configuration
    /// (développement, recette, production) sans recompiler le code.
    private var proxyBaseURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "QuantaraAdvisorProxyURL") as? String,
              !raw.isEmpty
        else { return nil }
        return URL(string: raw)
    }

    init(
        store: DataStore,
        lock: AppLockManager = AppLockManager(),
        entitlements: any EntitlementStore = StoreKitEntitlementStore(),
        notifications: any NotificationScheduling = NotificationScheduler()
    ) {
        self.store = store
        self.lock = lock
        self.entitlements = entitlements
        self.notifications = notifications

        lock.configure(
            isEnabled: store.settings.isAppLockEnabled,
            autoLockMinutes: store.settings.autoLockMinutes
        )
    }

    private func makeClient() -> AnthropicClient? {
        if let proxyBaseURL {
            return AnthropicClient(
                endpointProvider: ProxyEndpointProvider(baseURL: proxyBaseURL) {
                    guard let token = KeychainStore.string(for: .advisorDeviceToken) else {
                        throw AdvisorError.notConfigured
                    }
                    return token
                }
            )
        }
        #if DEBUG
        // Repli de développement : clé lue dans le Trousseau, jamais dans le dépôt.
        if KeychainStore.string(for: .developmentAPIKey) != nil {
            return AnthropicClient(
                endpointProvider: DirectAnthropicEndpointProvider {
                    guard let key = KeychainStore.string(for: .developmentAPIKey) else {
                        throw AdvisorError.notConfigured
                    }
                    return key
                }
            )
        }
        #endif
        return nil
    }

    /// Vrai si un conseiller en ligne est réellement joignable. Permet à l'interface de
    /// ne pas proposer une fonctionnalité qui échouerait.
    var isRemoteAdvisorAvailable: Bool {
        guard store.settings.advisorPrivacy.allowsNetwork else { return false }
        return makeClient() != nil
    }

    func refreshNotifications() async {
        let settings = store.settings
        guard settings.notificationsEnabled else {
            await notifications.cancelAll()
            return
        }
        await notifications.refreshSchedule(
            analysis: store.analysis,
            settings: NotificationPreferences(
                upcomingDebits: settings.notifyUpcomingDebits,
                budgetOverrun: settings.notifyBudgetOverrun,
                goalMilestones: settings.notifyGoalMilestones,
                monthlyReport: settings.notifyMonthlyReport
            )
        )
    }
}
