import Foundation

public struct ProjectionPoint: Hashable, Codable, Sendable, Identifiable {
    public let monthIndex: Int
    public let date: Date
    public let contributed: Money
    public let interest: Money
    public let total: Money

    public var id: Int { monthIndex }
}

public struct SavingsProjection: Hashable, Codable, Sendable {
    public let monthlyContribution: Money
    public let initialAmount: Money
    public let annualReturn: Decimal
    public let months: Int
    public let points: [ProjectionPoint]
    public let finalAmount: Money
    public let totalContributed: Money
    public let totalInterest: Money
    /// Valeur finale exprimée en pouvoir d'achat d'aujourd'hui.
    public let inflationAdjustedFinalAmount: Money?
    /// Hypothèses utilisées, à afficher systématiquement (règle IA §22.3).
    public let assumptions: [String]
}

public struct ScenarioResult: Hashable, Codable, Sendable {
    public let label: String
    public let monthlyDisposableChange: Money
    public let newMonthlyDisposable: Money
    public let newSavingsCapacity: Money
    public let newSavingsRate: Decimal?
    public let tenYearImpact: Money
    public let assumptions: [String]
}

public enum SimulationEngine {

    /// Bornes de sécurité : au-delà, la projection cesse d'avoir un sens et
    /// des saisies aberrantes produiraient des chiffres spectaculairement faux.
    public static let maxProjectionMonths = 600      // 50 ans
    public static let maxAnnualReturn = Decimal(string: "0.20") ?? 0
    public static let minAnnualReturn = Decimal(string: "-0.10") ?? 0

    // MARK: Capitalisation

    /// Projection d'épargne à versements mensuels, intérêts composés mensuellement.
    ///
    /// ```
    /// FV = P·(1+i)^n + M·[((1+i)^n − 1) / i]      i = taux annuel / 12
    /// ```
    ///
    /// La série complète est renvoyée pour alimenter le graphique — et parce qu'un
    /// utilisateur croit davantage une courbe qu'un chiffre isolé.
    public static func projectSavings(
        monthlyContribution: Money,
        initialAmount: Money,
        annualReturn: Decimal,
        months: Int,
        annualInflation: Decimal? = nil,
        referenceDate: Date = Date(),
        calendar: Calendar = .gregorianUTC
    ) -> SavingsProjection {

        let currency = monthlyContribution.currency
        let clampedMonths = min(max(months, 0), maxProjectionMonths)
        let rate = min(max(annualReturn, minAnnualReturn), maxAnnualReturn)
        let monthlyRate = rate / 12

        var balance = initialAmount.amount
        var contributed = initialAmount.amount
        var points: [ProjectionPoint] = []

        points.append(
            ProjectionPoint(
                monthIndex: 0,
                date: referenceDate,
                contributed: initialAmount,
                interest: Money.zero(currency),
                total: initialAmount
            )
        )

        if clampedMonths > 0 {
            for month in 1...clampedMonths {
                let interest = balance * monthlyRate
                balance += interest + monthlyContribution.amount
                contributed += monthlyContribution.amount

                // Un point par an (et le dernier) : au-delà, la courbe est illisible et
                // la charge mémoire inutile.
                if month % 12 == 0 || month == clampedMonths {
                    points.append(
                        ProjectionPoint(
                            monthIndex: month,
                            date: calendar.date(byAdding: .month, value: month, to: referenceDate) ?? referenceDate,
                            contributed: Money(contributed, currency),
                            interest: Money(balance - contributed, currency),
                            total: Money(balance, currency)
                        )
                    )
                }
            }
        }

        let final = Money(balance, currency)
        let totalContributed = Money(contributed, currency)

        let adjusted: Money? = annualInflation.map { inflation in
            let years = Decimal(clampedMonths) / 12
            let wholeYears = NSDecimalNumber(decimal: years).intValue
            let deflator = DecimalStatistics.power(1 + inflation, wholeYears)
            return deflator > .zero ? Money(balance / deflator, currency) : final
        }

        var assumptions = [
            "Rendement annuel supposé : \(Percent.format(rate, locale: Locale(identifier: "fr_FR")))",
            "Intérêts composés mensuellement, versements en fin de mois",
            "Hors fiscalité et frais de gestion"
        ]
        if let annualInflation {
            assumptions.append("Inflation supposée : \(Percent.format(annualInflation, locale: Locale(identifier: "fr_FR")))")
        }

        return SavingsProjection(
            monthlyContribution: monthlyContribution,
            initialAmount: initialAmount,
            annualReturn: rate,
            months: clampedMonths,
            points: points,
            finalAmount: final,
            totalContributed: totalContributed,
            totalInterest: (final - totalContributed).clampedToZero,
            inflationAdjustedFinalAmount: adjusted,
            assumptions: assumptions
        )
    }

    /// Nombre de mois nécessaires pour atteindre un montant cible (§16 :
    /// « Quand atteindrai-je 20 000 € ? »). `nil` si la cible est hors d'atteinte.
    public static func monthsToReach(
        target: Money,
        monthlyContribution: Money,
        initialAmount: Money,
        annualReturn: Decimal
    ) -> Int? {
        guard target > initialAmount else { return 0 }
        let rate = min(max(annualReturn, minAnnualReturn), maxAnnualReturn)
        let monthlyRate = rate / 12

        // Sans versement ni rendement positif, la cible n'est jamais atteinte.
        guard monthlyContribution.amount > .zero || monthlyRate > .zero else { return nil }

        var balance = initialAmount.amount
        var month = 0
        while balance < target.amount && month < maxProjectionMonths {
            month += 1
            balance += balance * monthlyRate + monthlyContribution.amount
        }
        return balance >= target.amount ? month : nil
    }

    // MARK: Scénarios

    /// « Que se passe-t-il si j'épargne X € de plus par mois ? »
    public static func scenarioAdditionalSaving(
        amount: Money,
        summary: MonthlySummary,
        preferences: BudgetPreferences,
        horizonYears: Int = 10,
        referenceDate: Date = Date()
    ) -> ScenarioResult {
        let newDisposable = summary.disposable - amount
        let projection = projectSavings(
            monthlyContribution: amount,
            initialAmount: Money.zero(summary.currency),
            annualReturn: preferences.assumedAnnualReturn,
            months: horizonYears * 12,
            annualInflation: preferences.assumedAnnualInflation,
            referenceDate: referenceDate
        )
        return ScenarioResult(
            label: "Épargner \(amount.formatted(locale: Locale(identifier: "fr_FR"))) de plus par mois",
            monthlyDisposableChange: amount.negated,
            newMonthlyDisposable: newDisposable,
            newSavingsCapacity: summary.savings + amount,
            newSavingsRate: summary.income.isZero
                ? nil
                : (summary.savings + amount).amount / summary.income.amount,
            tenYearImpact: projection.finalAmount,
            assumptions: projection.assumptions
        )
    }

    /// « Que se passe-t-il si je réduis mes dépenses de X € par mois ? »
    public static func scenarioExpenseReduction(
        amount: Money,
        summary: MonthlySummary,
        preferences: BudgetPreferences,
        horizonYears: Int = 10,
        referenceDate: Date = Date()
    ) -> ScenarioResult {
        let newDisposable = summary.disposable + amount
        let projection = projectSavings(
            monthlyContribution: amount,
            initialAmount: Money.zero(summary.currency),
            annualReturn: preferences.assumedAnnualReturn,
            months: horizonYears * 12,
            annualInflation: preferences.assumedAnnualInflation,
            referenceDate: referenceDate
        )
        return ScenarioResult(
            label: "Réduire les dépenses de \(amount.formatted(locale: Locale(identifier: "fr_FR"))) par mois",
            monthlyDisposableChange: amount,
            newMonthlyDisposable: newDisposable,
            newSavingsCapacity: BudgetEngine.savingsCapacity(summary: summary, preferences: preferences) + amount,
            newSavingsRate: summary.income.isZero
                ? nil
                : (summary.savings + amount).amount / summary.income.amount,
            tenYearImpact: projection.finalAmount,
            assumptions: projection.assumptions
        )
    }

    /// « Que se passe-t-il si mon salaire augmente de X % ? »
    public static func scenarioIncomeChange(
        percentChange: Decimal,
        summary: MonthlySummary,
        preferences: BudgetPreferences,
        horizonYears: Int = 10,
        referenceDate: Date = Date()
    ) -> ScenarioResult {
        let delta = summary.income * percentChange
        let newIncome = summary.income + delta
        let newDisposable = summary.disposable + delta
        let projection = projectSavings(
            monthlyContribution: delta.clampedToZero,
            initialAmount: Money.zero(summary.currency),
            annualReturn: preferences.assumedAnnualReturn,
            months: horizonYears * 12,
            annualInflation: preferences.assumedAnnualInflation,
            referenceDate: referenceDate
        )
        var assumptions = projection.assumptions
        assumptions.append("Hypothèse : les dépenses restent stables malgré la hausse de revenu")
        return ScenarioResult(
            label: "Revenu \(percentChange >= 0 ? "+" : "")\(Percent.format(percentChange, locale: Locale(identifier: "fr_FR"), fractionDigits: 0))",
            monthlyDisposableChange: delta,
            newMonthlyDisposable: newDisposable,
            newSavingsCapacity: newDisposable.clampedToZero,
            newSavingsRate: newIncome.isZero
                ? nil
                : (summary.savings + delta).amount / newIncome.amount,
            tenYearImpact: projection.finalAmount,
            assumptions: assumptions
        )
    }
}
