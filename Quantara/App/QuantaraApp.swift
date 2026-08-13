import SwiftUI
import SwiftData
import QuantaraCore

@main
struct QuantaraApp: App {

    @State private var environment: AppEnvironment?
    @Environment(\.scenePhase) private var scenePhase

    private let container: ModelContainer

    init() {
        let schema = Schema([
            SDAccount.self,
            SDIncomeSource.self,
            SDRecurringExpense.self,
            SDTransaction.self,
            SDDebt.self,
            SDGoal.self,
            SDCategoryBudget.self,
            SDCategorizationRule.self,
            SDChatMessage.self,
            SDUserSettings.self
        ])

        // Synchronisation multi-appareils activée : le schéma respecte déjà les
        // contraintes CloudKit (attributs optionnels ou avec valeur par défaut,
        // aucune contrainte d'unicité).
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            cloudKitDatabase: .automatic
        )

        do {
            container = try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            // Un magasin illisible ne doit pas boucler sur un écran d'erreur : on
            // repart en mémoire pour que l'app reste utilisable, et on le signale.
            assertionFailure("Magasin SwiftData indisponible : \(error)")
            container = try! ModelContainer(
                for: schema,
                configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)]
            )
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let environment {
                    RootView()
                        .environment(environment)
                        .environment(environment.store)
                } else {
                    ProgressView()
                        .task { setUpEnvironment() }
                }
            }
        }
        .modelContainer(container)
        .onChange(of: scenePhase) { _, phase in
            guard let environment else { return }
            switch phase {
            case .background: environment.lock.applicationDidEnterBackground()
            case .active:     environment.lock.applicationWillEnterForeground()
            default:          break
            }
        }
    }

    @MainActor
    private func setUpEnvironment() {
        guard environment == nil else { return }
        let store = DataStore(context: container.mainContext)
        environment = AppEnvironment(store: store)
    }
}
