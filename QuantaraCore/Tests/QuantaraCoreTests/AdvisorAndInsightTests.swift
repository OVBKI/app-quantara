import XCTest
@testable import QuantaraCore

final class MoneyTests: XCTestCase {

    func testDecimalArithmeticDoesNotDrift() {
        // Le motif exact pour lequel `Decimal` remplace `Double` : en binaire,
        // 0,1 + 0,2 != 0,3, et l'écart devient visible sur un total de transactions.
        let cents = (1...10).map { _ in Money(Decimal(string: "0.10") ?? 0) }
        XCTAssertEqual(Money.sum(cents, currency: .eur), Money(1))
    }

    func testBankersRoundingDoesNotDriftUpwards() {
        XCTAssertEqual(Money(Decimal(string: "2.345") ?? 0).rounded().amount, Decimal(string: "2.34"))
        XCTAssertEqual(Money(Decimal(string: "2.355") ?? 0).rounded().amount, Decimal(string: "2.36"))
    }

    func testRatioAgainstZeroIsNilNotZero() {
        // Renvoyer 0 confondrait « indéterminé » et « nul » — deux affichages différents.
        XCTAssertNil(Money(100).ratio(to: Money(0)))
        XCTAssertEqual(Money(50).ratio(to: Money(200)), Decimal(string: "0.25"))
    }

    func testClampedToZeroNeverPropagatesNegativeAmounts() {
        XCTAssertEqual(Money(-50).clampedToZero, Money(0))
        XCTAssertEqual(Money(50).clampedToZero, Money(50))
    }
}

final class YearMonthTests: XCTestCase {

    func testMonthArithmeticCrossesYearBoundaries() {
        XCTAssertEqual(YearMonth(year: 2026, month: 12).next, YearMonth(year: 2027, month: 1))
        XCTAssertEqual(YearMonth(year: 2026, month: 1).previous, YearMonth(year: 2025, month: 12))
        XCTAssertEqual(YearMonth(year: 2026, month: 3).adding(months: -14), YearMonth(year: 2025, month: 1))
    }

    func testMonthsUntil() {
        let from = YearMonth(year: 2026, month: 1)
        let to = YearMonth(year: 2028, month: 1)
        XCTAssertEqual(from.months(until: to), 24)
    }

    func testDayIsClampedToTheLastDayOfTheMonth() {
        // Un prélèvement au 31 doit tomber le 28 en février, pas déborder sur mars.
        let february = YearMonth(year: 2026, month: 2)
        let date = february.date(day: 31)
        XCTAssertEqual(Calendar.gregorianUTC.component(.day, from: date), 28)
    }

    func testLastMonthsAreOrderedFromOldestToNewest() {
        let months = YearMonth(year: 2026, month: 3).lastMonths(3)
        XCTAssertEqual(months, [
            YearMonth(year: 2026, month: 1),
            YearMonth(year: 2026, month: 2),
            YearMonth(year: 2026, month: 3)
        ])
    }
}

final class InsightEngineTests: XCTestCase {

    private let month = YearMonth(year: 2026, month: 3)
    private var referenceDate: Date { YearMonth(year: 2026, month: 3).date(day: 28) }

    func testSubscriptionLoadIsFlaggedAboveThreshold() {
        // §12 : « Vous avez plusieurs abonnements représentant 87 €/mois. »
        var profile = AllocationEngineTests.standardProfile()
        profile.recurringExpenses.append(
            RecurringExpense(name: "Divers abonnements", amount: Money(87),
                             category: .subscriptions, isSubscription: true)
        )
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)

        XCTAssertTrue(analysis.insights.contains { $0.kind == .subscriptionLoad })
    }

    func testHeavyFixedExpensesAreFlagged() {
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(2000))],
            recurringExpenses: [RecurringExpense(name: "Loyer", amount: Money(1200), category: .rent)]
        )
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)
        XCTAssertTrue(analysis.insights.contains { $0.kind == .fixedExpenseLoad })
    }

    func testExcessiveDebtRatioIsCritical() {
        var profile = AllocationEngineTests.standardProfile()
        profile.debts = [
            Debt(name: "Crédit", outstandingPrincipal: Money(40000),
                 annualRate: Decimal(string: "0.05") ?? 0, monthlyPayment: Money(1500))
        ]
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)

        let insight = analysis.insights.first { $0.kind == .debtLoad }
        XCTAssertNotNil(insight)
        XCTAssertEqual(insight?.severity, .critical)
    }

    func testDuplicateCreditEntryIsDetected() {
        // Une dette et une charge fixe de même mensualité comptent le crédit deux fois.
        var profile = AllocationEngineTests.standardProfile()
        profile.debts = [
            Debt(name: "Crédit auto", kind: .carLoan, outstandingPrincipal: Money(9000),
                 annualRate: Decimal(string: "0.04") ?? 0, monthlyPayment: Money(300))
        ]
        profile.recurringExpenses.append(
            RecurringExpense(name: "Crédit voiture", amount: Money(300), category: .carLoan)
        )
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)

        XCTAssertTrue(analysis.insights.contains { $0.kind == .duplicateDebtEntry })
    }

    func testInsightsAreSortedBySeverity() {
        var profile = AllocationEngineTests.standardProfile()
        profile.debts = [
            Debt(name: "Crédit", outstandingPrincipal: Money(40000),
                 annualRate: Decimal(string: "0.05") ?? 0, monthlyPayment: Money(1500))
        ]
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)

        let severities = analysis.insights.map(\.severity.rank)
        XCTAssertEqual(severities, severities.sorted(by: >))
    }

    func testEveryInsightCarriesAMessage() {
        let analysis = FinancialAnalysis.make(
            profile: AllocationEngineTests.standardProfile(),
            month: month,
            referenceDate: referenceDate
        )
        for insight in analysis.insights {
            XCTAssertFalse(insight.title.isEmpty)
            XCTAssertFalse(insight.message.isEmpty)
        }
    }
}

final class CategorizerTests: XCTestCase {

    func testNormalizationStripsBankingNoise() {
        let normalized = Categorizer.normalize("CB CARREFOUR MARKET 12/03 CARTE 4567")
        XCTAssertTrue(normalized.contains("CARREFOUR"))
        XCTAssertFalse(normalized.contains("CB"))
        XCTAssertFalse(normalized.contains("4567"))
    }

    /// §20 : « CARREFOUR 85,32 € » → Courses, « TOTAL 65 € » → Essence,
    /// « NETFLIX 17,99 € » → Abonnement.
    func testSpecificationExamplesAreCategorized() {
        XCTAssertEqual(Categorizer.categorize(label: "CARREFOUR")?.category, .variable(.groceries))
        XCTAssertEqual(Categorizer.categorize(label: "TOTAL")?.category, .variable(.fuel))
        XCTAssertEqual(Categorizer.categorize(label: "NETFLIX")?.category, .fixed(.subscriptions))
        XCTAssertEqual(Categorizer.categorize(label: "NETFLIX")?.isSubscription, true)
    }

    func testMoreSpecificRulesWinOverGenericOnes() {
        // « TOTALENERGIES ELEC » est une facture d'électricité, pas du carburant.
        XCTAssertEqual(
            Categorizer.categorize(label: "PRLV TOTALENERGIES ELEC")?.category,
            .fixed(.electricity)
        )
    }

    func testUserRulesOverrideBuiltInOnes() {
        let rule = CategorizationRule(
            pattern: "CARREFOUR",
            category: .variable(.shopping),
            isUserDefined: true
        )
        let result = Categorizer.categorize(label: "CARREFOUR CITY", userRules: [rule])
        XCTAssertEqual(result?.category, .variable(.shopping))
        XCTAssertEqual(result?.confidence, 1)
    }

    func testUnknownLabelsReturnNilRatherThanAWrongGuess() {
        // Mieux vaut ne pas catégoriser que fausser le budget en silence.
        XCTAssertNil(Categorizer.categorize(label: "ZZQX INCONNU"))
    }

    func testRecurringPaymentsAreDetected() {
        let month = YearMonth(year: 2026, month: 1)
        let transactions = (0..<4).map { index in
            Transaction(
                date: month.adding(months: index).date(day: 5),
                amount: Money(30),
                kind: .expense,
                category: .fixed(.subscriptions),
                label: "SPOTIFY"
            )
        }
        let detected = Categorizer.detectRecurrences(in: transactions)
        XCTAssertEqual(detected.count, 1)
        XCTAssertEqual(detected.first?.suggestedFrequency, .monthly)
        XCTAssertEqual(detected.first?.occurrences, 4)
    }
}

final class FinancialFactsTests: XCTestCase {

    private let month = YearMonth(year: 2026, month: 3)
    private var referenceDate: Date { YearMonth(year: 2026, month: 3).date(day: 28) }

    func testFactsPackSerializesToValidJSON() throws {
        let analysis = FinancialAnalysis.make(
            profile: AllocationEngineTests.standardProfile(),
            month: month,
            referenceDate: referenceDate
        )
        let facts = FinancialFactsBuilder.build(from: analysis)
        let json = try FinancialFactsBuilder.json(facts)

        let parsed = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        XCTAssertNotNil(parsed?["summary"])
        XCTAssertNotNil(parsed?["allocation"])
        XCTAssertNotNil(parsed?["emergencyFund"])
    }

    func testAggregatedModeStripsTransactionLabels() {
        var profile = AllocationEngineTests.standardProfile()
        profile.recurringExpenses.append(
            RecurringExpense(name: "Crédit auto BNP", amount: Money(300),
                             category: .carLoan, dayOfMonth: 10)
        )
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: month.date(day: 1))

        let aggregated = FinancialFactsBuilder.build(from: analysis, privacy: .aggregated)
        XCTAssertFalse(aggregated.cashFlow.upcomingEvents.contains { $0.label.contains("BNP") })

        let detailed = FinancialFactsBuilder.build(from: analysis, privacy: .detailed)
        XCTAssertTrue(detailed.cashFlow.upcomingEvents.contains { $0.label.contains("BNP") })
    }

    func testMissingDataIsReportedRatherThanSilentlyAssumed() {
        // Règle §22.4 : le modèle doit pouvoir dire « je ne sais pas » plutôt que supposer.
        let analysis = FinancialAnalysis.make(
            profile: FinancialProfile(),
            month: month,
            referenceDate: referenceDate
        )
        let facts = FinancialFactsBuilder.build(from: analysis)
        XCTAssertFalse(facts.missingData.isEmpty)
    }

    func testAssumptionsAreAlwaysPresent() {
        let analysis = FinancialAnalysis.make(
            profile: AllocationEngineTests.standardProfile(),
            month: month,
            referenceDate: referenceDate
        )
        let facts = FinancialFactsBuilder.build(from: analysis)
        XCTAssertFalse(facts.assumptions.isEmpty)
    }

    func testRatiosAreExposedAsPercentagePointsNotFractions() {
        // « 51,2 » se lit sans ambiguïté ; « 0,512 » se confond avec un montant.
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(4000))],
            recurringExpenses: [RecurringExpense(name: "Loyer", amount: Money(2000), category: .rent)]
        )
        let analysis = FinancialAnalysis.make(profile: profile, month: month, referenceDate: referenceDate)
        let facts = FinancialFactsBuilder.build(from: analysis)

        XCTAssertEqual(facts.summary.fixedExpenseRatioPercent, 50)
    }
}

final class AdvisorToolRunnerTests: XCTestCase {

    private let month = YearMonth(year: 2026, month: 3)

    private func runner() -> AdvisorToolRunner {
        AdvisorToolRunner(
            analysis: FinancialAnalysis.make(
                profile: AllocationEngineTests.standardProfile(),
                month: month,
                referenceDate: month.date(day: 28)
            )
        )
    }

    private func decode(_ json: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    func testUnknownToolReturnsAnExplicitError() throws {
        let output = try decode(runner().run(tool: "does_not_exist", input: [:]))
        XCTAssertNotNil(output["error"])
    }

    func testOutOfRangeHorizonIsRejectedRatherThanComputed() throws {
        // Une projection sur 500 ans produirait un chiffre spectaculaire et absurde.
        let output = try decode(
            runner().run(tool: "simulate_savings", input: ["monthly_amount": 500, "years": 500])
        )
        XCTAssertNotNil(output["error"])
    }

    func testNegativeAmountIsRejected() throws {
        let output = try decode(
            runner().run(tool: "simulate_savings", input: ["monthly_amount": -100, "years": 10])
        )
        XCTAssertNotNil(output["error"])
    }

    func testSavingsSimulationReturnsAmountsAndAssumptions() throws {
        let output = try decode(
            runner().run(tool: "simulate_savings", input: ["monthly_amount": 500, "years": 10])
        )
        XCTAssertNil(output["error"])
        XCTAssertNotNil(output["final_amount"])
        XCTAssertNotNil(output["assumptions"])
    }

    func testGoalPlanningReturnsAlternativesWhenInfeasible() throws {
        let output = try decode(
            runner().run(tool: "plan_goal", input: ["target_amount": 100_000, "months": 12])
        )
        XCTAssertEqual(output["is_feasible"] as? Bool, false)
        XCTAssertNotNil(output["alternatives"])
    }

    func testInvalidCategoryIdentifierIsRejected() throws {
        let output = try decode(
            runner().run(tool: "category_breakdown", input: ["category_id": "pas_une_categorie"])
        )
        XCTAssertNotNil(output["error"])
    }

    func testAffordabilityCheckReturnsAVerdict() throws {
        let output = try decode(
            runner().run(tool: "affordability_check", input: ["amount": 2000])
        )
        XCTAssertNotNil(output["verdict"])
        XCTAssertNotNil(output["reasons"])
    }

    func testEveryDeclaredToolHasASchema() {
        let schemaNames = Set(AdvisorToolSchemas.all.compactMap { $0["name"] as? String })
        for tool in AdvisorTool.allCases {
            XCTAssertTrue(schemaNames.contains(tool.rawValue), "Schéma manquant pour \(tool.rawValue)")
        }
    }
}
