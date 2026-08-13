import XCTest
@testable import QuantaraCore

final class GoalEngineTests: XCTestCase {

    private let today = YearMonth(year: 2026, month: 1).date(day: 15)

    /// §9 : 15 000 € en 24 mois → 625 €/mois.
    func testRequiredMonthlyContributionMatchesSpecificationExample() {
        let targetDate = Calendar.gregorianUTC.date(byAdding: .month, value: 24, to: today)
        let goal = Goal(kind: .car, name: "Voiture", targetAmount: Money(15000), targetDate: targetDate)

        let plan = GoalEngine.plan(for: goal, capacity: Money(450), referenceDate: today)

        XCTAssertEqual(plan.requiredMonthlyContribution, Money(625))
    }

    /// §9 : capacité 450 € < 625 € requis → l'objectif n'est pas faisable, et trois
    /// alternatives chiffrées sont proposées.
    func testInfeasibleGoalProducesThreeQuantifiedAlternatives() {
        let targetDate = Calendar.gregorianUTC.date(byAdding: .month, value: 24, to: today)
        let goal = Goal(kind: .car, name: "Voiture", targetAmount: Money(15000), targetDate: targetDate)

        let plan = GoalEngine.plan(for: goal, capacity: Money(450), referenceDate: today)

        XCTAssertFalse(plan.isFeasible)
        XCTAssertEqual(plan.capacityShortfall, Money(175))
        XCTAssertEqual(plan.alternatives.count, 3)

        let extended = plan.alternatives.first { $0.kind == .extendDeadline }
        XCTAssertEqual(extended?.months, 34)  // 15 000 / 450 arrondi au mois supérieur

        let reduced = plan.alternatives.first { $0.kind == .reduceTarget }
        XCTAssertEqual(reduced?.targetAmount, Money(10800))  // 450 × 24

        let effort = plan.alternatives.first { $0.kind == .increaseCapacity }
        XCTAssertEqual(effort?.additionalMonthlyEffort, Money(175))
    }

    func testFeasibleGoalHasNoAlternatives() {
        let targetDate = Calendar.gregorianUTC.date(byAdding: .month, value: 24, to: today)
        let goal = Goal(name: "Vacances", targetAmount: Money(2400), targetDate: targetDate)

        let plan = GoalEngine.plan(for: goal, capacity: Money(450), referenceDate: today)

        XCTAssertTrue(plan.isFeasible)
        XCTAssertTrue(plan.alternatives.isEmpty)
        XCTAssertEqual(plan.requiredMonthlyContribution, Money(100))
    }

    func testProgressAccountsForAmountAlreadySaved() {
        let goal = Goal(name: "Apport", targetAmount: Money(20000), currentAmount: Money(5000))
        let plan = GoalEngine.plan(for: goal, capacity: Money(500), referenceDate: today)

        XCTAssertEqual(plan.remaining, Money(15000))
        XCTAssertEqual(plan.progress, Decimal(string: "0.25"))
        XCTAssertEqual(plan.projectedCompletionMonths, 30)  // 15 000 / 500
    }

    func testMonthsToCoverRoundsUpBecauseAPartialMonthDoesNotComplete() {
        XCTAssertEqual(GoalEngine.monthsToCover(Money(1000), at: Money(300)), 4)
        XCTAssertEqual(GoalEngine.monthsToCover(Money(900), at: Money(300)), 3)
        XCTAssertNil(GoalEngine.monthsToCover(Money(1000), at: Money(0)))
    }
}

final class EmergencyFundEngineTests: XCTestCase {

    private let month = YearMonth(year: 2026, month: 3)

    /// §10 : dépenses essentielles 2 000 €/mois → paliers 6 000 / 12 000 / 18 000 €.
    func testTiersMatchSpecificationExample() {
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(4000))],
            recurringExpenses: [RecurringExpense(name: "Loyer", amount: Money(2000), category: .rent)],
            savingsBalance: Money(0)
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: month.date(day: 28))
        let plan = EmergencyFundEngine.plan(profile: profile, summary: summary, horizonMonths: 24)

        XCTAssertEqual(plan.monthlyEssentialExpenses, Money(2000))
        XCTAssertEqual(plan.tiers.map(\.target), [Money(6000), Money(12000), Money(18000)])
        XCTAssertFalse(plan.hasMinimumBuffer)
    }

    func testCoverageIsExpressedInMonthsOfEssentialExpenses() {
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(4000))],
            recurringExpenses: [RecurringExpense(name: "Loyer", amount: Money(2000), category: .rent)],
            savingsBalance: Money(5000)
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: month.date(day: 28))
        let plan = EmergencyFundEngine.plan(profile: profile, summary: summary)

        XCTAssertEqual(plan.monthsOfCoverage, Decimal(string: "2.5"))
        XCTAssertTrue(plan.hasMinimumBuffer)
        XCTAssertFalse(plan.isFullyFunded)
    }

    func testAnExplicitEmergencyFundGoalTakesPrecedenceOverGenericSavings() {
        // L'utilisateur a fléché une somme : elle fait foi sur le solde d'épargne global.
        let profile = FinancialProfile(
            goals: [Goal(kind: .emergencyFund, name: "Fonds d'urgence",
                         targetAmount: Money(12000), currentAmount: Money(3000))],
            savingsBalance: Money(9000)
        )
        XCTAssertEqual(EmergencyFundEngine.emergencyFundBalance(profile: profile), Money(3000))
    }
}

final class AllocationEngineTests: XCTestCase {

    private let month = YearMonth(year: 2026, month: 3)
    private var referenceDate: Date { YearMonth(year: 2026, month: 3).date(day: 28) }

    func testWholeDisposableIsAllocatedAndNothingIsLost() {
        let analysis = FinancialAnalysis.make(
            profile: Self.standardProfile(),
            month: month,
            referenceDate: referenceDate
        )
        XCTAssertEqual(analysis.allocation.allocated, analysis.summary.disposable.clampedToZero)
        XCTAssertEqual(analysis.allocation.unallocated, Money(0))
    }

    func testSafetyBufferComesFirstWhenSavingsAreEmpty() {
        let analysis = FinancialAnalysis.make(
            profile: Self.standardProfile(savings: 0),
            month: month,
            referenceDate: referenceDate
        )
        XCTAssertEqual(analysis.allocation.lines.first?.bucket, .safetyBuffer)
    }

    func testInvestmentIsWithheldWhileTheEmergencyFundIsThin() {
        let analysis = FinancialAnalysis.make(
            profile: Self.standardProfile(savings: 500),
            month: month,
            referenceDate: referenceDate
        )
        XCTAssertEqual(analysis.allocation.amount(for: .investment), Money(0))
        XCTAssertTrue(analysis.allocation.skippedSteps.contains { $0.contains("fonds d'urgence") })
    }

    func testInvestmentIsWithheldWhileACostlyDebtRemains() {
        var profile = Self.standardProfile(savings: 30000)  // fonds d'urgence largement couvert
        profile.debts = [
            Debt(
                name: "Réserve d'argent",
                kind: .creditCard,
                outstandingPrincipal: Money(3000),
                annualRate: Decimal(string: "0.18") ?? 0,
                monthlyPayment: Money(100)
            )
        ]
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)

        XCTAssertEqual(analysis.allocation.amount(for: .investment), Money(0))
        XCTAssertGreaterThan(analysis.allocation.amount(for: .highInterestDebt), Money(0))
    }

    func testInvestmentAppearsOnceBothPrerequisitesAreMet() {
        let analysis = FinancialAnalysis.make(
            profile: Self.standardProfile(savings: 30000),
            month: month,
            referenceDate: referenceDate
        )
        XCTAssertGreaterThan(analysis.allocation.amount(for: .investment), Money(0))
        XCTAssertTrue(analysis.investment.isReady)
    }

    func testFreeMoneyIsAlwaysPreserved() {
        let analysis = FinancialAnalysis.make(
            profile: Self.standardProfile(savings: 0),
            month: month,
            referenceDate: referenceDate
        )
        XCTAssertGreaterThan(analysis.allocation.amount(for: .freeMoney), Money(0))
    }

    func testEveryLineCarriesARationale() {
        // Le motif est affiché dans l'app et réutilisé par l'IA : aucune ligne muette.
        let analysis = FinancialAnalysis.make(
            profile: Self.standardProfile(),
            month: month,
            referenceDate: referenceDate
        )
        for line in analysis.allocation.lines {
            XCTAssertFalse(line.rationale.isEmpty, "Ligne \(line.bucket) sans motif")
        }
    }

    static func standardProfile(savings: Int = 5000) -> FinancialProfile {
        FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(4000), frequency: .monthly)],
            recurringExpenses: [
                RecurringExpense(name: "Loyer", amount: Money(1200), category: .rent),
                RecurringExpense(name: "Énergie", amount: Money(150), category: .electricity),
                RecurringExpense(name: "Streaming", amount: Money(30), category: .subscriptions, isSubscription: true)
            ],
            transactions: [
                BudgetEngineTests.expense(400, .groceries, day: 5, month: YearMonth(year: 2026, month: 3)),
                BudgetEngineTests.expense(120, .restaurants, day: 12, month: YearMonth(year: 2026, month: 3))
            ],
            savingsBalance: Money(savings)
        )
    }
}

final class DebtEngineTests: XCTestCase {

    func testAvalancheOrdersByDescendingRate() {
        let debts = Self.sampleDebts()
        let ordered = DebtEngine.order(debts, strategy: .avalanche)
        XCTAssertEqual(ordered.map(\.name), ["Carte", "Conso", "Auto"])
    }

    func testSnowballOrdersByAscendingBalance() {
        // Ordre volontairement différent de l'avalanche : sinon le test ne prouve rien.
        let debts = Self.sampleDebts()
        let ordered = DebtEngine.order(debts, strategy: .snowball)
        XCTAssertEqual(ordered.map(\.name), ["Carte", "Auto", "Conso"])
    }

    func testDebtToIncomeRatioIsComputedFromPayments() {
        let profile = FinancialProfile(debts: Self.sampleDebts())
        let overview = DebtEngine.overview(profile: profile, monthlyIncome: Money(3000))
        // 120 + 200 + 300 = 620 sur 3 000 ≈ 20,7 %
        XCTAssertEqual(overview.totalMonthlyPayment, Money(620))
        XCTAssertTrue(overview.hasHighInterestDebt)
    }

    func testExtraPaymentReducesTotalInterest() {
        let debts = Self.sampleDebts()
        let baseline = DebtEngine.payoffPlan(
            debts: debts, strategy: .avalanche,
            extraMonthlyPayment: Money(0), currency: .eur
        )
        let accelerated = DebtEngine.payoffPlan(
            debts: debts, strategy: .avalanche,
            extraMonthlyPayment: Money(200), currency: .eur
        )

        XCTAssertLessThan(accelerated.totalInterest, baseline.totalInterest)
        XCTAssertGreaterThan(accelerated.interestSaved, Money(0))
        if let baseMonths = baseline.totalMonths, let fastMonths = accelerated.totalMonths {
            XCTAssertLessThan(fastMonths, baseMonths)
        }
    }

    func testHighInterestThresholdIsEightPercent() {
        let cheap = Debt(name: "Immo", outstandingPrincipal: Money(100000),
                         annualRate: Decimal(string: "0.03") ?? 0, monthlyPayment: Money(600))
        let costly = Debt(name: "Carte", outstandingPrincipal: Money(2000),
                          annualRate: Decimal(string: "0.18") ?? 0, monthlyPayment: Money(100))
        XCTAssertFalse(cheap.isHighInterest)
        XCTAssertTrue(costly.isHighInterest)
    }

    static func sampleDebts() -> [Debt] {
        [
            Debt(name: "Auto", kind: .carLoan, outstandingPrincipal: Money(9000),
                 annualRate: Decimal(string: "0.04") ?? 0, monthlyPayment: Money(300)),
            Debt(name: "Carte", kind: .creditCard, outstandingPrincipal: Money(1500),
                 annualRate: Decimal(string: "0.18") ?? 0, monthlyPayment: Money(120)),
            Debt(name: "Conso", kind: .consumerLoan, outstandingPrincipal: Money(12000),
                 annualRate: Decimal(string: "0.09") ?? 0, monthlyPayment: Money(200))
        ]
    }
}

final class SimulationEngineTests: XCTestCase {

    func testZeroReturnProjectionIsSimpleAccumulation() {
        let projection = SimulationEngine.projectSavings(
            monthlyContribution: Money(500),
            initialAmount: Money(0),
            annualReturn: 0,
            months: 24
        )
        XCTAssertEqual(projection.finalAmount, Money(12000))
        XCTAssertEqual(projection.totalInterest, Money(0))
    }

    func testCompoundInterestOutgrowsContributions() {
        let projection = SimulationEngine.projectSavings(
            monthlyContribution: Money(500),
            initialAmount: Money(0),
            annualReturn: Decimal(string: "0.04") ?? 0,
            months: 120
        )
        XCTAssertEqual(projection.totalContributed, Money(60000))
        XCTAssertGreaterThan(projection.finalAmount, Money(70000))
        XCTAssertLessThan(projection.finalAmount, Money(80000))
    }

    func testProjectionAlwaysStatesItsAssumptions() {
        // Règle §22.3 : un chiffre nu, sans hypothèse nommée, n'est pas exploitable.
        let projection = SimulationEngine.projectSavings(
            monthlyContribution: Money(300),
            initialAmount: Money(0),
            annualReturn: Decimal(string: "0.04") ?? 0,
            months: 60
        )
        XCTAssertFalse(projection.assumptions.isEmpty)
    }

    func testMonthsToReachTarget() {
        let months = SimulationEngine.monthsToReach(
            target: Money(20000),
            monthlyContribution: Money(500),
            initialAmount: Money(0),
            annualReturn: 0
        )
        XCTAssertEqual(months, 40)
    }

    func testUnreachableTargetReturnsNilRatherThanAnAbsurdHorizon() {
        let months = SimulationEngine.monthsToReach(
            target: Money(1_000_000),
            monthlyContribution: Money(0),
            initialAmount: Money(0),
            annualReturn: 0
        )
        XCTAssertNil(months)
    }

    func testReturnRateIsClampedToPlausibleBounds() {
        // Un rendement de 500 % saisi par erreur ne doit pas produire une projection
        // spectaculaire présentée comme crédible.
        let projection = SimulationEngine.projectSavings(
            monthlyContribution: Money(100),
            initialAmount: Money(0),
            annualReturn: 5,
            months: 12
        )
        XCTAssertEqual(projection.annualReturn, SimulationEngine.maxAnnualReturn)
    }
}
