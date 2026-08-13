import Foundation

// MARK: - Compte

public enum AccountKind: String, Codable, CaseIterable, Sendable {
    case checking      // Compte courant
    case savings       // Épargne
    case investment    // Investissement
    case cash          // Espèces
    case credit        // Carte de crédit / réserve

    public var localizationKey: String { "account.kind.\(rawValue)" }

    /// Un compte d'investissement n'entre pas dans la trésorerie disponible du mois.
    public var countsAsLiquidity: Bool {
        switch self {
        case .checking, .cash: return true
        case .savings, .investment, .credit: return false
        }
    }
}

public struct Account: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var kind: AccountKind
    public var balance: Money
    public var isIncludedInBudget: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        kind: AccountKind = .checking,
        balance: Money,
        isIncludedInBudget: Bool = true
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.balance = balance
        self.isIncludedInBudget = isIncludedInBudget
    }
}

// MARK: - Source de revenu

public struct IncomeSource: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var amount: Money
    public var frequency: Frequency
    public var category: IncomeCategory
    /// Jour de réception dans le mois (1-31). Sert à la projection de trésorerie.
    public var dayOfMonth: Int?
    public var startDate: Date
    public var endDate: Date?
    public var isActive: Bool
    /// Revenu déclaré variable : le budget se base alors sur une médiane glissante.
    public var isVariable: Bool
    public var notes: String?

    public init(
        id: UUID = UUID(),
        name: String,
        amount: Money,
        frequency: Frequency = .monthly,
        category: IncomeCategory = .salary,
        dayOfMonth: Int? = nil,
        startDate: Date = Date(timeIntervalSince1970: 0),
        endDate: Date? = nil,
        isActive: Bool = true,
        isVariable: Bool = false,
        notes: String? = nil
    ) {
        self.id = id
        self.name = name
        self.amount = amount
        self.frequency = frequency
        self.category = category
        self.dayOfMonth = dayOfMonth
        self.startDate = startDate
        self.endDate = endDate
        self.isActive = isActive
        self.isVariable = isVariable
        self.notes = notes
    }

    public var monthlyEquivalent: Money {
        frequency.monthlyEquivalent(of: amount)
    }

    public func isActive(during month: YearMonth, calendar: Calendar = .gregorianUTC) -> Bool {
        guard isActive else { return false }
        if startDate > month.endDate(calendar: calendar) { return false }
        if let endDate, endDate < month.startDate(calendar: calendar) { return false }
        return true
    }
}

// MARK: - Dépense récurrente

public struct RecurringExpense: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var amount: Money
    public var frequency: Frequency
    public var category: FixedExpenseCategory
    /// Jour de prélèvement dans le mois (1-31).
    public var dayOfMonth: Int?
    /// Permet de contredire la valeur par défaut de la catégorie (ex. : un internet
    /// indispensable au télétravail devient essentiel).
    public var isEssentialOverride: Bool?
    public var isSubscription: Bool
    public var startDate: Date
    public var endDate: Date?
    public var isActive: Bool
    /// Part à la charge de l'utilisateur dans un foyer (1,0 = intégralité).
    public var sharedRatio: Decimal
    public var notes: String?

    public init(
        id: UUID = UUID(),
        name: String,
        amount: Money,
        frequency: Frequency = .monthly,
        category: FixedExpenseCategory,
        dayOfMonth: Int? = nil,
        isEssentialOverride: Bool? = nil,
        isSubscription: Bool = false,
        startDate: Date = Date(timeIntervalSince1970: 0),
        endDate: Date? = nil,
        isActive: Bool = true,
        sharedRatio: Decimal = 1,
        notes: String? = nil
    ) {
        self.id = id
        self.name = name
        self.amount = amount
        self.frequency = frequency
        self.category = category
        self.dayOfMonth = dayOfMonth
        self.isEssentialOverride = isEssentialOverride
        self.isSubscription = isSubscription
        self.startDate = startDate
        self.endDate = endDate
        self.isActive = isActive
        self.sharedRatio = sharedRatio
        self.notes = notes
    }

    public var isEssential: Bool { isEssentialOverride ?? category.isEssential }

    /// Équivalent mensuel effectivement supporté par l'utilisateur.
    public var monthlyEquivalent: Money {
        frequency.monthlyEquivalent(of: amount) * sharedRatio
    }

    public var annualEquivalent: Money {
        frequency.annualEquivalent(of: amount) * sharedRatio
    }

    public func isActive(during month: YearMonth, calendar: Calendar = .gregorianUTC) -> Bool {
        guard isActive else { return false }
        if startDate > month.endDate(calendar: calendar) { return false }
        if let endDate, endDate < month.startDate(calendar: calendar) { return false }
        return true
    }
}

// MARK: - Transaction

public enum TransactionKind: String, Codable, CaseIterable, Sendable {
    case income        // Entrée d'argent
    case expense       // Sortie d'argent
    case savings       // Mise de côté (sort du disponible sans être une dépense)
    case transfer      // Mouvement entre comptes, neutre budgétairement
    case debtPayment   // Remboursement de crédit

    public var localizationKey: String { "transaction.kind.\(rawValue)" }
    public var affectsBudget: Bool { self != .transfer }
}

public struct Transaction: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var date: Date
    /// Toujours positif : le sens est porté par `kind`, jamais par le signe.
    public var amount: Money
    public var kind: TransactionKind
    public var category: ExpenseCategory?
    public var incomeCategory: IncomeCategory?
    public var label: String
    public var accountID: UUID?
    public var goalID: UUID?
    public var debtID: UUID?
    public var note: String?
    public var tags: [String]
    /// Libellé bancaire brut, avant nettoyage. Jamais transmis en mode agrégé.
    public var merchantRaw: String?
    /// Instance d'une dépense récurrente : exclue des dépenses variables pour éviter
    /// de compter deux fois une charge déjà présente comme récurrente.
    public var recurringExpenseID: UUID?
    /// Réalisation d'une source de revenu déjà modélisée. Même logique : la source
    /// compte dans l'agrégat, la transaction ne doit pas s'y ajouter.
    public var incomeSourceID: UUID?
    public var sharedRatio: Decimal
    public var isExcludedFromBudget: Bool

    public init(
        id: UUID = UUID(),
        date: Date,
        amount: Money,
        kind: TransactionKind,
        category: ExpenseCategory? = nil,
        incomeCategory: IncomeCategory? = nil,
        label: String,
        accountID: UUID? = nil,
        goalID: UUID? = nil,
        debtID: UUID? = nil,
        note: String? = nil,
        tags: [String] = [],
        merchantRaw: String? = nil,
        recurringExpenseID: UUID? = nil,
        incomeSourceID: UUID? = nil,
        sharedRatio: Decimal = 1,
        isExcludedFromBudget: Bool = false
    ) {
        self.id = id
        self.date = date
        self.amount = amount
        self.kind = kind
        self.category = category
        self.incomeCategory = incomeCategory
        self.label = label
        self.accountID = accountID
        self.goalID = goalID
        self.debtID = debtID
        self.note = note
        self.tags = tags
        self.merchantRaw = merchantRaw
        self.recurringExpenseID = recurringExpenseID
        self.incomeSourceID = incomeSourceID
        self.sharedRatio = sharedRatio
        self.isExcludedFromBudget = isExcludedFromBudget
    }

    public var effectiveAmount: Money { amount * sharedRatio }
    public var isRecurringInstance: Bool { recurringExpenseID != nil }
    public var isModelledIncome: Bool { incomeSourceID != nil }

    public func belongs(to month: YearMonth, calendar: Calendar = .gregorianUTC) -> Bool {
        month.contains(date, calendar: calendar)
    }
}

// MARK: - Dette

public enum DebtKind: String, Codable, CaseIterable, Sendable {
    case mortgage
    case carLoan
    case consumerLoan
    case studentLoan
    case creditCard
    case overdraft
    case personal
    case other

    public var localizationKey: String { "debt.kind.\(rawValue)" }

    /// Une dette révolving (carte, découvert) se recharge : elle est traitée en priorité
    /// car son taux est presque toujours le plus élevé du portefeuille.
    public var isTypicallyRevolving: Bool {
        switch self {
        case .creditCard, .overdraft: return true
        default: return false
        }
    }
}

public struct Debt: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var kind: DebtKind
    public var outstandingPrincipal: Money
    /// TAEG exprimé en fraction décimale (0,079 = 7,9 %).
    public var annualRate: Decimal
    public var monthlyPayment: Money
    public var remainingMonths: Int?
    public var isRevolving: Bool
    public var startDate: Date?
    public var isActive: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        kind: DebtKind = .consumerLoan,
        outstandingPrincipal: Money,
        annualRate: Decimal,
        monthlyPayment: Money,
        remainingMonths: Int? = nil,
        isRevolving: Bool? = nil,
        startDate: Date? = nil,
        isActive: Bool = true
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.outstandingPrincipal = outstandingPrincipal
        self.annualRate = annualRate
        self.monthlyPayment = monthlyPayment
        self.remainingMonths = remainingMonths
        self.isRevolving = isRevolving ?? kind.isTypicallyRevolving
        self.startDate = startDate
        self.isActive = isActive
    }

    public var monthlyRate: Decimal { annualRate / 12 }

    /// Intérêts payés le mois prochain si rien ne change.
    public var monthlyInterest: Money { outstandingPrincipal * monthlyRate }

    /// Seuil au-delà duquel rembourser bat statistiquement un investissement diversifié
    /// après impôt. Fixé à 8 %, cohérent avec le rendement réel long terme d'un
    /// portefeuille équilibré.
    public static let highInterestThreshold = Decimal(string: "0.08") ?? 0

    public var isHighInterest: Bool { annualRate > Debt.highInterestThreshold }
}

// MARK: - Objectif

public enum GoalKind: String, Codable, CaseIterable, Sendable, Identifiable {
    case emergencyFund
    case vacation
    case car
    case home
    case downPayment
    case education
    case retirement
    case investment
    case personalProject
    case custom

    public var id: String { rawValue }
    public var localizationKey: String { "goal.kind.\(rawValue)" }

    /// Priorité intrinsèque (1 = plus haute). Le fonds d'urgence passe avant tout.
    public var defaultPriority: Int {
        switch self {
        case .emergencyFund:   return 1
        case .downPayment:     return 2
        case .home:            return 2
        case .education:       return 3
        case .retirement:      return 3
        case .car:             return 4
        case .investment:      return 4
        case .vacation:        return 5
        case .personalProject: return 5
        case .custom:          return 5
        }
    }

    public var symbolName: String {
        switch self {
        case .emergencyFund:   return "shield.lefthalf.filled"
        case .vacation:        return "beach.umbrella.fill"
        case .car:             return "car.fill"
        case .home:            return "house.fill"
        case .downPayment:     return "key.fill"
        case .education:       return "graduationcap.fill"
        case .retirement:      return "figure.walk.motion"
        case .investment:      return "chart.line.uptrend.xyaxis"
        case .personalProject: return "star.fill"
        case .custom:          return "target"
        }
    }
}

public struct Goal: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var kind: GoalKind
    public var name: String
    public var targetAmount: Money
    public var currentAmount: Money
    public var targetDate: Date?
    /// 1 = priorité maximale.
    public var priority: Int
    /// Contribution mensuelle choisie par l'utilisateur (à défaut, le moteur la calcule).
    public var monthlyContribution: Money?
    public var createdAt: Date
    public var isArchived: Bool
    public var notes: String?

    public init(
        id: UUID = UUID(),
        kind: GoalKind = .custom,
        name: String,
        targetAmount: Money,
        currentAmount: Money? = nil,
        targetDate: Date? = nil,
        priority: Int? = nil,
        monthlyContribution: Money? = nil,
        createdAt: Date = Date(),
        isArchived: Bool = false,
        notes: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.targetAmount = targetAmount
        self.currentAmount = currentAmount ?? Money.zero(targetAmount.currency)
        self.targetDate = targetDate
        self.priority = priority ?? kind.defaultPriority
        self.monthlyContribution = monthlyContribution
        self.createdAt = createdAt
        self.isArchived = isArchived
        self.notes = notes
    }

    public var remainingAmount: Money {
        (targetAmount - currentAmount).clampedToZero
    }

    public var progress: Decimal {
        guard targetAmount.amount > .zero else { return 0 }
        let ratio = currentAmount.amount / targetAmount.amount
        return min(max(ratio, 0), 1)
    }

    public var isComplete: Bool { currentAmount >= targetAmount }
}

// MARK: - Enveloppe budgétaire

public struct CategoryBudget: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var category: ExpenseCategory
    public var limit: Money
    /// Reporte le reliquat non consommé sur le mois suivant.
    public var rollover: Bool
    public var isActive: Bool

    public init(
        id: UUID = UUID(),
        category: ExpenseCategory,
        limit: Money,
        rollover: Bool = false,
        isActive: Bool = true
    ) {
        self.id = id
        self.category = category
        self.limit = limit
        self.rollover = rollover
        self.isActive = isActive
    }
}

// MARK: - Profil de risque

public enum RiskProfile: String, Codable, CaseIterable, Sendable, Identifiable {
    case conservative
    case balanced
    case dynamic
    case aggressive

    public var id: String { rawValue }
    public var localizationKey: String { "risk.\(rawValue)" }

    /// Part d'actifs volatils considérée comme cohérente avec le profil, à titre
    /// **éducatif** uniquement. Ce n'est pas une recommandation personnalisée.
    public var indicativeGrowthShare: Decimal {
        switch self {
        case .conservative: return Decimal(string: "0.20") ?? 0
        case .balanced:     return Decimal(string: "0.45") ?? 0
        case .dynamic:      return Decimal(string: "0.70") ?? 0
        case .aggressive:   return Decimal(string: "0.85") ?? 0
        }
    }

    /// Horizon minimal en dessous duquel ce profil n'a pas de sens.
    public var minimumHorizonYears: Int {
        switch self {
        case .conservative: return 2
        case .balanced:     return 5
        case .dynamic:      return 8
        case .aggressive:   return 10
        }
    }
}
