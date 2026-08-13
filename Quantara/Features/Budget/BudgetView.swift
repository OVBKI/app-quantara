import SwiftUI
import UIKit
import Charts
import QuantaraCore

struct BudgetView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(DataStore.self) private var store

    @State private var isShowingIncomeEditor = false
    @State private var isShowingExpenseEditor = false
    @State private var editingIncome: IncomeSource?
    @State private var editingExpense: RecurringExpense?

    private var analysis: FinancialAnalysis { store.analysis }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    monthPicker
                    allocationCard
                    incomesCard
                    fixedExpensesCard
                    debtsCard
                    envelopesCard
                }
                .padding(Theme.Spacing.medium)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("tab.budget")
            .sheet(isPresented: $isShowingIncomeEditor) {
                IncomeEditorView(income: nil)
            }
            .sheet(item: $editingIncome) { income in
                IncomeEditorView(income: income)
            }
            .sheet(isPresented: $isShowingExpenseEditor) {
                RecurringExpenseEditorView(expense: nil)
            }
            .sheet(item: $editingExpense) { expense in
                RecurringExpenseEditorView(expense: expense)
            }
        }
    }

    // MARK: Sélection du mois

    private var monthPicker: some View {
        HStack {
            Button {
                store.selectedMonth = store.selectedMonth.previous
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("budget.previousMonth")

            Spacer()
            Text(store.selectedMonth.formatted())
                .font(.headline)
            Spacer()

            Button {
                store.selectedMonth = store.selectedMonth.next
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("budget.nextMonth")
            .disabled(store.selectedMonth >= YearMonth(date: store.referenceDate).next)
        }
        .cardStyle()
    }

    // MARK: Répartition proposée

    private var allocationCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(
                title: "budget.allocation",
                subtitle: "budget.allocation.subtitle"
            )

            if analysis.allocation.lines.isEmpty {
                Text("budget.allocation.empty")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(analysis.allocation.lines) { line in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Image(systemName: line.bucket.symbolName)
                                .foregroundStyle(Theme.Palette.color(for: line.bucket))
                            Text(line.bucket.localizedName)
                                .font(.subheadline.weight(.medium))
                            if let target = line.targetName {
                                Text("· \(target)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            AmountText(
                                amount: line.amount.roundedToUnit,
                                style: .subheadline.weight(.semibold)
                            )
                        }
                        // Le motif est affiché, pas seulement calculé : c'est ce qui
                        // distingue un conseil d'un chiffre imposé.
                        Text(line.rationale)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }

                if !analysis.allocation.skippedSteps.isEmpty {
                    Divider()
                    ForEach(analysis.allocation.skippedSteps, id: \.self) { reason in
                        Label(reason, systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .cardStyle()
    }

    // MARK: Revenus

    private var incomesCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            SectionHeader(
                title: "budget.incomes",
                subtitle: nil,
                action: { isShowingIncomeEditor = true },
                actionLabel: "action.add"
            )

            if store.profile.incomes.isEmpty {
                Text("budget.incomes.empty")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.profile.incomes) { income in
                    Button {
                        editingIncome = income
                    } label: {
                        HStack {
                            Image(systemName: income.category.symbolName)
                                .foregroundStyle(Theme.Palette.income)
                                .frame(width: 26)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(income.name)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                Text(income.frequency.localizedName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(income.amount.formatted())
                                    .font(.subheadline.weight(.medium))
                                    .monospacedDigit()
                                if income.frequency != .monthly {
                                    Text(
                                        String(
                                            format: String(localized: "budget.monthlyEquivalent"),
                                            income.monthlyEquivalent.rounded().formatted()
                                        )
                                    )
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }

                Divider()
                HStack {
                    Text("budget.totalMonthly").font(.subheadline.weight(.semibold))
                    Spacer()
                    AmountText(amount: analysis.summary.income, style: .subheadline.weight(.bold))
                }
            }
        }
        .cardStyle()
    }

    // MARK: Dépenses fixes

    private var fixedExpensesCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            SectionHeader(
                title: "budget.fixedExpenses",
                subtitle: nil,
                action: { isShowingExpenseEditor = true },
                actionLabel: "action.add"
            )

            if store.profile.recurringExpenses.isEmpty {
                Text("budget.fixedExpenses.empty")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.profile.recurringExpenses) { expense in
                    Button {
                        editingExpense = expense
                    } label: {
                        HStack {
                            Image(systemName: expense.category.symbolName)
                                .foregroundStyle(Theme.Palette.fixedExpense)
                                .frame(width: 26)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(expense.name)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                HStack(spacing: 4) {
                                    Text(expense.frequency.localizedName)
                                    if expense.isEssential {
                                        Text("· \(String(localized: "budget.essential"))")
                                    }
                                    if expense.isSubscription {
                                        Image(systemName: "repeat")
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(expense.amount.formatted())
                                    .font(.subheadline.weight(.medium))
                                    .monospacedDigit()
                                if expense.frequency != .monthly {
                                    Text(
                                        String(
                                            format: String(localized: "budget.monthlyEquivalent"),
                                            expense.monthlyEquivalent.rounded().formatted()
                                        )
                                    )
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }

                Divider()
                HStack {
                    Text("budget.totalMonthly").font(.subheadline.weight(.semibold))
                    Spacer()
                    AmountText(amount: analysis.summary.fixedExpenses, style: .subheadline.weight(.bold))
                }
            }
        }
        .cardStyle()
    }

    // MARK: Dettes

    @ViewBuilder
    private var debtsCard: some View {
        if !store.profile.activeDebts.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                SectionHeader(title: "budget.debts", subtitle: nil)

                if let dti = analysis.debtOverview.debtToIncomeRatio {
                    HStack {
                        Text("budget.debtRatio")
                            .font(.subheadline)
                        Spacer()
                        Text(Percent.format(dti))
                            .font(.subheadline.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(
                                dti > DebtEngine.debtToIncomeAlertThreshold
                                    ? Theme.Palette.critical
                                    : .primary
                            )
                    }
                }

                ForEach(DebtEngine.order(store.profile.activeDebts, strategy: .avalanche)) { debt in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(debt.name).font(.subheadline)
                            Text(
                                "\(debt.kind.localizedName) · \(Percent.format(debt.annualRate))"
                            )
                            .font(.caption)
                            .foregroundStyle(debt.isHighInterest ? Theme.Palette.critical : .secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(debt.outstandingPrincipal.formatted())
                                .font(.subheadline.weight(.medium))
                                .monospacedDigit()
                            Text(
                                String(
                                    format: String(localized: "budget.monthlyPayment"),
                                    debt.monthlyPayment.formatted()
                                )
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }
            }
            .cardStyle()
        }
    }

    // MARK: Enveloppes

    private var envelopesCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            SectionHeader(
                title: "budget.envelopes",
                subtitle: "budget.envelopes.subtitle"
            )

            if store.profile.categoryBudgets.isEmpty {
                Text("budget.envelopes.empty")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.profile.categoryBudgets) { budget in
                    let spent = analysis.summary.categoryTotals
                        .first { $0.category == budget.category }?
                        .amount ?? Money(.zero, store.profile.currency)
                    let ratio = spent.ratio(to: budget.limit) ?? 0

                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(budget.category.localizedName).font(.subheadline)
                            Spacer()
                            Text("\(spent.formatted()) / \(budget.limit.formatted())")
                                .font(.caption)
                                .monospacedDigit()
                                .foregroundStyle(ratio > 1 ? Theme.Palette.critical : .secondary)
                        }
                        ProgressBar(
                            progress: min(ratio, 1),
                            tint: ratio > 1 ? Theme.Palette.critical : Theme.Palette.accent
                        )
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .cardStyle()
    }
}
