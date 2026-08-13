import Foundation

/// Analyse complète d'un profil pour un mois donné.
///
/// Point d'entrée unique de l'application : une seule construction fait tourner tous les
/// moteurs dans le bon ordre, avec des dépendances explicites (l'allocation a besoin du
/// fonds d'urgence, qui a besoin de la synthèse…). Cela évite que chaque écran
/// recalcule sa propre variante et affiche des chiffres légèrement différents.
public struct FinancialAnalysis: Sendable {

    public let profile: FinancialProfile
    public let month: YearMonth
    public let referenceDate: Date

    public let summary: MonthlySummary
    public let previousSummary: MonthlySummary?
    public let comparison: MonthlyComparison?
    public let history: [MonthlySummary]

    public let savingsCapacity: Money
    public let emergencyFund: EmergencyFundPlan
    public let goalPlans: [GoalPlan]
    public let allocation: AllocationPlan
    public let cashFlow: CashFlowForecast
    public let debtOverview: DebtOverview
    public let insights: [Insight]
    public let optimization: OptimizationPlan
    public let investment: InvestmentGuidance

    public static func make(
        profile: FinancialProfile,
        month: YearMonth? = nil,
        referenceDate: Date = Date(),
        historyMonths: Int = 6
    ) -> FinancialAnalysis {

        let targetMonth = month ?? YearMonth(date: referenceDate)

        let summary = BudgetEngine.summary(
            for: targetMonth,
            profile: profile,
            referenceDate: referenceDate
        )

        let previousSummary = BudgetEngine.summary(
            for: targetMonth.previous,
            profile: profile,
            referenceDate: referenceDate
        )
        let hasPreviousData = !previousSummary.income.isZero || !previousSummary.totalExpenses.isZero

        let capacity = BudgetEngine.savingsCapacity(summary: summary, preferences: profile.preferences)

        let emergencyFund = EmergencyFundEngine.plan(
            profile: profile,
            summary: summary,
            horizonMonths: 24
        )

        let goalPlans = GoalEngine.plans(
            profile: profile,
            capacity: capacity,
            referenceDate: referenceDate
        )

        let allocation = AllocationEngine.plan(
            profile: profile,
            summary: summary,
            emergencyFund: emergencyFund,
            goalPlans: goalPlans,
            referenceDate: referenceDate
        )

        let cashFlow = CashFlowEngine.forecast(
            month: targetMonth,
            profile: profile,
            summary: summary,
            referenceDate: referenceDate
        )

        let debtOverview = DebtEngine.overview(profile: profile, monthlyIncome: summary.income)

        let insights = InsightEngine.insights(
            profile: profile,
            summary: summary,
            previousSummary: hasPreviousData ? previousSummary : nil,
            emergencyFund: emergencyFund,
            goalPlans: goalPlans,
            cashFlow: cashFlow,
            referenceDate: referenceDate
        )

        let optimization = OptimizationEngine.plan(
            profile: profile,
            summary: summary,
            referenceDate: referenceDate
        )

        let investment = InvestmentEngine.guidance(
            profile: profile,
            summary: summary,
            emergencyFund: emergencyFund,
            allocation: allocation
        )

        return FinancialAnalysis(
            profile: profile,
            month: targetMonth,
            referenceDate: referenceDate,
            summary: summary,
            previousSummary: hasPreviousData ? previousSummary : nil,
            comparison: hasPreviousData
                ? BudgetEngine.comparison(current: summary, previous: previousSummary)
                : nil,
            history: BudgetEngine.history(
                profile: profile,
                endingAt: targetMonth,
                months: historyMonths,
                referenceDate: referenceDate
            ),
            savingsCapacity: capacity,
            emergencyFund: emergencyFund,
            goalPlans: goalPlans,
            allocation: allocation,
            cashFlow: cashFlow,
            debtOverview: debtOverview,
            insights: insights,
            optimization: optimization,
            investment: investment
        )
    }
}
