import Foundation

/// Niveau de partage consenti par l'utilisateur (§17, RGPD).
public enum AdvisorPrivacyLevel: String, Codable, CaseIterable, Sendable {
    /// Aucun envoi. Le conseil reste produit localement par les moteurs déterministes.
    case localOnly
    /// Envoi d'agrégats seulement : montants par catégorie et ratios. Ni libellé,
    /// ni marchand, ni date précise — le pack seul ne permet pas de réidentifier un achat.
    case aggregated
    /// Ajoute les libellés, uniquement pour la catégorisation automatique.
    case detailed

    public var localizationKey: String { "privacy.\(rawValue)" }
    public var allowsNetwork: Bool { self != .localOnly }
    public var allowsRawLabels: Bool { self == .detailed }
}

// MARK: - Pack de faits

/// Ensemble des chiffres transmis au modèle.
///
/// C'est la pièce maîtresse du dispositif anti-hallucination : le prompt système interdit
/// d'énoncer un montant absent de ce pack ou d'un résultat d'outil. Tous les nombres
/// proviennent de `QuantaraCore`, donc de fonctions couvertes par des tests.
public struct FinancialFacts: Codable, Sendable {

    public struct Period: Codable, Sendable {
        public let month: String
        public let currency: String
        public let today: String
        public let daysRemainingInMonth: Int
    }

    public struct Summary: Codable, Sendable {
        public let monthlyIncome: Decimal
        public let fixedExpenses: Decimal
        public let variableExpenses: Decimal
        public let variableSpentToDate: Decimal
        public let variableIsProjected: Bool
        public let debtPayments: Decimal
        public let savings: Decimal
        public let totalExpenses: Decimal
        public let disposable: Decimal
        public let essentialExpenses: Decimal
        public let subscriptionsTotal: Decimal
        public let savingsCapacity: Decimal
        public let savingsRatePercent: Decimal?
        public let fixedExpenseRatioPercent: Decimal?
        public let debtToIncomeRatioPercent: Decimal?
        public let safeToSpendPerDay: Decimal
        public let safeToSpendTotal: Decimal
    }

    public struct Comparison: Codable, Sendable {
        public let previousMonth: String
        public let incomeChange: Decimal
        public let expenseChange: Decimal
        public let savingsChange: Decimal
        public let savingsRateChangePoints: Decimal?
    }

    public struct CategoryFact: Codable, Sendable {
        public let category: String
        public let amount: Decimal
        public let sharePercent: Decimal
        public let changeVersusThreeMonthAveragePercent: Decimal?
        public let isEssential: Bool
    }

    public struct AllocationFact: Codable, Sendable {
        public let bucket: String
        public let amount: Decimal
        public let target: String?
        public let rationale: String
    }

    public struct EmergencyFundFact: Codable, Sendable {
        public let monthlyEssentialExpenses: Decimal
        public let currentBalance: Decimal
        public let monthsOfCoverage: Decimal
        public let selectedTargetMonths: Int
        public let selectedTargetAmount: Decimal
        public let remainingToTarget: Decimal
        public let tiers: [Tier]

        public struct Tier: Codable, Sendable {
            public let months: Int
            public let target: Decimal
            public let isReached: Bool
        }
    }

    public struct GoalFact: Codable, Sendable {
        public let name: String
        public let kind: String
        public let targetAmount: Decimal
        public let currentAmount: Decimal
        public let remainingAmount: Decimal
        public let progressPercent: Decimal
        public let targetDate: String?
        public let monthsUntilTarget: Int?
        public let requiredMonthlyContribution: Decimal?
        public let isFeasible: Bool
        public let capacityShortfall: Decimal?
        public let projectedCompletionMonths: Int?
    }

    public struct DebtFact: Codable, Sendable {
        public let name: String
        public let kind: String
        public let outstandingPrincipal: Decimal
        public let annualRatePercent: Decimal
        public let monthlyPayment: Decimal
        public let monthlyInterest: Decimal
        public let isHighInterest: Bool
        public let avalancheOrder: Int
    }

    public struct InsightFact: Codable, Sendable {
        public let kind: String
        public let severity: String
        public let title: String
        public let message: String
        public let magnitude: Decimal?
    }

    public struct OptimizationFact: Codable, Sendable {
        public let title: String
        public let detail: String
        public let monthlySaving: Decimal
        public let effort: String
        public let confidencePercent: Decimal
    }

    public struct CashFlowFact: Codable, Sendable {
        public let startingBalance: Decimal
        public let lowestProjectedBalance: Decimal
        public let lowestBalanceDate: String?
        public let hasProjectedOverdraft: Bool
        public let endingBalance: Decimal
        public let upcomingEvents: [Event]

        public struct Event: Codable, Sendable {
            public let date: String
            public let label: String
            public let amount: Decimal
            public let kind: String
        }
    }

    public struct InvestmentReadinessFact: Codable, Sendable {
        public let isReady: Bool
        public let indicativeMonthlyCapacity: Decimal
        public let riskProfile: String
        public let horizonYears: Int
        public let blockingReasons: [String]
    }

    public let period: Period
    public let summary: Summary
    public let comparison: Comparison?
    public let topCategories: [CategoryFact]
    public let allocation: [AllocationFact]
    public let allocationSkipped: [String]
    public let emergencyFund: EmergencyFundFact
    public let goals: [GoalFact]
    public let debts: [DebtFact]
    public let insights: [InsightFact]
    public let optimization: [OptimizationFact]
    public let optimizationTotalMonthly: Decimal
    public let cashFlow: CashFlowFact
    public let investmentReadiness: InvestmentReadinessFact
    /// Hypothèses appliquées. Le modèle doit les nommer quand il s'appuie dessus (§22.3).
    public let assumptions: [String]
    /// Données manquantes. Le modèle doit les signaler plutôt que de supposer (§22.4).
    public let missingData: [String]
}

// MARK: - Construction

public enum FinancialFactsBuilder {

    public static func build(
        from analysis: FinancialAnalysis,
        privacy: AdvisorPrivacyLevel = .aggregated
    ) -> FinancialFacts {

        let profile = analysis.profile
        let summary = analysis.summary
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withFullDate]

        let period = FinancialFacts.Period(
            month: analysis.month.description,
            currency: profile.currency.rawValue,
            today: dateFormatter.string(from: analysis.referenceDate),
            daysRemainingInMonth: summary.daysRemaining
        )

        let summaryFact = FinancialFacts.Summary(
            monthlyIncome: round(summary.income),
            fixedExpenses: round(summary.fixedExpenses),
            variableExpenses: round(summary.variableExpenses),
            variableSpentToDate: round(summary.variableSpentToDate),
            variableIsProjected: summary.isProjected,
            debtPayments: round(summary.debtPayments),
            savings: round(summary.savings),
            totalExpenses: round(summary.totalExpenses),
            disposable: round(summary.disposable),
            essentialExpenses: round(summary.essentialExpenses),
            subscriptionsTotal: round(summary.subscriptionsTotal),
            savingsCapacity: round(analysis.savingsCapacity),
            savingsRatePercent: percent(summary.savingsRate),
            fixedExpenseRatioPercent: percent(summary.fixedExpenseRatio),
            debtToIncomeRatioPercent: percent(summary.debtToIncomeRatio),
            safeToSpendPerDay: round(summary.safeToSpendPerDay),
            safeToSpendTotal: round(summary.safeToSpendTotal)
        )

        let comparison = analysis.comparison.map { value in
            FinancialFacts.Comparison(
                previousMonth: value.previous.description,
                incomeChange: round(value.incomeChange),
                expenseChange: round(value.expenseChange),
                savingsChange: round(value.savingsChange),
                savingsRateChangePoints: value.savingsRateChange.map { percent($0) ?? 0 }
            )
        }

        let categories = summary.categoryTotals.prefix(8).map { total in
            FinancialFacts.CategoryFact(
                category: total.category.id,
                amount: round(total.amount),
                sharePercent: percent(total.share) ?? 0,
                changeVersusThreeMonthAveragePercent: percent(total.changeVersusAverage),
                isEssential: total.category.isEssential
            )
        }

        let allocation = analysis.allocation.lines.map { line in
            FinancialFacts.AllocationFact(
                bucket: line.bucket.rawValue,
                amount: round(line.amount),
                target: line.targetName,
                rationale: line.rationale
            )
        }

        let emergency = FinancialFacts.EmergencyFundFact(
            monthlyEssentialExpenses: round(analysis.emergencyFund.monthlyEssentialExpenses),
            currentBalance: round(analysis.emergencyFund.currentBalance),
            monthsOfCoverage: round(analysis.emergencyFund.monthsOfCoverage, scale: 1),
            selectedTargetMonths: analysis.emergencyFund.selectedMonths,
            selectedTargetAmount: round(analysis.emergencyFund.selectedTarget),
            remainingToTarget: round(analysis.emergencyFund.remainingToTarget),
            tiers: analysis.emergencyFund.tiers.map {
                .init(months: $0.months, target: round($0.target), isReached: $0.isReached)
            }
        )

        let goals = analysis.goalPlans.map { plan in
            FinancialFacts.GoalFact(
                name: plan.goal.name,
                kind: plan.goal.kind.rawValue,
                targetAmount: round(plan.goal.targetAmount),
                currentAmount: round(plan.goal.currentAmount),
                remainingAmount: round(plan.remaining),
                progressPercent: percent(plan.progress) ?? 0,
                targetDate: plan.goal.targetDate.map { dateFormatter.string(from: $0) },
                monthsUntilTarget: plan.monthsUntilTarget,
                requiredMonthlyContribution: plan.requiredMonthlyContribution.map { round($0) },
                isFeasible: plan.isFeasible,
                capacityShortfall: plan.capacityShortfall.map { round($0) },
                projectedCompletionMonths: plan.projectedCompletionMonths
            )
        }

        let orderedDebts = DebtEngine.order(profile.activeDebts, strategy: .avalanche)
        let debts = orderedDebts.enumerated().map { index, debt in
            FinancialFacts.DebtFact(
                name: debt.name,
                kind: debt.kind.rawValue,
                outstandingPrincipal: round(debt.outstandingPrincipal),
                annualRatePercent: percent(debt.annualRate) ?? 0,
                monthlyPayment: round(debt.monthlyPayment),
                monthlyInterest: round(debt.monthlyInterest),
                isHighInterest: debt.isHighInterest,
                avalancheOrder: index + 1
            )
        }

        let insights = analysis.insights.prefix(8).map { insight in
            FinancialFacts.InsightFact(
                kind: insight.kind.rawValue,
                severity: insight.severity.rawValue,
                title: insight.title,
                message: insight.message,
                magnitude: insight.magnitude.map { round($0) }
            )
        }

        let optimization = analysis.optimization.opportunities.prefix(8).map { opportunity in
            FinancialFacts.OptimizationFact(
                title: opportunity.title,
                detail: opportunity.detail,
                monthlySaving: round(opportunity.monthlySaving),
                effort: opportunity.effort.rawValue,
                confidencePercent: percent(opportunity.confidence) ?? 0
            )
        }

        let cashFlow = FinancialFacts.CashFlowFact(
            startingBalance: round(analysis.cashFlow.startingBalance),
            lowestProjectedBalance: round(analysis.cashFlow.lowestBalance),
            lowestBalanceDate: analysis.cashFlow.lowestBalanceDate.map { dateFormatter.string(from: $0) },
            hasProjectedOverdraft: analysis.cashFlow.hasProjectedOverdraft,
            endingBalance: round(analysis.cashFlow.endingBalance),
            upcomingEvents: analysis.cashFlow.upcomingEvents.prefix(6).map { event in
                .init(
                    date: dateFormatter.string(from: event.date),
                    // En mode agrégé, le libellé est remplacé par le type d'échéance :
                    // « Crédit auto BNP » en dit trop sur la personne.
                    label: privacy.allowsRawLabels ? event.label : event.kind.rawValue,
                    amount: round(event.amount),
                    kind: event.kind.rawValue
                )
            }
        )

        let investment = FinancialFacts.InvestmentReadinessFact(
            isReady: analysis.investment.isReady,
            indicativeMonthlyCapacity: round(analysis.investment.indicativeMonthlyCapacity),
            riskProfile: analysis.investment.riskProfile.rawValue,
            horizonYears: analysis.investment.horizonYears,
            blockingReasons: analysis.investment.blockingReasons
        )

        var assumptions = [
            "Les revenus et charges non mensuels sont convertis en équivalent mensuel (montant × occurrences annuelles ÷ 12).",
            "Rendement annuel supposé pour les projections : \(percent(profile.preferences.assumedAnnualReturn) ?? 0) %.",
            "Inflation annuelle supposée : \(percent(profile.preferences.assumedAnnualInflation) ?? 0) %.",
            "Une marge d'argent libre de \(percent(profile.preferences.minimumFreeMoneyShare) ?? 0) % du disponible est réservée avant toute affectation."
        ]
        if summary.isProjected {
            assumptions.append("Les dépenses variables du mois en cours sont projetées à partir du rythme observé ; \(round(summary.variableSpentToDate)) sont réellement constatées à ce jour.")
        }
        if profile.preferences.usesIrregularIncomeSmoothing {
            assumptions.append("Revenus déclarés irréguliers : la base retenue est la médiane des \(profile.preferences.smoothingWindowMonths) derniers mois encaissés.")
        }

        return FinancialFacts(
            period: period,
            summary: summaryFact,
            comparison: comparison,
            topCategories: Array(categories),
            allocation: allocation,
            allocationSkipped: analysis.allocation.skippedSteps,
            emergencyFund: emergency,
            goals: goals,
            debts: debts,
            insights: Array(insights),
            optimization: Array(optimization),
            optimizationTotalMonthly: round(analysis.optimization.totalMonthlySaving),
            cashFlow: cashFlow,
            investmentReadiness: investment,
            assumptions: assumptions,
            missingData: profile.missingData.map(\.factDescription)
        )
    }

    /// Sérialisation JSON du pack, destinée au contexte du modèle.
    public static func json(_ facts: FinancialFacts) throws -> String {
        let encoder = JSONEncoder()
        // Clés triées : le préfixe de prompt reste stable d'un appel à l'autre, ce qui
        // permet au cache de prompt de fonctionner (un ordre variable l'invaliderait).
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(facts)
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: Arrondis

    private static func round(_ money: Money, scale: Int = 2) -> Decimal {
        money.rounded(scale: scale, mode: .plain).amount
    }

    private static func round(_ value: Decimal, scale: Int = 2) -> Decimal {
        var input = value
        var result = Decimal()
        NSDecimalRound(&result, &input, scale, .plain)
        return result
    }

    /// Convertit un ratio en points de pourcentage — le modèle raisonne mieux sur
    /// « 51,2 » que sur « 0,512 », et l'ambiguïté ratio/pourcentage disparaît.
    private static func percent(_ ratio: Decimal?) -> Decimal? {
        guard let ratio else { return nil }
        return round(ratio * 100, scale: 1)
    }
}
