import Foundation

public struct MonthlyReport: Hashable, Codable, Sendable {
    public let month: YearMonth
    public let summary: MonthlySummary
    public let comparison: MonthlyComparison?
    public let topCategories: [CategoryTotal]
    public let risingCategories: [CategoryTotal]
    public let unusualExpenses: [Transaction]
    public let goalProgress: [GoalPlan]
    public let savingsAchieved: Money
    public let optimizationRealized: Money?
    /// Écart entre les dépenses variables projetées en début de mois et le réalisé —
    /// c'est ce qui permet à l'estimation de s'améliorer d'un mois sur l'autre.
    public let forecastError: Money?
    public let highlights: [String]
}

/// Rapport de fin de mois (§15).
///
/// Comprend une boucle « prévu vs réalisé » absente du cahier des charges : sans elle,
/// l'estimation de dépenses variables saisie à l'onboarding n'est jamais confrontée à
/// la réalité, et ne s'améliore donc jamais.
public enum MonthlyReportEngine {

    public static func report(
        for month: YearMonth,
        profile: FinancialProfile,
        referenceDate: Date = Date()
    ) -> MonthlyReport {

        let locale = Locale(identifier: "fr_FR")
        let currency = profile.currency

        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        let previous = BudgetEngine.summary(
            for: month.previous,
            profile: profile,
            referenceDate: referenceDate
        )
        let hasPreviousData = !previous.income.isZero || !previous.totalExpenses.isZero
        let comparison = hasPreviousData
            ? BudgetEngine.comparison(current: summary, previous: previous)
            : nil

        let capacity = BudgetEngine.savingsCapacity(summary: summary, preferences: profile.preferences)
        let goalPlans = GoalEngine.plans(profile: profile, capacity: capacity, referenceDate: referenceDate)

        // Dépenses inhabituelles : au-delà de deux écarts-types du montant moyen.
        let monthTransactions = profile.transactions(in: month)
            .filter { $0.kind == .expense && !$0.isRecurringInstance }
        let unusual: [Transaction] = {
            let amounts = monthTransactions.map(\.effectiveAmount.amount)
            guard amounts.count >= 8,
                  let mean = DecimalStatistics.mean(amounts),
                  let deviation = DecimalStatistics.standardDeviation(amounts),
                  deviation > .zero
            else { return [] }
            let threshold = mean + deviation * 2
            return monthTransactions
                .filter { $0.effectiveAmount.amount > threshold }
                .sorted { $0.effectiveAmount > $1.effectiveAmount }
        }()

        // Erreur de prévision : ce qui était estimé vs ce qui a été dépensé.
        let forecastError: Money? = {
            guard let estimate = profile.estimatedMonthlyVariableSpending else { return nil }
            return summary.variableSpentToDate - estimate
        }()

        var highlights: [String] = []

        highlights.append(
            "Revenus \(summary.income.formatted(locale: locale)) · Dépenses \(summary.totalExpenses.formatted(locale: locale)) · Épargne \(summary.savings.formatted(locale: locale))"
        )

        if let rate = summary.savingsRate {
            highlights.append("Taux d'épargne : \(Percent.format(rate, locale: locale))")
        }

        if let comparison {
            if comparison.savingsChange.amount > .zero {
                highlights.append("Vous avez épargné \(comparison.savingsChange.formatted(locale: locale)) de plus que le mois dernier.")
            } else if comparison.savingsChange.amount < .zero {
                highlights.append("Vous avez épargné \(comparison.savingsChange.magnitude.formatted(locale: locale)) de moins que le mois dernier.")
            }
            if comparison.expenseChange.amount < .zero {
                highlights.append("Vos dépenses baissent de \(comparison.expenseChange.magnitude.formatted(locale: locale)).")
            }
        }

        if let top = summary.categoryTotals.first {
            highlights.append(
                "Premier poste de dépense : \(top.amount.formatted(locale: locale)), soit \(Percent.format(top.share, locale: locale, fractionDigits: 0)) du total."
            )
        }

        if let forecastError, forecastError.magnitude.amount > .zero {
            let direction = forecastError.isPositive ? "au-dessus" : "en dessous"
            highlights.append(
                "Vos dépenses variables sont \(forecastError.magnitude.formatted(locale: locale)) \(direction) de votre estimation."
            )
        }

        let completedGoals = goalPlans.filter { $0.goal.isComplete }
        if !completedGoals.isEmpty {
            highlights.append(
                "Objectif\(completedGoals.count > 1 ? "s" : "") atteint\(completedGoals.count > 1 ? "s" : "") : \(completedGoals.map(\.goal.name).joined(separator: ", "))."
            )
        }

        return MonthlyReport(
            month: month,
            summary: summary,
            comparison: comparison,
            topCategories: Array(summary.categoryTotals.prefix(5)),
            risingCategories: comparison?.risingCategories ?? [],
            unusualExpenses: Array(unusual.prefix(5)),
            goalProgress: goalPlans,
            savingsAchieved: summary.savings,
            optimizationRealized: comparison.map { $0.expenseChange.negated.clampedToZero },
            forecastError: forecastError,
            highlights: highlights
        )
    }

    /// Recalibrage de l'estimation de dépenses variables à partir du réalisé.
    ///
    /// Moyenne pondérée : 70 % d'historique, 30 % d'estimation initiale, pour ne pas
    /// faire basculer la référence sur un seul mois atypique.
    public static func recalibratedVariableEstimate(
        profile: FinancialProfile,
        endingAt month: YearMonth,
        months: Int = 3
    ) -> Money? {
        guard let observed = BudgetEngine.averageVariableSpending(
            profile: profile,
            endingAt: month,
            months: months
        ) else { return nil }

        guard let initial = profile.estimatedMonthlyVariableSpending else { return observed }
        return observed * (Decimal(string: "0.70") ?? 0) + initial * (Decimal(string: "0.30") ?? 0)
    }
}
