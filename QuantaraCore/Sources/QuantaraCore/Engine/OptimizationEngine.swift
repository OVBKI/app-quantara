import Foundation

public enum OpportunityKind: String, Codable, CaseIterable, Sendable {
    case categoryAboveUsual   // Catégorie au-dessus de son propre niveau habituel
    case subscriptionAudit    // Abonnements à passer en revue
    case duplicateSubscription
    case dormantSubscription
    case discretionaryExcess  // Part discrétionnaire élevée
    case costlyDebtInterest   // Intérêts évitables
    case unusualExpense       // Dépense atypique isolée

    public var localizationKey: String { "optimization.\(rawValue)" }
}

public enum OpportunityEffort: String, Codable, CaseIterable, Sendable {
    case easy      // Une action ponctuelle suffit (résilier, renégocier)
    case moderate  // Demande un changement d'habitude limité
    case demanding // Demande un effort durable

    public var localizationKey: String { "optimization.effort.\(rawValue)" }
}

public struct SavingOpportunity: Hashable, Codable, Sendable, Identifiable {
    public let id: String
    public let kind: OpportunityKind
    public let category: ExpenseCategory?
    public let title: String
    public let detail: String
    public let monthlySaving: Money
    public let annualSaving: Money
    public let effort: OpportunityEffort
    /// Confiance dans l'estimation (0-1). Affichée : une économie « probable » et une
    /// économie « certaine » n'engagent pas la même décision.
    public let confidence: Decimal
    public let action: InsightAction?
}

public struct OptimizationPlan: Hashable, Codable, Sendable {
    public let opportunities: [SavingOpportunity]
    public let totalMonthlySaving: Money
    public let totalAnnualSaving: Money
    public let currentSavingsCapacity: Money
    public let projectedSavingsCapacity: Money
    /// Ce que représente l'économie cumulée sur dix ans, placée au taux supposé.
    public let tenYearImpact: Money?
    public let assumptions: [String]

    public var isEmpty: Bool { opportunities.isEmpty }
}

/// Le moteur derrière le bouton « ✨ Optimiser mon budget » (§24).
///
/// Principe : comparer l'utilisateur **à lui-même**, jamais à une moyenne nationale.
/// « Vous dépensez plus que la moyenne des Français » n'aide personne ; « vous dépensez
/// 80 € de plus que votre propre habitude » est actionnable.
public enum OptimizationEngine {

    /// Au-delà de ce seuil, la part des dépenses discrétionnaires devient le premier
    /// levier d'ajustement.
    private static let discretionaryComfortShare = Decimal(string: "0.30") ?? 0
    private static let minimumMeaningfulSaving = Decimal(10)

    public static func plan(
        profile: FinancialProfile,
        summary: MonthlySummary,
        referenceDate: Date = Date()
    ) -> OptimizationPlan {

        let currency = profile.currency
        let locale = Locale(identifier: "fr_FR")
        var opportunities: [SavingOpportunity] = []

        // --- 1. Catégories variables au-dessus de leur propre médiane ---
        for total in summary.categoryTotals where total.category.isVariable {
            guard case .variable(let variableCategory) = total.category else { continue }

            let history = BudgetEngine.categoryHistory(
                total.category,
                profile: profile,
                endingAt: summary.month.previous,
                months: 6
            ).map(\.amount).filter { !$0.isZero }

            guard history.count >= 3, let median = history.median(currency: currency) else { continue }
            guard total.amount > median else { continue }

            // On ne propose de récupérer que la part réaliste de l'écart : ramener les
            // courses à zéro n'est pas une économie, c'est une injonction.
            let excess = total.amount - median
            let realistic = min(excess, total.amount * variableCategory.compressibility)
            guard realistic.amount >= minimumMeaningfulSaving else { continue }

            opportunities.append(
                SavingOpportunity(
                    id: "category.\(total.category.id)",
                    kind: .categoryAboveUsual,
                    category: total.category,
                    title: "Revenir à votre habitude",
                    detail: "Vous avez dépensé \(total.amount.formatted(locale: locale)) contre \(median.formatted(locale: locale)) habituellement. Revenir à ce niveau libère \(realistic.roundedToUnit.formatted(locale: locale)) par mois.",
                    monthlySaving: realistic,
                    annualSaving: realistic * 12,
                    effort: variableCategory.compressibility > (Decimal(string: "0.25") ?? 0) ? .moderate : .demanding,
                    confidence: Decimal(string: "0.75") ?? 0,
                    action: .openCategory(total.category.id)
                )
            )
        }

        // --- 2. Abonnements ---
        let subscriptions = profile.recurringExpenses.filter { $0.isActive && $0.isSubscription }
        if !subscriptions.isEmpty {
            let total = Money.sum(subscriptions.map(\.monthlyEquivalent), currency: currency)
            // Hypothèse prudente : un passage en revue élimine typiquement un abonnement
            // sur cinq. On l'annonce comme une hypothèse, pas comme un fait.
            let estimated = total * (Decimal(string: "0.20") ?? 0)
            if estimated.amount >= minimumMeaningfulSaving {
                opportunities.append(
                    SavingOpportunity(
                        id: "subscriptions",
                        kind: .subscriptionAudit,
                        category: .fixed(.subscriptions),
                        title: "Passer vos \(subscriptions.count) abonnements en revue",
                        detail: "Ils représentent \(total.formatted(locale: locale)) par mois, soit \((total * 12).roundedToUnit.formatted(locale: locale)) par an. Estimation prudente : un abonnement sur cinq n'est plus utilisé.",
                        monthlySaving: estimated,
                        annualSaving: estimated * 12,
                        effort: .easy,
                        confidence: Decimal(string: "0.50") ?? 0,
                        action: .openSubscriptions
                    )
                )
            }

            // Doublons : deux abonnements de même montant dans la même catégorie.
            let grouped = Dictionary(grouping: subscriptions) { $0.monthlyEquivalent.amount }
            for (_, group) in grouped where group.count > 1 {
                guard let first = group.first else { continue }
                let saving = first.monthlyEquivalent
                guard saving.amount >= minimumMeaningfulSaving else { continue }
                opportunities.append(
                    SavingOpportunity(
                        id: "duplicate.\(first.id.uuidString)",
                        kind: .duplicateSubscription,
                        category: .fixed(.subscriptions),
                        title: "Abonnements identiques",
                        detail: "\(group.count) abonnements au même montant : \(group.map(\.name).joined(separator: ", ")). S'il s'agit d'un doublon, en supprimer un économise \(saving.formatted(locale: locale)) par mois.",
                        monthlySaving: saving,
                        annualSaving: saving * 12,
                        effort: .easy,
                        confidence: Decimal(string: "0.40") ?? 0,
                        action: .openSubscriptions
                    )
                )
            }
        }

        // --- 3. Part discrétionnaire ---
        let discretionary = Money.sum(
            summary.categoryTotals
                .filter { !$0.category.isEssential }
                .map(\.amount),
            currency: currency
        )
        if let share = discretionary.ratio(to: summary.income), share > discretionaryComfortShare {
            let excess = discretionary - summary.income * discretionaryComfortShare
            // On ne propose de récupérer qu'un quart de l'excédent : un objectif
            // atteignable vaut mieux qu'un objectif exemplaire jamais tenu.
            let realistic = excess * (Decimal(string: "0.25") ?? 0)
            if realistic.amount >= minimumMeaningfulSaving {
                opportunities.append(
                    SavingOpportunity(
                        id: "discretionary",
                        kind: .discretionaryExcess,
                        category: nil,
                        title: "Dépenses non essentielles élevées",
                        detail: "Elles représentent \(Percent.format(share, locale: locale, fractionDigits: 0)) de vos revenus (\(discretionary.formatted(locale: locale))). Réduire d'un quart l'écart au seuil de confort libère \(realistic.roundedToUnit.formatted(locale: locale)) par mois.",
                        monthlySaving: realistic,
                        annualSaving: realistic * 12,
                        effort: .moderate,
                        confidence: Decimal(string: "0.60") ?? 0,
                        action: .runOptimization
                    )
                )
            }
        }

        // --- 4. Intérêts de dettes coûteuses ---
        for debt in profile.activeDebts where debt.isHighInterest {
            let monthlyInterest = debt.monthlyInterest
            guard monthlyInterest.amount >= minimumMeaningfulSaving else { continue }
            opportunities.append(
                SavingOpportunity(
                    id: "debt.\(debt.id.uuidString)",
                    kind: .costlyDebtInterest,
                    category: nil,
                    title: "Intérêts sur « \(debt.name) »",
                    detail: "Ce crédit coûte \(monthlyInterest.roundedToUnit.formatted(locale: locale)) d'intérêts par mois à \(Percent.format(debt.annualRate, locale: locale)). Chaque euro remboursé par anticipation est un gain certain.",
                    monthlySaving: monthlyInterest,
                    annualSaving: monthlyInterest * 12,
                    effort: .demanding,
                    confidence: Decimal(string: "0.90") ?? 0,
                    action: .openDebt(debt.id)
                )
            )
        }

        // --- 5. Dépenses inhabituelles isolées ---
        let variableTransactions = profile.transactions(in: summary.month)
            .filter { $0.kind == .expense && !$0.isRecurringInstance }
        if variableTransactions.count >= 8,
           let mean = DecimalStatistics.mean(variableTransactions.map(\.effectiveAmount.amount)),
           let deviation = DecimalStatistics.standardDeviation(variableTransactions.map(\.effectiveAmount.amount)),
           deviation > .zero {
            let threshold = mean + deviation * 2
            let outliers = variableTransactions.filter { $0.effectiveAmount.amount > threshold }
            if !outliers.isEmpty {
                let total = Money.sum(outliers.map(\.effectiveAmount), currency: currency)
                opportunities.append(
                    SavingOpportunity(
                        id: "outliers",
                        kind: .unusualExpense,
                        category: nil,
                        title: "\(outliers.count) dépense\(outliers.count > 1 ? "s" : "") inhabituelle\(outliers.count > 1 ? "s" : "")",
                        detail: "\(total.formatted(locale: locale)) sur \(outliers.count) opération\(outliers.count > 1 ? "s" : "") nettement au-dessus de vos montants habituels. À vérifier : ponctuel ou début d'habitude ?",
                        monthlySaving: Money.zero(currency),
                        annualSaving: Money.zero(currency),
                        effort: .easy,
                        confidence: Decimal(string: "0.70") ?? 0,
                        action: nil
                    )
                )
            }
        }

        let sorted = opportunities.sorted { $0.monthlySaving > $1.monthlySaving }
        let totalMonthly = Money.sum(sorted.map(\.monthlySaving), currency: currency)
        let capacity = BudgetEngine.savingsCapacity(summary: summary, preferences: profile.preferences)

        let tenYear: Money? = totalMonthly.amount > .zero
            ? SimulationEngine.projectSavings(
                monthlyContribution: totalMonthly,
                initialAmount: Money.zero(currency),
                annualReturn: profile.preferences.assumedAnnualReturn,
                months: 120,
                referenceDate: referenceDate
            ).finalAmount
            : nil

        return OptimizationPlan(
            opportunities: sorted,
            totalMonthlySaving: totalMonthly,
            totalAnnualSaving: totalMonthly * 12,
            currentSavingsCapacity: capacity,
            projectedSavingsCapacity: capacity + totalMonthly,
            tenYearImpact: tenYear,
            assumptions: [
                "Les économies sont mesurées par rapport à vos propres habitudes des six derniers mois, pas à une moyenne extérieure.",
                "Les marges de réduction tiennent compte du caractère plus ou moins compressible de chaque poste.",
                "L'estimation sur les abonnements est prudente et suppose un passage en revue effectif."
            ]
        )
    }
}
