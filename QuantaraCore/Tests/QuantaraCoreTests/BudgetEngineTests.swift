import XCTest
@testable import QuantaraCore

/// Les exemples chiffrés du cahier des charges sont repris tels quels comme cas de test :
/// si l'un d'eux casse, c'est une régression fonctionnelle, pas un détail d'implémentation.
final class FrequencyConversionTests: XCTestCase {

    func testAnnualInsuranceBecomesHundredPerMonth() {
        // §4 : « Assurance annuelle : 1 200 € → 100 €/mois »
        let premium = Money(1200)
        XCTAssertEqual(Frequency.annual.monthlyEquivalent(of: premium), Money(100))
    }

    func testMonthlyFrequencyIsIdentity() {
        XCTAssertEqual(Frequency.monthly.monthlyEquivalent(of: Money(3000)), Money(3000))
    }

    func testWeeklyUsesFiftyTwoWeeksNotFour() {
        // 52/12 = 4,333… — l'approximation « 4 semaines » sous-estimerait de 8 %.
        let weekly = Money(100)
        let monthly = Frequency.weekly.monthlyEquivalent(of: weekly)
        XCTAssertEqual(monthly.rounded().amount, Decimal(string: "433.33"))
    }

    func testDailyUsesThreeHundredSixtyFiveDays() {
        let daily = Money(10)
        let monthly = Frequency.daily.monthlyEquivalent(of: daily)
        XCTAssertEqual(monthly.rounded().amount, Decimal(string: "304.17"))
    }

    func testOneOffIsNeverSpreadAcrossMonths() {
        XCTAssertEqual(Frequency.oneOff.monthlyEquivalent(of: Money(500)), Money(0))
        XCTAssertFalse(Frequency.oneOff.isRecurring)
    }

    func testQuarterlyAndSemiannual() {
        XCTAssertEqual(Frequency.quarterly.monthlyEquivalent(of: Money(300)), Money(100))
        XCTAssertEqual(Frequency.semiannual.monthlyEquivalent(of: Money(600)), Money(100))
    }
}

final class BudgetEngineTests: XCTestCase {

    private let month = YearMonth(year: 2026, month: 3)
    private var referenceDate: Date { YearMonth(year: 2026, month: 3).date(day: 31) }

    /// §3 : salaire 3 000 + allocation 250 + locatif 800 = 4 050 €/mois.
    func testTotalMonthlyIncomeFromMixedSources() {
        let profile = FinancialProfile(
            incomes: [
                IncomeSource(name: "Salaire", amount: Money(3000), frequency: .monthly, category: .salary),
                IncomeSource(name: "Allocation", amount: Money(250), frequency: .monthly, category: .allowances),
                IncomeSource(name: "Loyer perçu", amount: Money(800), frequency: .monthly, category: .rental)
            ]
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        XCTAssertEqual(summary.income, Money(4050))
    }

    /// §7 : 4 000 − 2 000 − 700 = 1 300 € disponibles.
    func testDisposableIncomeMatchesSpecificationExample() {
        let profile = Self.profile(
            income: 4000,
            fixedExpenses: 2000,
            variableSpending: 700,
            month: month
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)

        XCTAssertEqual(summary.income, Money(4000))
        XCTAssertEqual(summary.fixedExpenses, Money(2000))
        XCTAssertEqual(summary.variableExpenses, Money(700))
        XCTAssertEqual(summary.disposable, Money(1300))
    }

    func testFixedExpenseRatioIsComputedAgainstIncome() {
        // §8 : « Vos dépenses fixes représentent 51 % de vos revenus. »
        let profile = Self.profile(income: 4200, fixedExpenses: 2142, variableSpending: 0, month: month)
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        let ratio = try? XCTUnwrap(summary.fixedExpenseRatio)
        XCTAssertEqual(ratio?.rounded(2), Decimal(string: "0.51"))
    }

    func testAnnualExpenseIsSpreadAcrossTheYear() {
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(2000))],
            recurringExpenses: [
                RecurringExpense(
                    name: "Assurance habitation",
                    amount: Money(1200),
                    frequency: .annual,
                    category: .homeInsurance
                )
            ]
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        XCTAssertEqual(summary.fixedExpenses, Money(100))
    }

    func testRecurringInstancesAreNotCountedTwice() {
        // Une transaction rattachée à une charge récurrente réalise cette charge :
        // elle ne doit pas s'y ajouter.
        let rent = RecurringExpense(name: "Loyer", amount: Money(900), category: .rent)
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(2000))],
            recurringExpenses: [rent],
            transactions: [
                Transaction(
                    date: month.date(day: 5),
                    amount: Money(900),
                    kind: .expense,
                    category: .fixed(.rent),
                    label: "Loyer mars",
                    recurringExpenseID: rent.id
                )
            ]
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        XCTAssertEqual(summary.fixedExpenses, Money(900))
        XCTAssertEqual(summary.variableExpenses, Money(0))
        XCTAssertEqual(summary.totalExpenses, Money(900))
    }

    func testEssentialExpensesExcludeDiscretionarySpending() {
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(3000))],
            recurringExpenses: [
                RecurringExpense(name: "Loyer", amount: Money(900), category: .rent),           // essentiel
                RecurringExpense(name: "Streaming", amount: Money(30), category: .subscriptions) // non essentiel
            ],
            transactions: [
                Self.expense(80, .groceries, day: 3, month: month),   // essentiel
                Self.expense(60, .restaurants, day: 4, month: month)  // non essentiel
            ]
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        XCTAssertEqual(summary.essentialExpenses, Money(980))  // 900 + 80
    }

    func testDebtPaymentsCountAsEssentialAndFeedTheDebtRatio() {
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(3000))],
            debts: [
                Debt(
                    name: "Crédit auto",
                    kind: .carLoan,
                    outstandingPrincipal: Money(9000),
                    annualRate: Decimal(string: "0.04") ?? 0,
                    monthlyPayment: Money(300)
                )
            ]
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        XCTAssertEqual(summary.debtPayments, Money(300))
        XCTAssertEqual(summary.essentialExpenses, Money(300))
        XCTAssertEqual(summary.debtToIncomeRatio?.rounded(2), Decimal(string: "0.1"))
    }

    func testPastMonthIsNeverProjected() {
        let pastMonth = YearMonth(year: 2026, month: 1)
        let profile = Self.profile(income: 2000, fixedExpenses: 500, variableSpending: 300, month: pastMonth)
        let summary = BudgetEngine.summary(for: pastMonth, profile: profile, referenceDate: referenceDate)
        XCTAssertFalse(summary.isProjected)
        XCTAssertEqual(summary.variableExpenses, summary.variableSpentToDate)
    }

    func testCurrentMonthProjectsFromObservedRunRate() {
        // 10 jours écoulés, 200 € dépensés → ~620 € projetés sur 31 jours.
        let midMonth = month.date(day: 10)
        let profile = FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(3000))],
            transactions: [Self.expense(200, .groceries, day: 3, month: month)]
        )
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: midMonth)

        XCTAssertTrue(summary.isProjected)
        XCTAssertEqual(summary.variableSpentToDate, Money(200))
        XCTAssertEqual(summary.variableExpenses.rounded().amount, Decimal(string: "620"))
    }

    func testSafeToSpendIsZeroWhenNothingRemains() {
        let profile = Self.profile(income: 1000, fixedExpenses: 1000, variableSpending: 0, month: month)
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: month.date(day: 15))
        XCTAssertEqual(summary.safeToSpendPerDay, Money(0))
    }

    func testSavingsCapacityAlwaysPreservesAFreeMoneyMargin() {
        // Une capacité d'épargne égale à 100 % du disponible n'est jamais tenable.
        let profile = Self.profile(income: 3000, fixedExpenses: 1500, variableSpending: 500, month: month)
        let summary = BudgetEngine.summary(for: month, profile: profile, referenceDate: referenceDate)
        let capacity = BudgetEngine.savingsCapacity(summary: summary, preferences: .default)

        XCTAssertEqual(summary.disposable, Money(1000))
        XCTAssertEqual(capacity, Money(900))  // 1 000 − 10 % de marge
        XCTAssertLessThan(capacity, summary.disposable)
    }

    // MARK: Fabriques

    static func profile(
        income: Int,
        fixedExpenses: Int,
        variableSpending: Int,
        month: YearMonth
    ) -> FinancialProfile {
        FinancialProfile(
            incomes: [IncomeSource(name: "Salaire", amount: Money(income), frequency: .monthly)],
            recurringExpenses: fixedExpenses > 0
                ? [RecurringExpense(name: "Charges", amount: Money(fixedExpenses), category: .rent)]
                : [],
            transactions: variableSpending > 0
                ? [expense(variableSpending, .groceries, day: 10, month: month)]
                : []
        )
    }

    static func expense(
        _ amount: Int,
        _ category: VariableExpenseCategory,
        day: Int,
        month: YearMonth
    ) -> Transaction {
        Transaction(
            date: month.date(day: day),
            amount: Money(amount),
            kind: .expense,
            category: .variable(category),
            label: category.rawValue
        )
    }
}

private extension Decimal {
    func rounded(_ scale: Int) -> Decimal {
        var input = self
        var result = Decimal()
        NSDecimalRound(&result, &input, scale, .plain)
        return result
    }
}
