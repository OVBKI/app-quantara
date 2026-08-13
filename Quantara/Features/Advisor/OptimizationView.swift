import SwiftUI
import UIKit
import Charts
import QuantaraCore

/// Écran « ✨ Optimiser mon budget » (§24).
struct OptimizationView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private var plan: OptimizationPlan { store.analysis.optimization }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    if plan.isEmpty {
                        EmptyStateView(
                            symbol: "checkmark.seal",
                            title: "optimization.empty.title",
                            message: "optimization.empty.message"
                        )
                    } else {
                        headline
                        opportunities
                        newCapacity
                        assumptions
                    }
                }
                .padding(Theme.Spacing.medium)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("home.optimize")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.close") { dismiss() }
                }
            }
        }
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text(
                String(
                    format: String(localized: "optimization.headline"),
                    plan.totalMonthlySaving.roundedToUnit.formatted()
                )
            )
            .font(.title2.weight(.bold))

            Text(
                String(
                    format: String(localized: "optimization.annual"),
                    plan.totalAnnualSaving.roundedToUnit.formatted()
                )
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .cardStyle(padding: Theme.Spacing.large)
    }

    private var opportunities: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            SectionHeader(title: "optimization.details", subtitle: nil)

            ForEach(plan.opportunities) { opportunity in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(opportunity.title)
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        if opportunity.monthlySaving.amount > 0 {
                            Text("− \(opportunity.monthlySaving.roundedToUnit.formatted())")
                                .font(.subheadline.weight(.bold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.Palette.positive)
                        }
                    }

                    Text(opportunity.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    // Effort et confiance sont affichés : une économie « probable » et
                    // une économie « certaine » n'engagent pas la même décision.
                    HStack(spacing: Theme.Spacing.small) {
                        badge(opportunity.effort.localizedName, tint: effortTint(opportunity.effort))
                        badge(
                            String(
                                format: String(localized: "optimization.confidence"),
                                Percent.format(opportunity.confidence, fractionDigits: 0)
                            ),
                            tint: .secondary
                        )
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
        }
        .cardStyle()
    }

    private var newCapacity: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            HStack {
                Text("optimization.currentCapacity")
                Spacer()
                Text(plan.currentSavingsCapacity.roundedToUnit.formatted())
                    .monospacedDigit()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            HStack {
                Text("optimization.newCapacity")
                    .font(.headline)
                Spacer()
                AmountText(
                    amount: plan.projectedSavingsCapacity.roundedToUnit,
                    style: .title3.weight(.bold),
                    color: Theme.Palette.positive
                )
            }

            if let tenYear = plan.tenYearImpact {
                Divider()
                Text(
                    String(
                        format: String(localized: "optimization.tenYears"),
                        tenYear.roundedToUnit.formatted()
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }

    private var assumptions: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            Text("optimization.assumptions")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(plan.assumptions, id: \.self) { assumption in
                Text("• \(assumption)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .cardStyle()
    }

    private func badge(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(tint.opacity(0.15)))
            .foregroundStyle(tint)
    }

    private func effortTint(_ effort: OpportunityEffort) -> Color {
        switch effort {
        case .easy:      return Theme.Palette.positive
        case .moderate:  return Theme.Palette.warning
        case .demanding: return Theme.Palette.critical
        }
    }
}

// MARK: - « Puis-je me le permettre ? »

struct AffordabilityView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var amount: Decimal = 0
    @State private var hasTargetDate = false
    @State private var targetDate = Date()

    private var impact: AffordabilityImpact? {
        guard amount > 0 else { return nil }
        return AffordabilityEngine.evaluate(
            amount: Money(amount, store.profile.currency),
            targetDate: hasTargetDate ? targetDate : nil,
            profile: store.profile,
            summary: store.analysis.summary,
            emergencyFund: store.analysis.emergencyFund,
            cashFlow: store.analysis.cashFlow,
            goalPlans: store.analysis.goalPlans,
            referenceDate: store.referenceDate
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    AmountField(title: "field.amount", amount: $amount, currency: store.profile.currency)
                    Toggle("affordability.hasDate", isOn: $hasTargetDate)
                    if hasTargetDate {
                        DatePicker("field.targetDate", selection: $targetDate, displayedComponents: .date)
                    }
                } header: {
                    Text("affordability.question")
                }

                if let impact {
                    Section {
                        HStack {
                            Image(systemName: verdictSymbol(impact.verdict))
                                .foregroundStyle(verdictTint(impact.verdict))
                                .font(.title2)
                            Text(String(localized: String.LocalizationValue(impact.verdict.localizationKey)))
                                .font(.headline)
                        }
                        ForEach(impact.reasons, id: \.self) { reason in
                            Text(reason)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if !impact.alternatives.isEmpty {
                        Section {
                            ForEach(impact.alternatives, id: \.self) { alternative in
                                Label(alternative, systemImage: "arrow.turn.down.right")
                                    .font(.footnote)
                            }
                        } header: {
                            Text("affordability.alternatives")
                        }
                    }
                }
            }
            .navigationTitle("home.canIAfford")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.close") { dismiss() }
                }
            }
        }
    }

    private func verdictSymbol(_ verdict: AffordabilityVerdict) -> String {
        switch verdict {
        case .comfortable:  return "checkmark.circle.fill"
        case .tight:        return "exclamationmark.circle.fill"
        case .risky:        return "exclamationmark.triangle.fill"
        case .unaffordable: return "xmark.octagon.fill"
        }
    }

    private func verdictTint(_ verdict: AffordabilityVerdict) -> Color {
        switch verdict {
        case .comfortable:  return Theme.Palette.positive
        case .tight:        return Theme.Palette.warning
        case .risky:        return Theme.Palette.warning
        case .unaffordable: return Theme.Palette.critical
        }
    }
}

// MARK: - Simulateur

struct SimulationView: View {

    @Environment(DataStore.self) private var store

    @State private var monthlyAmount: Decimal = 300
    @State private var years: Int = 10

    private var projection: SavingsProjection {
        SimulationEngine.projectSavings(
            monthlyContribution: Money(monthlyAmount, store.profile.currency),
            initialAmount: store.profile.savingsBalance,
            annualReturn: store.profile.preferences.assumedAnnualReturn,
            months: years * 12,
            annualInflation: store.profile.preferences.assumedAnnualInflation,
            referenceDate: store.referenceDate
        )
    }

    var body: some View {
        Form {
            Section {
                AmountField(title: "simulation.monthly", amount: $monthlyAmount, currency: store.profile.currency)
                Stepper(
                    String(format: String(localized: "simulation.years"), years),
                    value: $years,
                    in: 1...40
                )
            }

            Section {
                Chart(projection.points) { point in
                    AreaMark(
                        x: .value("année", point.monthIndex / 12),
                        y: .value("total", NSDecimalNumber(decimal: point.total.amount).doubleValue)
                    )
                    .foregroundStyle(
                        .linearGradient(
                            colors: [Theme.Palette.accent.opacity(0.4), .clear],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    LineMark(
                        x: .value("année", point.monthIndex / 12),
                        y: .value("versé", NSDecimalNumber(decimal: point.contributed.amount).doubleValue)
                    )
                    .foregroundStyle(.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
                .frame(height: 200)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("simulation.chart"))
                .accessibilityValue(Text(projection.finalAmount.formatted()))
            }

            Section {
                LabeledContent("simulation.final", value: projection.finalAmount.roundedToUnit.formatted())
                LabeledContent("simulation.contributed", value: projection.totalContributed.roundedToUnit.formatted())
                LabeledContent("simulation.interest", value: projection.totalInterest.roundedToUnit.formatted())
                if let adjusted = projection.inflationAdjustedFinalAmount {
                    LabeledContent("simulation.realValue", value: adjusted.roundedToUnit.formatted())
                }
            }

            // Un chiffre de projection sans ses hypothèses n'est pas exploitable.
            Section {
                ForEach(projection.assumptions, id: \.self) { assumption in
                    Text(assumption)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("optimization.assumptions")
            } footer: {
                Text("simulation.disclaimer")
            }
        }
        .navigationTitle("simulation.title")
    }
}
