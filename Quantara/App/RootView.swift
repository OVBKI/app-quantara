import SwiftUI
import QuantaraCore

struct RootView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(DataStore.self) private var store
    @State private var selectedTab: Tab = .home
    @State private var isShowingQuickAdd = false

    enum Tab: Hashable {
        case home, budget, transactions, goals, advisor
    }

    var body: some View {
        ZStack {
            if !store.settings.hasCompletedOnboarding {
                OnboardingView()
                    .transition(.opacity)
            } else {
                mainInterface
            }

            // Écran de verrouillage par-dessus tout le reste : il ne doit exister aucun
            // chemin d'affichage des données avant authentification.
            if environment.lock.state != .unlocked {
                LockScreenView()
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: store.settings.hasCompletedOnboarding)
        .animation(.easeInOut(duration: 0.2), value: environment.lock.state)
        .task {
            await environment.entitlements.refresh()
            await environment.refreshNotifications()
        }
    }

    private var mainInterface: some View {
        TabView(selection: $selectedTab) {
            HomeView(onQuickAdd: { isShowingQuickAdd = true })
                .tabItem { Label("tab.home", systemImage: "house.fill") }
                .tag(Tab.home)

            BudgetView()
                .tabItem { Label("tab.budget", systemImage: "chart.pie.fill") }
                .tag(Tab.budget)

            TransactionsView()
                .tabItem { Label("tab.transactions", systemImage: "list.bullet.rectangle") }
                .tag(Tab.transactions)

            GoalsView()
                .tabItem { Label("tab.goals", systemImage: "target") }
                .tag(Tab.goals)

            AdvisorView()
                .tabItem { Label("tab.advisor", systemImage: "sparkles") }
                .tag(Tab.advisor)
        }
        .sheet(isPresented: $isShowingQuickAdd) {
            QuickAddTransactionView()
        }
    }
}

// MARK: - Écran de verrouillage

struct LockScreenView: View {

    @Environment(AppEnvironment.self) private var environment
    @State private var pin: String = ""
    @State private var isShowingPINEntry = false

    var body: some View {
        ZStack {
            // Fond opaque : le contenu ne doit pas transparaître, y compris dans le
            // sélecteur d'applications.
            Rectangle()
                .fill(.background)
                .ignoresSafeArea()

            VStack(spacing: Theme.Spacing.large) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(Theme.Palette.accent)

                Text("lock.title")
                    .font(.title2.weight(.semibold))

                Text("lock.subtitle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if isShowingPINEntry || !hasBiometry {
                    pinEntry
                } else {
                    Button {
                        Task { await environment.lock.authenticateWithBiometrics() }
                    } label: {
                        Label("lock.unlock", systemImage: biometrySymbol)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    if environment.lock.hasPIN {
                        Button("lock.usePIN") { isShowingPINEntry = true }
                            .font(.subheadline)
                    }
                }

                if let message = environment.lock.lastFailureMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(Theme.Palette.critical)
                }
            }
            .padding(Theme.Spacing.large)
            .frame(maxWidth: 380)
        }
        .task {
            guard hasBiometry, environment.lock.state == .locked else { return }
            await environment.lock.authenticateWithBiometrics()
        }
    }

    private var pinEntry: some View {
        VStack(spacing: Theme.Spacing.medium) {
            SecureField("lock.pinPlaceholder", text: $pin)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 200)

            Button("lock.validate") {
                if !environment.lock.verifyPIN(pin) { pin = "" }
            }
            .buttonStyle(.borderedProminent)
            .disabled(pin.count < 4)
        }
    }

    private var hasBiometry: Bool {
        environment.lock.biometryType != .none
    }

    private var biometrySymbol: String {
        switch environment.lock.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.open.fill"
        }
    }
}
