import SwiftUI
import UIKit
import QuantaraCore

struct GoalsView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(DataStore.self) private var store

    @State private var isShowingEditor = false
    @State private var isShowingPaywall = false
    @State private var editingGoal: Goal?

    private var analysis: FinancialAnalysis { store.analysis }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    emergencyFundCard

                    if analysis.goalPlans.filter({ $0.goal.kind != .emergencyFund }).isEmpty {
                        EmptyStateView(
                            symbol: "target",
                            title: "goals.empty.title",
                            message: "goals.empty.message",
                            actionLabel: "goals.new",
                            action: { addGoal() }
                        )
                    } else {
                        ForEach(analysis.goalPlans.filter { $0.goal.kind != .emergencyFund }) { plan in
                            GoalCard(plan: plan) { editingGoal = plan.goal }
                        }
                    }
                }
                .padding(Theme.Spacing.medium)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("tab.goals")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { addGoal() } label: { Image(systemName: "plus") }
                        .accessibilityLabel("goals.new")
                }
            }
            .sheet(isPresented: $isShowingEditor) { GoalEditorView(goal: nil) }
            .sheet(item: $editingGoal) { goal in GoalEditorView(goal: goal) }
            .sheet(isPresented: $isShowingPaywall) { PaywallView() }
        }
    }

    private func addGoal() {
        let count = store.profile.activeGoals.count
        if environment.entitlements.canAddGoal(currentCount: count) {
            isShowingEditor = true
        } else {
            isShowingPaywall = true
        }
    }

    // MARK: Fonds d'urgence

    private var emergencyFundCard: some View {
        let plan = analysis.emergencyFund
        return VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(title: "goals.emergencyFund", subtitle: "goals.emergencyFund.subtitle")

            HStack(spacing: Theme.Spacing.large) {
                ProgressRing(
                    progress: plan.selectedTarget.isZero
                        ? 0
                        : plan.currentBalance.amount / plan.selectedTarget.amount,
                    tint: plan.hasMinimumBuffer ? Theme.Palette.savings : Theme.Palette.warning,
                    lineWidth: 12
                )
                .frame(width: 84, height: 84)

                VStack(alignment: .leading, spacing: 4) {
                    AmountText(amount: plan.currentBalance, style: .title3.weight(.semibold))
                    Text(
                        String(
                            format: String(localized: "goals.emergencyFund.coverage"),
                            coverageText(plan.monthsOfCoverage)
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }

            Divider()

            ForEach(plan.tiers) { tier in
                HStack {
                    Image(systemName: tier.isReached ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(tier.isReached ? Theme.Palette.positive : .tertiary)
                    Text(
                        String(
                            format: String(localized: "goals.emergencyFund.tier"),
                            tier.months
                        )
                    )
                    .font(.subheadline)
                    Spacer()
                    Text(tier.target.formatted())
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }

            if let required = plan.requiredMonthlyContribution, required.amount > 0 {
                Text(
                    String(
                        format: String(localized: "goals.emergencyFund.required"),
                        required.roundedToUnit.formatted(),
                        plan.selectedMonths
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }

    private func coverageText(_ months: Decimal) -> String {
        var rounded = Decimal()
        var mutable = months
        NSDecimalRound(&rounded, &mutable, 1, .plain)
        return rounded.formatted(.number.precision(.fractionLength(0...1)))
    }
}

// MARK: - Carte d'objectif

struct GoalCard: View {

    @Environment(DataStore.self) private var store
    let plan: GoalPlan
    var onEdit: () -> Void

    @State private var isShowingContribution = false
    @State private var contribution: Decimal = 0

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            HStack {
                Image(systemName: plan.goal.kind.symbolName)
                    .foregroundStyle(Theme.Palette.accent)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(plan.goal.name)
                        .font(.headline)
                    if let date = plan.goal.targetDate {
                        Text(date.formatted(.dateTime.month(.wide).year()))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button(action: onEdit) {
                    Image(systemName: "pencil.circle")
                }
                .accessibilityLabel("action.edit")
            }

            ProgressBar(progress: plan.progress, height: 12)

            HStack {
                metric("goals.current", plan.goal.currentAmount)
                Spacer()
                metric("goals.remaining", plan.remaining)
                Spacer()
                metric("goals.target", plan.goal.targetAmount)
            }

            if let required = plan.requiredMonthlyContribution {
                Divider()
                HStack {
                    Text("goals.recommendedMonthly")
                        .font(.subheadline)
                    Spacer()
                    AmountText(
                        amount: required.roundedToUnit,
                        style: .subheadline.weight(.semibold),
                        color: plan.isFeasible ? .primary : Theme.Palette.warning
                    )
                }
            }

            if let date = plan.projectedCompletionDate {
                HStack {
                    Text("goals.estimatedDate")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(date.formatted(.dateTime.month(.wide).year()))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            // Un objectif infaisable n'est pas un échec : on montre trois issues chiffrées
            // plutôt qu'un simple message d'alerte.
            if !plan.isFeasible, !plan.alternatives.isEmpty {
                alternativesSection
            }

            Button {
                isShowingContribution = true
            } label: {
                Label("goals.contribute", systemImage: "plus.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .cardStyle()
        .alert("goals.contribute", isPresented: $isShowingContribution) {
            TextField("field.amount", value: $contribution, format: .number)
                .keyboardType(.decimalPad)
            Button("action.cancel", role: .cancel) { contribution = 0 }
            Button("action.save") {
                guard contribution > 0 else { return }
                store.contribute(Money(contribution, store.profile.currency), to: plan.goal.id)
                contribution = 0
            }
        }
    }

    private var alternativesSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Divider()
            Label("goals.notFeasible", systemImage: "exclamationmark.triangle")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.Palette.warning)

            if let shortfall = plan.capacityShortfall {
                Text(
                    String(
                        format: String(localized: "goals.shortfall"),
                        shortfall.roundedToUnit.formatted()
                    )
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            ForEach(plan.alternatives) { alternative in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(describe(alternative))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func describe(_ alternative: GoalAlternative) -> String {
        switch alternative.kind {
        case .extendDeadline:
            return String(
                format: String(localized: "goals.alternative.extend"),
                alternative.monthlyContribution.roundedToUnit.formatted(),
                alternative.months
            )
        case .reduceTarget:
            return String(
                format: String(localized: "goals.alternative.reduce"),
                alternative.targetAmount.roundedToUnit.formatted(),
                alternative.months
            )
        case .increaseCapacity:
            return String(
                format: String(localized: "goals.alternative.effort"),
                alternative.additionalMonthlyEffort.roundedToUnit.formatted()
            )
        }
    }

    private func metric(_ title: LocalizedStringKey, _ amount: Money) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(amount.formattedCompact())
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Édition d'objectif

struct GoalEditorView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let goal: Goal?

    @State private var name: String = ""
    @State private var kind: GoalKind = .vacation
    @State private var targetAmount: Decimal = 0
    @State private var currentAmount: Decimal = 0
    @State private var hasTargetDate: Bool = true
    @State private var targetDate: Date = Calendar.current.date(byAdding: .month, value: 12, to: Date()) ?? Date()
    @State private var priority: Int = 3

    private var previewPlan: GoalPlan? {
        guard targetAmount > 0 else { return nil }
        let candidate = Goal(
            kind: kind,
            name: name.isEmpty ? kind.localizedName : name,
            targetAmount: Money(targetAmount, store.profile.currency),
            currentAmount: Money(currentAmount, store.profile.currency),
            targetDate: hasTargetDate ? targetDate : nil,
            priority: priority
        )
        return GoalEngine.plan(
            for: candidate,
            capacity: store.analysis.savingsCapacity,
            referenceDate: store.referenceDate
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("field.goalKind", selection: $kind) {
                        ForEach(GoalKind.allCases) { value in
                            Label(value.localizedName, systemImage: value.symbolName).tag(value)
                        }
                    }
                    TextField("field.name", text: $name)
                    AmountField(title: "field.targetAmount", amount: $targetAmount, currency: store.profile.currency)
                    AmountField(title: "field.currentAmount", amount: $currentAmount, currency: store.profile.currency)
                }

                Section {
                    Toggle("field.hasTargetDate", isOn: $hasTargetDate)
                    if hasTargetDate {
                        DatePicker("field.targetDate", selection: $targetDate, displayedComponents: .date)
                    }
                    Picker("field.priority", selection: $priority) {
                        ForEach(1...5, id: \.self) { Text("\($0)").tag($0) }
                    }
                }

                // Test de faisabilité immédiat : découvrir après coup qu'un objectif est
                // hors de portée décourage bien plus que de le savoir tout de suite.
                if let previewPlan {
                    Section {
                        if let required = previewPlan.requiredMonthlyContribution {
                            LabeledContent(
                                "goals.recommendedMonthly",
                                value: required.roundedToUnit.formatted()
                            )
                        }
                        LabeledContent(
                            "goals.yourCapacity",
                            value: store.analysis.savingsCapacity.roundedToUnit.formatted()
                        )
                        Label(
                            previewPlan.isFeasible ? "goals.feasible" : "goals.notFeasible",
                            systemImage: previewPlan.isFeasible ? "checkmark.circle" : "exclamationmark.triangle"
                        )
                        .foregroundStyle(previewPlan.isFeasible ? Theme.Palette.positive : Theme.Palette.warning)
                    } header: {
                        Text("goals.feasibility")
                    }
                }

                if let goal {
                    Section {
                        Button("action.delete", role: .destructive) {
                            store.deleteGoal(id: goal.id)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(goal == nil ? "goals.new" : "goals.edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(targetAmount <= 0)
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let goal else { return }
        name = goal.name
        kind = goal.kind
        targetAmount = goal.targetAmount.amount
        currentAmount = goal.currentAmount.amount
        priority = goal.priority
        if let date = goal.targetDate {
            hasTargetDate = true
            targetDate = date
        } else {
            hasTargetDate = false
        }
    }

    private func save() {
        let value = Goal(
            id: goal?.id ?? UUID(),
            kind: kind,
            name: name.isEmpty ? kind.localizedName : name,
            targetAmount: Money(targetAmount, store.profile.currency),
            currentAmount: Money(currentAmount, store.profile.currency),
            targetDate: hasTargetDate ? targetDate : nil,
            priority: priority,
            createdAt: goal?.createdAt ?? Date()
        )
        if goal == nil { store.add(value) } else { store.update(value) }
        dismiss()
    }
}
