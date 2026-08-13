import SwiftUI
import UIKit
import QuantaraCore

struct SettingsView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(DataStore.self) private var store

    @State private var isShowingPINSetup = false
    @State private var isShowingDeleteConfirmation = false
    @State private var isShowingSecondConfirmation = false
    @State private var isShowingPaywall = false

    var body: some View {
        List {
            premiumSection
            securitySection
            privacySection
            preferencesSection
            notificationsSection
            dataSection
            legalSection
        }
        .navigationTitle("tab.settings")
        .sheet(isPresented: $isShowingPINSetup) { PINSetupView() }
        .sheet(isPresented: $isShowingPaywall) { PaywallView() }
        .alert("settings.deleteAll.title", isPresented: $isShowingDeleteConfirmation) {
            Button("action.cancel", role: .cancel) {}
            Button("action.continue", role: .destructive) { isShowingSecondConfirmation = true }
        } message: {
            Text("settings.deleteAll.message")
        }
        // Double confirmation : l'effacement est irréversible et emporte la sauvegarde
        // iCloud. Un seul geste ne suffit pas.
        .alert("settings.deleteAll.confirm", isPresented: $isShowingSecondConfirmation) {
            Button("action.cancel", role: .cancel) {}
            Button("settings.deleteAll.action", role: .destructive) {
                store.deleteAllData()
                KeychainStore.deleteAll()
            }
        } message: {
            Text("settings.deleteAll.confirmMessage")
        }
    }

    // MARK: Abonnement

    private var premiumSection: some View {
        Section {
            if environment.entitlements.isPremium {
                Label("settings.premium.active", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(Theme.Palette.positive)
            } else {
                Button {
                    isShowingPaywall = true
                } label: {
                    Label("settings.premium.upgrade", systemImage: "sparkles")
                }
            }
            Button("settings.premium.restore") {
                Task { try? await environment.entitlements.restore() }
            }
            .font(.subheadline)
        } header: {
            Text("settings.section.subscription")
        }
    }

    // MARK: Sécurité

    private var securitySection: some View {
        Section {
            Toggle(
                "settings.appLock",
                isOn: Binding(
                    get: { store.settings.isAppLockEnabled },
                    set: { newValue in
                        store.updateSettings { $0.isAppLockEnabled = newValue }
                        environment.lock.configure(
                            isEnabled: newValue,
                            autoLockMinutes: store.settings.autoLockMinutes
                        )
                    }
                )
            )

            if store.settings.isAppLockEnabled {
                Picker(
                    "settings.autoLock",
                    selection: Binding(
                        get: { store.settings.autoLockMinutes },
                        set: { newValue in
                            store.updateSettings { $0.autoLockMinutes = newValue }
                            environment.lock.configure(isEnabled: true, autoLockMinutes: newValue)
                        }
                    )
                ) {
                    Text("settings.autoLock.immediate").tag(0)
                    Text("settings.autoLock.1").tag(1)
                    Text("settings.autoLock.5").tag(5)
                    Text("settings.autoLock.15").tag(15)
                }

                Button(environment.lock.hasPIN ? "settings.changePIN" : "settings.setPIN") {
                    isShowingPINSetup = true
                }
            }
        } header: {
            Text("settings.section.security")
        } footer: {
            Text("settings.security.footer")
        }
    }

    // MARK: Confidentialité

    /// Le cœur du dispositif RGPD : trois niveaux explicites, avec la description de ce
    /// qui sort réellement de l'appareil dans chaque cas.
    private var privacySection: some View {
        Section {
            Picker(
                "settings.advisorPrivacy",
                selection: Binding(
                    get: { store.settings.advisorPrivacy },
                    set: { newValue in
                        store.updateSettings { $0.advisorPrivacyRaw = newValue.rawValue }
                    }
                )
            ) {
                ForEach(AdvisorPrivacyLevel.allCases, id: \.self) { level in
                    Text(level.localizedName).tag(level)
                }
            }
            .pickerStyle(.inline)

            Text(privacyExplanation)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Toggle(
                "settings.allowTraining",
                isOn: Binding(
                    get: { store.settings.allowsModelTraining },
                    set: { newValue in
                        store.updateSettings { $0.allowsModelTraining = newValue }
                    }
                )
            )
            .disabled(store.settings.advisorPrivacy == .localOnly)
        } header: {
            Text("settings.section.privacy")
        } footer: {
            Text("settings.privacy.footer")
        }
    }

    private var privacyExplanation: LocalizedStringKey {
        switch store.settings.advisorPrivacy {
        case .localOnly:  return "settings.privacy.localOnly.detail"
        case .aggregated: return "settings.privacy.aggregated.detail"
        case .detailed:   return "settings.privacy.detailed.detail"
        }
    }

    // MARK: Préférences

    private var preferencesSection: some View {
        Section {
            Picker(
                "settings.currency",
                selection: Binding(
                    get: { store.settings.currency },
                    set: { newValue in store.updateSettings { $0.currencyRaw = newValue.rawValue } }
                )
            ) {
                ForEach(Currency.allCases) { currency in
                    Text("\(currency.rawValue) \(currency.symbol)").tag(currency)
                }
            }

            Picker(
                "settings.emergencyMonths",
                selection: Binding(
                    get: { store.settings.emergencyFundMonths },
                    set: { newValue in store.updateSettings { $0.emergencyFundMonths = newValue } }
                )
            ) {
                ForEach(EmergencyFundEngine.tierOptions, id: \.self) { months in
                    Text(String(format: String(localized: "settings.months"), months)).tag(months)
                }
            }

            Picker(
                "settings.riskProfile",
                selection: Binding(
                    get: { store.settings.riskProfile },
                    set: { newValue in store.updateSettings { $0.riskProfileRaw = newValue.rawValue } }
                )
            ) {
                ForEach(RiskProfile.allCases) { profile in
                    Text(profile.localizedName).tag(profile)
                }
            }

            Toggle(
                "settings.irregularIncome",
                isOn: Binding(
                    get: { store.settings.usesIrregularIncomeSmoothing },
                    set: { newValue in
                        store.updateSettings { $0.usesIrregularIncomeSmoothing = newValue }
                    }
                )
            )
        } header: {
            Text("settings.section.preferences")
        } footer: {
            Text("settings.irregularIncome.footer")
        }
    }

    // MARK: Notifications

    private var notificationsSection: some View {
        Section {
            Toggle(
                "settings.notifications",
                isOn: Binding(
                    get: { store.settings.notificationsEnabled },
                    set: { newValue in
                        store.updateSettings { $0.notificationsEnabled = newValue }
                        Task {
                            if newValue { _ = await environment.notifications.requestAuthorization() }
                            await environment.refreshNotifications()
                        }
                    }
                )
            )

            if store.settings.notificationsEnabled {
                toggle("settings.notify.debits", keyPath: \.notifyUpcomingDebits)
                toggle("settings.notify.overrun", keyPath: \.notifyBudgetOverrun)
                toggle("settings.notify.goals", keyPath: \.notifyGoalMilestones)
                toggle("settings.notify.report", keyPath: \.notifyMonthlyReport)
            }
        } header: {
            Text("settings.section.notifications")
        }
    }

    private func toggle(
        _ title: LocalizedStringKey,
        keyPath: ReferenceWritableKeyPath<SDUserSettings, Bool>
    ) -> some View {
        Toggle(
            title,
            isOn: Binding(
                get: { store.settings[keyPath: keyPath] },
                set: { newValue in
                    store.updateSettings { $0[keyPath: keyPath] = newValue }
                    Task { await environment.refreshNotifications() }
                }
            )
        )
    }

    // MARK: Données

    private var dataSection: some View {
        Section {
            NavigationLink { SimulationView() } label: {
                Label("simulation.title", systemImage: "chart.xyaxis.line")
            }

            Button {
                exportCSV()
            } label: {
                Label("settings.exportCSV", systemImage: "square.and.arrow.up")
            }

            Button {
                exportJSON()
            } label: {
                Label("settings.exportJSON", systemImage: "doc.badge.arrow.up")
            }

            Button(role: .destructive) {
                isShowingDeleteConfirmation = true
            } label: {
                Label("settings.deleteAll", systemImage: "trash")
            }
        } header: {
            Text("settings.section.data")
        } footer: {
            Text("settings.data.footer")
        }
    }

    private var legalSection: some View {
        Section {
            NavigationLink("settings.legal.privacy") { LegalTextView(kind: .privacy) }
            NavigationLink("settings.legal.terms") { LegalTextView(kind: .terms) }
            NavigationLink("settings.legal.investment") { LegalTextView(kind: .investment) }
            LabeledContent("settings.version", value: appVersion)
        } header: {
            Text("settings.section.legal")
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    // MARK: Export

    /// Export CSV des transactions (portabilité, RGPD art. 20).
    private func exportCSV() {
        var rows = ["date;libelle;categorie;type;montant"]
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        for transaction in store.profile.transactions {
            let fields = [
                formatter.string(from: transaction.date),
                transaction.label.replacingOccurrences(of: ";", with: ","),
                transaction.category?.id ?? "",
                transaction.kind.rawValue,
                "\(transaction.amount.amount)"
            ]
            rows.append(fields.joined(separator: ";"))
        }
        share(content: rows.joined(separator: "\n"), fileName: "quantara-transactions.csv")
    }

    /// Export JSON complet du profil (portabilité intégrale).
    private func exportJSON() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(store.profile) else { return }
        share(content: String(decoding: data, as: UTF8.self), fileName: "quantara-donnees.json")
    }

    private func share(content: String, fileName: String) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? content.write(to: url, atomically: true, encoding: .utf8)

        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.windows.first?.rootViewController
        else { return }
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        root.present(controller, animated: true)
    }
}

// MARK: - Configuration du code PIN

struct PINSetupView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss

    @State private var pin = ""
    @State private var confirmation = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("settings.pin.new", text: $pin)
                        .keyboardType(.numberPad)
                    SecureField("settings.pin.confirm", text: $confirmation)
                        .keyboardType(.numberPad)
                } footer: {
                    Text("settings.pin.footer")
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(Theme.Palette.critical)
                    }
                }
            }
            .navigationTitle("settings.setPIN")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(pin.count < 4)
                }
            }
        }
    }

    private func save() {
        guard pin == confirmation else {
            error = String(localized: "settings.pin.mismatch")
            return
        }
        environment.lock.setPIN(pin)
        dismiss()
    }
}

// MARK: - Textes légaux

struct LegalTextView: View {
    enum Kind { case privacy, terms, investment }
    let kind: Kind

    var body: some View {
        ScrollView {
            Text(text)
                .font(.subheadline)
                .padding(Theme.Spacing.medium)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: LocalizedStringKey {
        switch kind {
        case .privacy:    return "settings.legal.privacy"
        case .terms:      return "settings.legal.terms"
        case .investment: return "settings.legal.investment"
        }
    }

    private var text: LocalizedStringKey {
        switch kind {
        case .privacy:    return "legal.privacy.body"
        case .terms:      return "legal.terms.body"
        case .investment: return "legal.investment.body"
        }
    }
}
