import Foundation

/// Préférences de calcul de l'utilisateur.
public struct BudgetPreferences: Hashable, Codable, Sendable {
    /// Objectif de couverture du fonds d'urgence, en mois de dépenses essentielles.
    public var emergencyFundMonths: Int
    /// Revenus irréguliers : le budget se base sur une médiane glissante plutôt que
    /// sur le dernier mois observé.
    public var usesIrregularIncomeSmoothing: Bool
    /// Fenêtre de lissage, en mois.
    public var smoothingWindowMonths: Int
    /// Rendement annuel par défaut des simulations (hypothèse, jamais une promesse).
    public var assumedAnnualReturn: Decimal
    /// Inflation annuelle par défaut des projections long terme.
    public var assumedAnnualInflation: Decimal
    /// Part minimale du disponible laissée en argent libre : un budget sans marge
    /// n'est pas tenu.
    public var minimumFreeMoneyShare: Decimal
    public var householdSize: Int

    public init(
        emergencyFundMonths: Int = 6,
        usesIrregularIncomeSmoothing: Bool = false,
        smoothingWindowMonths: Int = 6,
        assumedAnnualReturn: Decimal = Decimal(string: "0.04") ?? 0,
        assumedAnnualInflation: Decimal = Decimal(string: "0.02") ?? 0,
        minimumFreeMoneyShare: Decimal = Decimal(string: "0.10") ?? 0,
        householdSize: Int = 1
    ) {
        self.emergencyFundMonths = emergencyFundMonths
        self.usesIrregularIncomeSmoothing = usesIrregularIncomeSmoothing
        self.smoothingWindowMonths = smoothingWindowMonths
        self.assumedAnnualReturn = assumedAnnualReturn
        self.assumedAnnualInflation = assumedAnnualInflation
        self.minimumFreeMoneyShare = minimumFreeMoneyShare
        self.householdSize = householdSize
    }

    public static let `default` = BudgetPreferences()
}

/// Photographie complète de la situation financière de l'utilisateur.
///
/// C'est l'entrée unique de tous les moteurs : ils sont des fonctions pures de ce profil,
/// ce qui les rend testables et reproductibles.
public struct FinancialProfile: Hashable, Codable, Sendable {

    public var currency: Currency
    public var accounts: [Account]
    public var incomes: [IncomeSource]
    public var recurringExpenses: [RecurringExpense]
    public var transactions: [Transaction]
    public var debts: [Debt]
    public var goals: [Goal]
    public var categoryBudgets: [CategoryBudget]

    /// Épargne de précaution disponible immédiatement (livrets, comptes d'épargne).
    public var savingsBalance: Money
    /// Placements existants — hors fonds d'urgence.
    public var investmentsBalance: Money

    public var riskProfile: RiskProfile
    public var investmentHorizonYears: Int
    public var preferences: BudgetPreferences

    /// Estimation d'onboarding des dépenses variables, utilisée tant que l'historique
    /// réel est trop court pour être fiable.
    public var estimatedMonthlyVariableSpending: Money?

    public init(
        currency: Currency = .eur,
        accounts: [Account] = [],
        incomes: [IncomeSource] = [],
        recurringExpenses: [RecurringExpense] = [],
        transactions: [Transaction] = [],
        debts: [Debt] = [],
        goals: [Goal] = [],
        categoryBudgets: [CategoryBudget] = [],
        savingsBalance: Money? = nil,
        investmentsBalance: Money? = nil,
        riskProfile: RiskProfile = .balanced,
        investmentHorizonYears: Int = 10,
        preferences: BudgetPreferences = .default,
        estimatedMonthlyVariableSpending: Money? = nil
    ) {
        self.currency = currency
        self.accounts = accounts
        self.incomes = incomes
        self.recurringExpenses = recurringExpenses
        self.transactions = transactions
        self.debts = debts
        self.goals = goals
        self.categoryBudgets = categoryBudgets
        self.savingsBalance = savingsBalance ?? Money.zero(currency)
        self.investmentsBalance = investmentsBalance ?? Money.zero(currency)
        self.riskProfile = riskProfile
        self.investmentHorizonYears = investmentHorizonYears
        self.preferences = preferences
        self.estimatedMonthlyVariableSpending = estimatedMonthlyVariableSpending
    }

    public var zero: Money { Money.zero(currency) }

    // MARK: - Filtres usuels

    public var activeDebts: [Debt] { debts.filter(\.isActive) }
    public var activeGoals: [Goal] { goals.filter { !$0.isArchived } }

    public func activeIncomes(in month: YearMonth) -> [IncomeSource] {
        incomes.filter { $0.isActive(during: month) }
    }

    public func activeRecurringExpenses(in month: YearMonth) -> [RecurringExpense] {
        recurringExpenses.filter { $0.isActive(during: month) }
    }

    public func transactions(in month: YearMonth) -> [Transaction] {
        transactions.filter { $0.belongs(to: month) && !$0.isExcludedFromBudget }
    }

    /// Trésorerie immédiatement mobilisable (comptes courants et espèces).
    public var liquidity: Money {
        Money.sum(
            accounts.filter { $0.kind.countsAsLiquidity && $0.isIncludedInBudget }.map(\.balance),
            currency: currency
        )
    }

    /// Nombre de mois d'historique de transactions disponibles.
    public func historyDepth(endingAt month: YearMonth) -> Int {
        guard let earliest = transactions.map(\.date).min() else { return 0 }
        return max(0, YearMonth(date: earliest).months(until: month) + 1)
    }

    // MARK: - Complétude

    /// Ce que l'utilisateur n'a pas renseigné. Transmis tel quel à l'IA, qui a
    /// l'obligation de le signaler plutôt que de supposer en silence (règle §22.4).
    public var missingData: [MissingDataPoint] {
        var missing: [MissingDataPoint] = []
        if incomes.isEmpty { missing.append(.income) }
        if recurringExpenses.isEmpty { missing.append(.fixedExpenses) }
        if transactions.isEmpty && estimatedMonthlyVariableSpending == nil {
            missing.append(.variableExpenses)
        }
        if savingsBalance.isZero { missing.append(.savingsBalance) }
        if activeGoals.isEmpty { missing.append(.goals) }
        if debts.isEmpty { missing.append(.debts) }
        if accounts.isEmpty { missing.append(.accounts) }
        return missing
    }
}

public enum MissingDataPoint: String, Codable, CaseIterable, Sendable {
    case income
    case fixedExpenses
    case variableExpenses
    case savingsBalance
    case goals
    case debts
    case accounts

    public var localizationKey: String { "missing.\(rawValue)" }

    /// Description destinée au modèle. Rédigée pour être lue par le LLM, pas par
    /// l'utilisateur — l'app affiche la version localisée.
    public var factDescription: String {
        switch self {
        case .income:            return "Aucune source de revenu renseignée."
        case .fixedExpenses:     return "Aucune dépense fixe renseignée."
        case .variableExpenses:  return "Aucune dépense variable ni estimation renseignée."
        case .savingsBalance:    return "Épargne actuelle non renseignée (supposée nulle)."
        case .goals:             return "Aucun objectif financier défini."
        case .debts:             return "Aucune dette renseignée — l'absence n'est pas confirmée."
        case .accounts:          return "Aucun compte renseigné : le solde réel est inconnu."
        }
    }
}
