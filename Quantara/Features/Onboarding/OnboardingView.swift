import SwiftUI
import UIKit
import QuantaraCore

/// Parcours de première ouverture (§23).
///
/// Une question par écran, progression visible, chaque étape sautable. Un onboarding
/// qui exige tout d'un coup se solde par un abandon ; tout reste modifiable ensuite.
struct OnboardingView: View {

    @Environment(DataStore.self) private var store
    @State private var step: Step = .welcome

    enum Step: Int, CaseIterable {
        case welcome, income, fixedExpenses, variableExpenses, debts, savings, goals, risk, plan

        var progress: Double {
            Double(rawValue) / Double(Step.plan.rawValue)
        }
    }

    // Saisies du parcours
    @State private var incomeName = ""
    @State private var incomeAmount: Decimal = 0
    @State private var incomeFrequency: Frequency = .monthly
    @State private var fixedExpenses: [(name: String, amount: Decimal, category: FixedExpenseCategory)] = []
    @State private var variableEstimate: Decimal = 0
    @State private var hasDebts = false
    @State private var debtName = ""
    @State private var debtAmount: Decimal = 0
    @State private var debtRate: Decimal = 0
    @State private var debtPayment: Decimal = 0
    @State private var savingsBalance: Decimal = 0
    @State private var goalName = ""
    @State private var goalAmount: Decimal = 0
    @State private var goalMonths: Int = 12
    @State private var riskProfile: RiskProfile = .balanced

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if step != .welcome {
                    ProgressView(value: step.progress)
                        .padding(.horizontal, Theme.Spacing.medium)
                        .padding(.top, Theme.Spacing.small)
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Spacing.large) {
                        content
                    }
                    .padding(Theme.Spacing.large)
                }

                footer
            }
            .background(Color(.systemGroupedBackground))
            .animation(.easeInOut(duration: 0.25), value: step)
        }
    }

    // MARK: Contenu

    @ViewBuilder
    private var content: some View {
        switch step {
        case .welcome:          welcomeStep
        case .income:           incomeStep
        case .fixedExpenses:    fixedExpensesStep
        case .variableExpenses: variableStep
        case .debts:            debtsStep
        case .savings:          savingsStep
        case .goals:            goalsStep
        case .risk:             riskStep
        case .plan:             planStep
        }
    }

    private var welcomeStep: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            Image(systemName: "sparkles")
                .font(.system(size: 56))
                .foregroundStyle(Theme.Palette.accent)

            Text("onboarding.welcome.title")
                .font(.largeTitle.weight(.bold))

            Text("onboarding.welcome.message")
                .font(.body)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                bullet("lock.shield.fill", "onboarding.welcome.privacy")
                bullet("function", "onboarding.welcome.calculations")
                bullet("clock.arrow.circlepath", "onboarding.welcome.time")
            }
        }
    }

    private func bullet(_ symbol: String, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.small) {
            Image(systemName: symbol)
                .foregroundStyle(Theme.Palette.accent)
                .frame(width: 24)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var incomeStep: some View {
        stepLayout(title: "onboarding.income.title", subtitle: "onboarding.income.subtitle") {
            TextField("field.name", text: $incomeName)
                .textFieldStyle(.roundedBorder)
            AmountField(title: "field.amount", amount: $incomeAmount, currency: store.profile.currency)
            Picker("field.frequency", selection: $incomeFrequency) {
                ForEach(Frequency.allCases.filter(\.isRecurring)) { value in
                    Text(value.localizedName).tag(value)
                }
            }
            if incomeFrequency != .monthly, incomeAmount > 0 {
                Text(
                    String(
                        format: String(localized: "onboarding.income.equivalent"),
                        incomeFrequency
                            .monthlyEquivalent(of: Money(incomeAmount, store.profile.currency))
                            .rounded()
                            .formatted()
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var fixedExpensesStep: some View {
        stepLayout(title: "onboarding.fixed.title", subtitle: "onboarding.fixed.subtitle") {
            ForEach(Array(fixedExpenses.enumerated()), id: \.offset) { index, expense in
                HStack {
                    Text(expense.name.isEmpty ? expense.category.localizedName : expense.name)
                    Spacer()
                    Text(Money(expense.amount, store.profile.currency).formatted())
                        .monospacedDigit()
                    Button {
                        fixedExpenses.remove(at: index)
                    } label: {
                        Image(systemName: "minus.circle.fill").foregroundStyle(.secondary)
                    }
                }
                .font(.subheadline)
            }

            // Raccourcis sur les postes les plus fréquents : la saisie libre décourage.
            Text("onboarding.fixed.suggestions")
                .font(.caption)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110))], spacing: Theme.Spacing.small) {
                ForEach([FixedExpenseCategory.rent, .electricity, .internet, .phone,
                         .healthInsurance, .subscriptions], id: \.self) { category in
                    Button {
                        fixedExpenses.append((name: category.localizedName, amount: 0, category: category))
                    } label: {
                        Label(category.localizedName, systemImage: category.symbolName)
                            .font(.caption)
                            .lineLimit(1)
                    }
                    .buttonStyle(.bordered)
                }
            }

            ForEach(Array(fixedExpenses.enumerated()), id: \.offset) { index, _ in
                AmountField(
                    title: LocalizedStringKey(fixedExpenses[index].name),
                    amount: Binding(
                        get: { fixedExpenses[index].amount },
                        set: { fixedExpenses[index].amount = $0 }
                    ),
                    currency: store.profile.currency
                )
            }
        }
    }

    private var variableStep: some View {
        stepLayout(title: "onboarding.variable.title", subtitle: "onboarding.variable.subtitle") {
            AmountField(
                title: "onboarding.variable.field",
                amount: $variableEstimate,
                currency: store.profile.currency
            )
            Text("onboarding.variable.hint")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var debtsStep: some View {
        stepLayout(title: "onboarding.debts.title", subtitle: "onboarding.debts.subtitle") {
            Toggle("onboarding.debts.has", isOn: $hasDebts)
            if hasDebts {
                TextField("field.name", text: $debtName)
                    .textFieldStyle(.roundedBorder)
                AmountField(title: "field.outstanding", amount: $debtAmount, currency: store.profile.currency)
                HStack {
                    Text("field.annualRate")
                    Spacer()
                    TextField("0", value: $debtRate, format: .number)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                    Text("%")
                }
                AmountField(title: "field.monthlyPayment", amount: $debtPayment, currency: store.profile.currency)
            }
        }
    }

    private var savingsStep: some View {
        stepLayout(title: "onboarding.savings.title", subtitle: "onboarding.savings.subtitle") {
            AmountField(
                title: "onboarding.savings.field",
                amount: $savingsBalance,
                currency: store.profile.currency
            )
        }
    }

    private var goalsStep: some View {
        stepLayout(title: "onboarding.goals.title", subtitle: "onboarding.goals.subtitle") {
            TextField("field.name", text: $goalName)
                .textFieldStyle(.roundedBorder)
            AmountField(title: "field.targetAmount", amount: $goalAmount, currency: store.profile.currency)
            Stepper(
                String(format: String(localized: "onboarding.goals.months"), goalMonths),
                value: $goalMonths,
                in: 1...120
            )
            if goalAmount > 0, goalMonths > 0 {
                Text(
                    String(
                        format: String(localized: "onboarding.goals.monthly"),
                        Money(goalAmount / Decimal(goalMonths), store.profile.currency)
                            .roundedToUnit
                            .formatted()
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var riskStep: some View {
        stepLayout(title: "onboarding.risk.title", subtitle: "onboarding.risk.subtitle") {
            ForEach(RiskProfile.allCases) { profile in
                Button {
                    riskProfile = profile
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.localizedName)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(.primary)
                            Text(
                                String(
                                    format: String(localized: "onboarding.risk.horizon"),
                                    profile.minimumHorizonYears
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if riskProfile == profile {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Theme.Palette.accent)
                        }
                    }
                    .cardStyle(padding: Theme.Spacing.small)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Le plan est calculé sur les données saisies — pas un exemple générique.
    private var planStep: some View {
        let preview = previewAnalysis()
        return VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            Text("onboarding.plan.title")
                .font(.title.weight(.bold))

            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                planRow("budget.income", preview.summary.income)
                planRow("budget.expenses", preview.summary.totalExpenses)
                planRow("budget.disposable", preview.summary.disposable)
            }
            .cardStyle()

            if !preview.allocation.lines.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                    Text("onboarding.plan.allocation")
                        .font(.headline)
                    ForEach(preview.allocation.lines) { line in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: line.bucket.symbolName)
                                    .foregroundStyle(Theme.Palette.color(for: line.bucket))
                                Text(line.bucket.localizedName)
                                    .font(.subheadline.weight(.medium))
                                Spacer()
                                Text(line.amount.roundedToUnit.formatted())
                                    .font(.subheadline.weight(.semibold))
                                    .monospacedDigit()
                            }
                            Text(line.rationale)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 2)
                    }
                }
                .cardStyle()
            }

            Text("onboarding.plan.footer")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func planRow(_ title: LocalizedStringKey, _ amount: Money) -> some View {
        HStack {
            Text(title).font(.subheadline)
            Spacer()
            Text(amount.formatted())
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
    }

    // MARK: Mise en page

    @ViewBuilder
    private func stepLayout<Content: View>(
        title: LocalizedStringKey,
        subtitle: LocalizedStringKey,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                Text(title)
                    .font(.title2.weight(.bold))
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                content()
            }
            .cardStyle()
        }
    }

    private var footer: some View {
        HStack {
            if step != .welcome && step != .plan {
                Button("onboarding.skip") { advance() }
                    .font(.subheadline)
            }
            Spacer()
            Button(step == .plan ? "onboarding.start" : "onboarding.next") {
                if step == .plan { finish() } else { advance() }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(Theme.Spacing.medium)
        .background(.background)
    }

    private func advance() {
        guard let next = Step(rawValue: step.rawValue + 1) else { return }
        // Le plan est calculé sur ce qui a été saisi : on enregistre avant de l'afficher.
        if next == .plan { persist() }
        step = next
    }

    // MARK: Enregistrement

    private func persist() {
        let currency = store.profile.currency

        if incomeAmount > 0 {
            store.add(
                IncomeSource(
                    name: incomeName.isEmpty ? String(localized: "income.category.salary") : incomeName,
                    amount: Money(incomeAmount, currency),
                    frequency: incomeFrequency,
                    category: .salary
                )
            )
        }

        for expense in fixedExpenses where expense.amount > 0 {
            store.add(
                RecurringExpense(
                    name: expense.name,
                    amount: Money(expense.amount, currency),
                    frequency: .monthly,
                    category: expense.category,
                    isSubscription: expense.category == .subscriptions
                )
            )
        }

        if hasDebts, debtAmount > 0 {
            store.add(
                Debt(
                    name: debtName.isEmpty ? String(localized: "debt.kind.consumerLoan") : debtName,
                    outstandingPrincipal: Money(debtAmount, currency),
                    annualRate: debtRate / 100,
                    monthlyPayment: Money(debtPayment, currency)
                )
            )
        }

        if goalAmount > 0 {
            store.add(
                Goal(
                    name: goalName.isEmpty ? String(localized: "goal.kind.custom") : goalName,
                    targetAmount: Money(goalAmount, currency),
                    targetDate: Calendar.current.date(byAdding: .month, value: goalMonths, to: Date())
                )
            )
        }

        store.updateSettings { settings in
            settings.savingsBalance = savingsBalance
            settings.riskProfileRaw = riskProfile.rawValue
            settings.estimatedMonthlyVariableSpending = variableEstimate > 0 ? variableEstimate : nil
        }
    }

    private func previewAnalysis() -> FinancialAnalysis {
        store.analysis
    }

    private func finish() {
        store.updateSettings { $0.hasCompletedOnboarding = true }
    }
}
