import Foundation

// MARK: - Résultats

public struct CategoryTotal: Hashable, Codable, Sendable, Identifiable {
    public let category: ExpenseCategory
    public let amount: Money
    /// Part dans le total des dépenses du mois.
    public let share: Decimal
    public let transactionCount: Int
    /// Écart relatif à la moyenne des mois précédents (`nil` si l'historique manque).
    public let changeVersusAverage: Decimal?

    public var id: String { category.id }

    public init(
        category: ExpenseCategory,
        amount: Money,
        share: Decimal,
        transactionCount: Int,
        changeVersusAverage: Decimal? = nil
    ) {
        self.category = category
        self.amount = amount
        self.share = share
        self.transactionCount = transactionCount
        self.changeVersusAverage = changeVersusAverage
    }
}

/// Synthèse budgétaire d'un mois. C'est l'objet que consomment le tableau de bord,
/// le pack de faits transmis à l'IA, et tous les autres moteurs.
public struct MonthlySummary: Hashable, Codable, Sendable {

    public let month: YearMonth
    public let currency: Currency

    public let income: Money
    public let fixedExpenses: Money
    public let variableExpenses: Money
    public let debtPayments: Money
    public let savings: Money

    /// Dépenses variables réellement constatées à ce jour (mois en cours).
    public let variableSpentToDate: Money
    /// Vrai si `variableExpenses` contient une part de projection.
    public let isProjected: Bool

    public let totalExpenses: Money
    /// Reste disponible : revenus − fixes − variables − dettes − épargne (§7).
    public let disposable: Money
    public let essentialExpenses: Money
    public let subscriptionsTotal: Money
    public let committedGoalContributions: Money

    public let savingsRate: Decimal?
    public let fixedExpenseRatio: Decimal?
    public let debtToIncomeRatio: Decimal?
    public let essentialRatio: Decimal?

    public let categoryTotals: [CategoryTotal]

    public let daysInMonth: Int
    public let daysElapsed: Int
    public let daysRemaining: Int
    /// Ce qu'il reste réellement dépensable aujourd'hui, par jour, une fois les charges
    /// et les engagements d'épargne provisionnés.
    public let safeToSpendPerDay: Money
    public let safeToSpendTotal: Money

    public var topExpenses: [CategoryTotal] { Array(categoryTotals.prefix(5)) }

    public var isBalanced: Bool { disposable.amount >= .zero }
}

/// Comparaison entre deux mois (§6, §15).
public struct MonthlyComparison: Hashable, Codable, Sendable {
    public let current: YearMonth
    public let previous: YearMonth
    public let incomeChange: Money
    public let expenseChange: Money
    public let savingsChange: Money
    public let disposableChange: Money
    public let savingsRateChange: Decimal?
    /// Catégories dont la dépense augmente, de la plus forte hausse à la plus faible.
    public let risingCategories: [CategoryTotal]
}

// MARK: - Moteur

/// Moteur de calcul budgétaire.
///
/// Fonctions pures : aucune E/S, aucun état. Chaque résultat est reproductible à partir
/// du profil et de la date de référence, ce qui rend l'ensemble testable et rejouable.
public enum BudgetEngine {

    /// Nombre de jours écoulés minimum avant de faire confiance au rythme de dépense
    /// observé. En dessous, deux jours atypiques suffiraient à doubler la projection.
    private static let minimumDaysForRunRate = 5

    // MARK: Synthèse mensuelle

    public static func summary(
        for month: YearMonth,
        profile: FinancialProfile,
        referenceDate: Date = Date(),
        calendar: Calendar = .gregorianUTC
    ) -> MonthlySummary {

        let currency = profile.currency
        let zero = Money(.zero, currency)

        let monthTransactions = profile.transactions(in: month)
        let daysInMonth = month.numberOfDays(calendar: calendar)
        let isCurrentMonth = month.contains(referenceDate, calendar: calendar)
        let isFutureMonth = month > YearMonth(date: referenceDate, calendar: calendar)

        let daysElapsed: Int
        if isCurrentMonth {
            daysElapsed = calendar.component(.day, from: referenceDate)
        } else if isFutureMonth {
            daysElapsed = 0
        } else {
            daysElapsed = daysInMonth
        }
        let daysRemaining = max(0, daysInMonth - daysElapsed)

        // --- Revenus ---
        let income = monthlyIncome(for: month, profile: profile, transactions: monthTransactions)

        // --- Dépenses fixes ---
        let recurring = profile.activeRecurringExpenses(in: month)
        let fixedExpenses = Money.sum(recurring.map(\.monthlyEquivalent), currency: currency)
        let subscriptionsTotal = Money.sum(
            recurring.filter(\.isSubscription).map(\.monthlyEquivalent),
            currency: currency
        )

        // --- Dépenses variables (réalisées puis projetées) ---
        let variableTransactions = monthTransactions.filter {
            $0.kind == .expense && !$0.isRecurringInstance
        }
        let variableSpentToDate = Money.sum(
            variableTransactions.map(\.effectiveAmount),
            currency: currency
        )
        let variableExpenses = projectedVariableSpending(
            spentToDate: variableSpentToDate,
            daysElapsed: daysElapsed,
            daysInMonth: daysInMonth,
            month: month,
            profile: profile,
            isCurrentOrFuture: isCurrentMonth || isFutureMonth
        )

        // --- Dettes ---
        // Les mensualités proviennent des dettes modélisées ; les transactions de
        // remboursement ne sont pas réadditionnées (elles les réalisent, elles ne s'y ajoutent pas).
        let debtPayments = Money.sum(profile.activeDebts.map(\.monthlyPayment), currency: currency)

        // --- Épargne ---
        let savings = Money.sum(
            monthTransactions.filter { $0.kind == .savings }.map(\.effectiveAmount),
            currency: currency
        )

        let totalExpenses = fixedExpenses + variableExpenses + debtPayments
        let disposable = income - totalExpenses - savings

        // --- Dépenses essentielles (base du fonds d'urgence) ---
        let essentialFixed = Money.sum(
            recurring.filter(\.isEssential).map(\.monthlyEquivalent),
            currency: currency
        )
        let essentialVariable = Money.sum(
            variableTransactions
                .filter { $0.category?.isEssential ?? false }
                .map(\.effectiveAmount),
            currency: currency
        )
        // Les mensualités de crédit sont incompressibles : elles font partie du socle.
        let essentialExpenses = essentialFixed + essentialVariable + debtPayments

        // --- Ratios ---
        let savingsRate: Decimal? = income.isZero
            ? nil
            : (savings + disposable.clampedToZero).amount / income.amount
        let fixedExpenseRatio = fixedExpenses.ratio(to: income)
        let debtToIncomeRatio = debtPayments.ratio(to: income)
        let essentialRatio = essentialExpenses.ratio(to: income)

        // --- Répartition par catégorie ---
        let categoryTotals = self.categoryTotals(
            month: month,
            profile: profile,
            transactions: variableTransactions,
            recurring: recurring,
            currency: currency
        )

        // --- Reste à vivre journalier ---
        let committedGoalContributions = Money.sum(
            profile.activeGoals.compactMap(\.monthlyContribution),
            currency: currency
        )
        let stillSpendable = (income
            - fixedExpenses
            - debtPayments
            - savings
            - committedGoalContributions
            - variableSpentToDate).clampedToZero
        let safeToSpendPerDay = daysRemaining > 0
            ? stillSpendable / Decimal(daysRemaining)
            : zero

        return MonthlySummary(
            month: month,
            currency: currency,
            income: income,
            fixedExpenses: fixedExpenses,
            variableExpenses: variableExpenses,
            debtPayments: debtPayments,
            savings: savings,
            variableSpentToDate: variableSpentToDate,
            isProjected: (isCurrentMonth || isFutureMonth) && variableExpenses > variableSpentToDate,
            totalExpenses: totalExpenses,
            disposable: disposable,
            essentialExpenses: essentialExpenses,
            subscriptionsTotal: subscriptionsTotal,
            committedGoalContributions: committedGoalContributions,
            savingsRate: savingsRate,
            fixedExpenseRatio: fixedExpenseRatio,
            debtToIncomeRatio: debtToIncomeRatio,
            essentialRatio: essentialRatio,
            categoryTotals: categoryTotals,
            daysInMonth: daysInMonth,
            daysElapsed: daysElapsed,
            daysRemaining: daysRemaining,
            safeToSpendPerDay: safeToSpendPerDay,
            safeToSpendTotal: stillSpendable
        )
    }

    // MARK: Revenus

    /// Revenus mensuels du mois.
    ///
    /// Base : équivalents mensuels des sources actives + revenus ponctuels non rattachés
    /// à une source (une prime saisie à la main s'ajoute ; un salaire déjà modélisé ne
    /// se compte pas deux fois).
    ///
    /// En mode revenus irréguliers, la base régulière est remplacée par la médiane
    /// glissante des revenus réellement encaissés — bâtir un budget sur le meilleur mois
    /// d'un indépendant est la façon la plus sûre de le mettre en difficulté.
    public static func monthlyIncome(
        for month: YearMonth,
        profile: FinancialProfile,
        transactions: [Transaction]? = nil
    ) -> Money {
        let currency = profile.currency
        let monthTransactions = transactions ?? profile.transactions(in: month)

        let oneOffIncome = Money.sum(
            monthTransactions
                .filter { $0.kind == .income && !$0.isModelledIncome }
                .map(\.effectiveAmount),
            currency: currency
        )

        if profile.preferences.usesIrregularIncomeSmoothing,
           let smoothed = smoothedIncomeBaseline(profile: profile, endingAt: month.previous) {
            return smoothed
        }

        let recurringIncome = Money.sum(
            profile.activeIncomes(in: month).map(\.monthlyEquivalent),
            currency: currency
        )
        return recurringIncome + oneOffIncome
    }

    /// Médiane des revenus réellement encaissés sur la fenêtre de lissage.
    /// `nil` si l'historique est trop court pour être significatif (< 3 mois).
    public static func smoothedIncomeBaseline(
        profile: FinancialProfile,
        endingAt month: YearMonth
    ) -> Money? {
        let window = max(3, profile.preferences.smoothingWindowMonths)
        let months = month.lastMonths(window)
        let realized: [Money] = months.compactMap { candidate in
            let transactions = profile.transactions(in: candidate).filter { $0.kind == .income }
            guard !transactions.isEmpty else { return nil }
            return Money.sum(transactions.map(\.effectiveAmount), currency: profile.currency)
        }
        guard realized.count >= 3 else { return nil }
        return realized.median(currency: profile.currency)
    }

    // MARK: Dépenses variables

    /// Projette la dépense variable de fin de mois.
    ///
    /// Trois régimes, du plus fiable au moins fiable :
    /// 1. mois clos → le réalisé ;
    /// 2. au moins 5 jours écoulés → extrapolation du rythme observé, jamais sous le réalisé ;
    /// 3. début de mois → moyenne historique, à défaut l'estimation d'onboarding.
    public static func projectedVariableSpending(
        spentToDate: Money,
        daysElapsed: Int,
        daysInMonth: Int,
        month: YearMonth,
        profile: FinancialProfile,
        isCurrentOrFuture: Bool
    ) -> Money {
        guard isCurrentOrFuture else { return spentToDate }

        let historical = averageVariableSpending(
            profile: profile,
            endingAt: month.previous,
            months: 3
        )

        guard daysElapsed >= minimumDaysForRunRate else {
            return historical ?? profile.estimatedMonthlyVariableSpending ?? spentToDate
        }

        let runRate = spentToDate / Decimal(daysElapsed) * Decimal(daysInMonth)
        return max(spentToDate, runRate)
    }

    /// Moyenne des dépenses variables réalisées sur les `months` derniers mois clos.
    public static func averageVariableSpending(
        profile: FinancialProfile,
        endingAt month: YearMonth,
        months: Int = 3
    ) -> Money? {
        let periods = month.lastMonths(months)
        let totals: [Money] = periods.compactMap { period in
            let transactions = profile.transactions(in: period)
                .filter { $0.kind == .expense && !$0.isRecurringInstance }
            guard !transactions.isEmpty else { return nil }
            return Money.sum(transactions.map(\.effectiveAmount), currency: profile.currency)
        }
        guard !totals.isEmpty else { return nil }
        return totals.mean(currency: profile.currency)
    }

    /// Historique mensuel d'une catégorie, du plus ancien au plus récent.
    public static func categoryHistory(
        _ category: ExpenseCategory,
        profile: FinancialProfile,
        endingAt month: YearMonth,
        months: Int
    ) -> [(month: YearMonth, amount: Money)] {
        month.lastMonths(months).map { period in
            let total: Money
            switch category {
            case .fixed(let fixedCategory):
                let recurring = profile.activeRecurringExpenses(in: period)
                    .filter { $0.category == fixedCategory }
                total = Money.sum(recurring.map(\.monthlyEquivalent), currency: profile.currency)
            case .variable:
                let matching = profile.transactions(in: period).filter {
                    $0.kind == .expense && $0.category == category
                }
                total = Money.sum(matching.map(\.effectiveAmount), currency: profile.currency)
            }
            return (period, total)
        }
    }

    // MARK: Répartition par catégorie

    private static func categoryTotals(
        month: YearMonth,
        profile: FinancialProfile,
        transactions: [Transaction],
        recurring: [RecurringExpense],
        currency: Currency
    ) -> [CategoryTotal] {

        var amounts: [ExpenseCategory: Money] = [:]
        var counts: [ExpenseCategory: Int] = [:]

        for expense in recurring {
            let category = ExpenseCategory.fixed(expense.category)
            amounts[category, default: Money(.zero, currency)] += expense.monthlyEquivalent
            counts[category, default: 0] += 1
        }

        for transaction in transactions {
            let category = transaction.category ?? .variable(.other)
            amounts[category, default: Money(.zero, currency)] += transaction.effectiveAmount
            counts[category, default: 0] += 1
        }

        let total = Money.sum(Array(amounts.values), currency: currency)

        return amounts
            .map { category, amount in
                let previousAverage = averageCategoryAmount(
                    category,
                    profile: profile,
                    endingAt: month.previous,
                    months: 3
                )
                let change: Decimal? = {
                    guard let previousAverage, previousAverage.amount > .zero else { return nil }
                    return (amount.amount - previousAverage.amount) / previousAverage.amount
                }()
                return CategoryTotal(
                    category: category,
                    amount: amount,
                    share: total.isZero ? 0 : amount.amount / total.amount,
                    transactionCount: counts[category] ?? 0,
                    changeVersusAverage: change
                )
            }
            .sorted { $0.amount > $1.amount }
    }

    /// Moyenne d'une catégorie sur les mois clos précédents.
    public static func averageCategoryAmount(
        _ category: ExpenseCategory,
        profile: FinancialProfile,
        endingAt month: YearMonth,
        months: Int = 3
    ) -> Money? {
        let history = categoryHistory(category, profile: profile, endingAt: month, months: months)
            .map(\.amount)
            .filter { !$0.isZero }
        guard !history.isEmpty else { return nil }
        return history.mean(currency: profile.currency)
    }

    // MARK: Comparaison et historique

    public static func comparison(
        current: MonthlySummary,
        previous: MonthlySummary
    ) -> MonthlyComparison {
        let savingsRateChange: Decimal? = {
            guard let currentRate = current.savingsRate, let previousRate = previous.savingsRate
            else { return nil }
            return currentRate - previousRate
        }()

        let previousByCategory = Dictionary(
            previous.categoryTotals.map { ($0.category, $0.amount) },
            uniquingKeysWith: { first, _ in first }
        )

        let rising = current.categoryTotals
            .filter { total in
                guard let before = previousByCategory[total.category] else { return false }
                return total.amount > before
            }
            .sorted { lhs, rhs in
                let lhsDelta = lhs.amount - (previousByCategory[lhs.category] ?? Money(.zero, lhs.amount.currency))
                let rhsDelta = rhs.amount - (previousByCategory[rhs.category] ?? Money(.zero, rhs.amount.currency))
                return lhsDelta > rhsDelta
            }

        return MonthlyComparison(
            current: current.month,
            previous: previous.month,
            incomeChange: current.income - previous.income,
            expenseChange: current.totalExpenses - previous.totalExpenses,
            savingsChange: current.savings - previous.savings,
            disposableChange: current.disposable - previous.disposable,
            savingsRateChange: savingsRateChange,
            risingCategories: Array(rising.prefix(5))
        )
    }

    /// Synthèses des `months` derniers mois, du plus ancien au plus récent.
    public static func history(
        profile: FinancialProfile,
        endingAt month: YearMonth,
        months: Int,
        referenceDate: Date = Date()
    ) -> [MonthlySummary] {
        month.lastMonths(months).map {
            summary(for: $0, profile: profile, referenceDate: referenceDate)
        }
    }

    // MARK: Capacité d'épargne

    /// Capacité d'épargne mensuelle : ce que l'utilisateur peut réellement mettre de côté,
    /// une fois toutes les charges honorées et une marge d'argent libre préservée.
    ///
    /// Un budget sans marge n'est pas tenu : on ne présente jamais 100 % du disponible
    /// comme épargnable.
    public static func savingsCapacity(
        summary: MonthlySummary,
        preferences: BudgetPreferences = .default
    ) -> Money {
        let disposable = summary.disposable.clampedToZero
        let freeMoneyFloor = disposable * preferences.minimumFreeMoneyShare
        return (disposable - freeMoneyFloor + summary.savings).clampedToZero
    }
}
