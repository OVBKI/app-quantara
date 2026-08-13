import SwiftUI
import UIKit
import Charts
import QuantaraCore

struct HomeView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(DataStore.self) private var store
    var onQuickAdd: () -> Void

    @State private var isShowingOptimization = false
    @State private var isShowingPaywall = false
    @State private var isShowingAffordability = false

    private var analysis: FinancialAnalysis { store.analysis }
    private var summary: MonthlySummary { analysis.summary }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    safeToSpendCard
                    optimizeButton
                    breakdownCard
                    if !analysis.insights.isEmpty { insightsSection }
                    if !analysis.goalPlans.isEmpty { goalsSection }
                    cashFlowCard
                }
                .padding(Theme.Spacing.medium)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("tab.home")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("tab.settings")
                }
                ToolbarItem(placement: .bottomBar) {
                    Button(action: onQuickAdd) {
                        Label("home.quickAdd", systemImage: "plus.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .sheet(isPresented: $isShowingOptimization) { OptimizationView() }
            .sheet(isPresented: $isShowingPaywall) { PaywallView() }
            .sheet(isPresented: $isShowingAffordability) { AffordabilityView() }
        }
    }

    // MARK: Reste à vivre journalier

    /// L'indicateur mis en avant. Un tableau de bord répond à « où en suis-je » ;
    /// celui-ci répond à « qu'est-ce que je peux faire aujourd'hui », qui est la
    /// question réellement posée.
    private var safeToSpendCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("home.safeToSpend")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            AmountText(
                amount: summary.safeToSpendPerDay.roundedToUnit,
                style: .system(size: 46, weight: .bold, design: .rounded),
                color: summary.safeToSpendPerDay.isZero ? Theme.Palette.critical : .primary
            )

            Text(
                String(
                    format: String(localized: "home.safeToSpend.detail"),
                    summary.safeToSpendTotal.roundedToUnit.formatted(),
                    summary.daysRemaining
                )
            )
            .font(.footnote)
            .foregroundStyle(.secondary)

            if summary.isProjected {
                Label("home.projectedNotice", systemImage: "chart.line.uptrend.xyaxis")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .cardStyle(padding: Theme.Spacing.large)
        .accessibilityElement(children: .combine)
    }

    // MARK: Optimiser

    private var optimizeButton: some View {
        Button {
            if environment.entitlements.has(.budgetOptimization) {
                isShowingOptimization = true
            } else {
                isShowingPaywall = true
            }
        } label: {
            HStack {
                Image(systemName: "sparkles")
                VStack(alignment: .leading, spacing: 2) {
                    Text("home.optimize")
                        .font(.headline)
                    if !analysis.optimization.isEmpty {
                        Text(
                            String(
                                format: String(localized: "home.optimize.found"),
                                analysis.optimization.totalMonthlySaving.roundedToUnit.formatted()
                            )
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }
            .cardStyle()
        }
        .buttonStyle(.plain)
    }

    // MARK: Répartition du mois

    private var breakdownCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(title: "home.thisMonth", subtitle: nil)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Theme.Spacing.medium) {
                StatTile(title: "budget.income", amount: summary.income, tint: Theme.Palette.income)
                StatTile(title: "budget.fixed", amount: summary.fixedExpenses, tint: Theme.Palette.fixedExpense)
                StatTile(title: "budget.variable", amount: summary.variableExpenses, tint: Theme.Palette.variableExpense)
                StatTile(title: "budget.savings", amount: summary.savings, tint: Theme.Palette.savings)
            }

            Divider()

            HStack {
                Text("budget.disposable")
                    .font(.headline)
                Spacer()
                AmountText(
                    amount: summary.disposable,
                    style: .title3.weight(.bold),
                    color: summary.isBalanced ? Theme.Palette.disposable : Theme.Palette.critical
                )
            }

            if let rate = summary.savingsRate {
                HStack {
                    Text("budget.savingsRate")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(Percent.format(rate))
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                }
            }

            if !summary.categoryTotals.isEmpty {
                categoryChart
            }
        }
        .cardStyle()
    }

    private var categoryChart: some View {
        Chart(Array(summary.topExpenses.enumerated()), id: \.element.id) { index, total in
            SectorMark(
                angle: .value("montant", NSDecimalNumber(decimal: total.amount.amount).doubleValue),
                innerRadius: .ratio(0.62),
                angularInset: 1.5
            )
            .foregroundStyle(Theme.Palette.categoryColor(index: index))
            .cornerRadius(4)
        }
        .frame(height: 160)
        .chartLegend(.hidden)
        .overlay {
            VStack(spacing: 2) {
                Text("home.topExpenses")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(summary.topExpenses.first?.category.localizedName ?? "")
                    .font(.caption.weight(.medium))
            }
        }
        // Un graphique non verbalisé est invisible pour VoiceOver : les valeurs sont
        // exposées explicitement.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("home.topExpenses"))
        .accessibilityValue(
            Text(
                summary.topExpenses
                    .map { "\($0.category.localizedName) \($0.amount.formatted())" }
                    .joined(separator: ", ")
            )
        )
    }

    // MARK: Insights

    private var insightsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(title: "home.insights", subtitle: nil)
            ForEach(analysis.insights.prefix(3)) { insight in
                InsightCard(insight: insight) {
                    handle(insight.action)
                }
            }
        }
    }

    // MARK: Objectifs

    private var goalsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(title: "home.goals", subtitle: nil)
            ForEach(analysis.goalPlans.prefix(3)) { plan in
                GoalRow(plan: plan)
            }
        }
        .cardStyle()
    }

    // MARK: Trésorerie

    private var cashFlowCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(title: "home.cashFlow", subtitle: nil)
            CashFlowChart(forecast: analysis.cashFlow)

            if analysis.cashFlow.hasProjectedOverdraft,
               let date = analysis.cashFlow.lowestBalanceDate {
                Label(
                    String(
                        format: String(localized: "home.cashFlow.overdraft"),
                        date.formatted(.dateTime.day().month(.wide)),
                        analysis.cashFlow.lowestBalance.formatted()
                    ),
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.footnote)
                .foregroundStyle(Theme.Palette.critical)
            }

            Button {
                isShowingAffordability = true
            } label: {
                Label("home.canIAfford", systemImage: "questionmark.circle")
            }
            .font(.subheadline)
        }
        .cardStyle()
    }

    private func handle(_ action: InsightAction?) {
        switch action {
        case .runOptimization:
            isShowingOptimization = environment.entitlements.has(.budgetOptimization)
            isShowingPaywall = !environment.entitlements.has(.budgetOptimization)
        default:
            break
        }
    }
}

// MARK: - Carte d'insight

struct InsightCard: View {
    let insight: Insight
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: Theme.Spacing.small) {
                Image(systemName: symbol)
                    .foregroundStyle(Theme.Palette.color(for: insight.severity))
                    .font(.title3)
                VStack(alignment: .leading, spacing: 4) {
                    Text(insight.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(insight.message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .cardStyle()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch insight.severity {
        case .positive:    return "checkmark.seal.fill"
        case .information: return "lightbulb.fill"
        case .warning:     return "exclamationmark.triangle.fill"
        case .critical:    return "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Ligne d'objectif

struct GoalRow: View {
    let plan: GoalPlan

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            HStack {
                Image(systemName: plan.goal.kind.symbolName)
                    .foregroundStyle(Theme.Palette.accent)
                Text(plan.goal.name)
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(Percent.format(plan.progress, fractionDigits: 0))
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            ProgressBar(progress: plan.progress)
            HStack {
                Text(plan.goal.currentAmount.formatted())
                Spacer()
                Text(plan.goal.targetAmount.formatted())
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Courbe de trésorerie

struct CashFlowChart: View {
    let forecast: CashFlowForecast

    var body: some View {
        Chart {
            ForEach(forecast.days) { day in
                AreaMark(
                    x: .value("jour", day.dayOfMonth),
                    y: .value("solde", NSDecimalNumber(decimal: day.closingBalance.amount).doubleValue)
                )
                .foregroundStyle(
                    .linearGradient(
                        colors: [Theme.Palette.accent.opacity(0.35), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                LineMark(
                    x: .value("jour", day.dayOfMonth),
                    y: .value("solde", NSDecimalNumber(decimal: day.closingBalance.amount).doubleValue)
                )
                .foregroundStyle(Theme.Palette.accent)
                .interpolationMethod(.monotone)
            }
            // Ligne de zéro : c'est elle qui donne son sens au reste de la courbe.
            RuleMark(y: .value("zéro", 0))
                .foregroundStyle(.tertiary)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
        .frame(height: 140)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(Money(Decimal(amount), forecast.startingBalance.currency).formattedCompact())
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("home.cashFlow"))
        .accessibilityValue(
            Text(
                String(
                    format: String(localized: "home.cashFlow.accessibility"),
                    forecast.lowestBalance.formatted(),
                    forecast.endingBalance.formatted()
                )
            )
        )
    }
}
