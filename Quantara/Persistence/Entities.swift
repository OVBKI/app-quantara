import Foundation
import SwiftData
import QuantaraCore

// Modèles SwiftData.
//
// Contraintes imposées par la synchronisation CloudKit et respectées ici :
//  - tout attribut est optionnel ou possède une valeur par défaut ;
//  - aucune contrainte `.unique` ;
//  - les énumérations sont stockées en `String` brut, pour qu'un renommage Swift
//    ne casse pas le schéma persisté.
//
// Les vues ne manipulent jamais ces entités : `DataStore` les convertit en types
// valeur de `QuantaraCore`. L'UI reste ainsi indépendante du moteur de persistance.

@Model
final class SDAccount {
    var id: UUID = UUID()
    var name: String = ""
    var kindRaw: String = AccountKind.checking.rawValue
    var balance: Decimal = Decimal.zero
    var isIncludedInBudget: Bool = true

    init(id: UUID = UUID(), name: String, kindRaw: String, balance: Decimal, isIncludedInBudget: Bool) {
        self.id = id
        self.name = name
        self.kindRaw = kindRaw
        self.balance = balance
        self.isIncludedInBudget = isIncludedInBudget
    }
}

@Model
final class SDIncomeSource {
    var id: UUID = UUID()
    var name: String = ""
    var amount: Decimal = Decimal.zero
    var frequencyRaw: String = Frequency.monthly.rawValue
    var categoryRaw: String = IncomeCategory.salary.rawValue
    var dayOfMonth: Int?
    var startDate: Date = Date(timeIntervalSince1970: 0)
    var endDate: Date?
    var isActive: Bool = true
    var isVariable: Bool = false
    var notes: String?

    init(
        id: UUID = UUID(),
        name: String,
        amount: Decimal,
        frequencyRaw: String,
        categoryRaw: String,
        dayOfMonth: Int?,
        startDate: Date,
        endDate: Date?,
        isActive: Bool,
        isVariable: Bool,
        notes: String?
    ) {
        self.id = id
        self.name = name
        self.amount = amount
        self.frequencyRaw = frequencyRaw
        self.categoryRaw = categoryRaw
        self.dayOfMonth = dayOfMonth
        self.startDate = startDate
        self.endDate = endDate
        self.isActive = isActive
        self.isVariable = isVariable
        self.notes = notes
    }
}

@Model
final class SDRecurringExpense {
    var id: UUID = UUID()
    var name: String = ""
    var amount: Decimal = Decimal.zero
    var frequencyRaw: String = Frequency.monthly.rawValue
    var categoryRaw: String = FixedExpenseCategory.otherFixed.rawValue
    var dayOfMonth: Int?
    var isEssentialOverride: Bool?
    var isSubscription: Bool = false
    var startDate: Date = Date(timeIntervalSince1970: 0)
    var endDate: Date?
    var isActive: Bool = true
    var sharedRatio: Decimal = Decimal(1)
    var notes: String?

    init(
        id: UUID = UUID(),
        name: String,
        amount: Decimal,
        frequencyRaw: String,
        categoryRaw: String,
        dayOfMonth: Int?,
        isEssentialOverride: Bool?,
        isSubscription: Bool,
        startDate: Date,
        endDate: Date?,
        isActive: Bool,
        sharedRatio: Decimal,
        notes: String?
    ) {
        self.id = id
        self.name = name
        self.amount = amount
        self.frequencyRaw = frequencyRaw
        self.categoryRaw = categoryRaw
        self.dayOfMonth = dayOfMonth
        self.isEssentialOverride = isEssentialOverride
        self.isSubscription = isSubscription
        self.startDate = startDate
        self.endDate = endDate
        self.isActive = isActive
        self.sharedRatio = sharedRatio
        self.notes = notes
    }
}

@Model
final class SDTransaction {
    var id: UUID = UUID()
    var date: Date = Date()
    var amount: Decimal = Decimal.zero
    var kindRaw: String = TransactionKind.expense.rawValue
    /// Identifiant stable de catégorie : « variable.groceries », « fixed.rent ».
    var categoryID: String?
    var incomeCategoryRaw: String?
    var label: String = ""
    var accountID: UUID?
    var goalID: UUID?
    var debtID: UUID?
    var note: String?
    var tagsRaw: String = ""
    var merchantRaw: String?
    var recurringExpenseID: UUID?
    var incomeSourceID: UUID?
    var sharedRatio: Decimal = Decimal(1)
    var isExcludedFromBudget: Bool = false

    init(
        id: UUID = UUID(),
        date: Date,
        amount: Decimal,
        kindRaw: String,
        categoryID: String?,
        incomeCategoryRaw: String?,
        label: String,
        accountID: UUID?,
        goalID: UUID?,
        debtID: UUID?,
        note: String?,
        tagsRaw: String,
        merchantRaw: String?,
        recurringExpenseID: UUID?,
        incomeSourceID: UUID?,
        sharedRatio: Decimal,
        isExcludedFromBudget: Bool
    ) {
        self.id = id
        self.date = date
        self.amount = amount
        self.kindRaw = kindRaw
        self.categoryID = categoryID
        self.incomeCategoryRaw = incomeCategoryRaw
        self.label = label
        self.accountID = accountID
        self.goalID = goalID
        self.debtID = debtID
        self.note = note
        self.tagsRaw = tagsRaw
        self.merchantRaw = merchantRaw
        self.recurringExpenseID = recurringExpenseID
        self.incomeSourceID = incomeSourceID
        self.sharedRatio = sharedRatio
        self.isExcludedFromBudget = isExcludedFromBudget
    }
}

@Model
final class SDDebt {
    var id: UUID = UUID()
    var name: String = ""
    var kindRaw: String = DebtKind.consumerLoan.rawValue
    var outstandingPrincipal: Decimal = Decimal.zero
    var annualRate: Decimal = Decimal.zero
    var monthlyPayment: Decimal = Decimal.zero
    var remainingMonths: Int?
    var isRevolving: Bool = false
    var startDate: Date?
    var isActive: Bool = true

    init(
        id: UUID = UUID(),
        name: String,
        kindRaw: String,
        outstandingPrincipal: Decimal,
        annualRate: Decimal,
        monthlyPayment: Decimal,
        remainingMonths: Int?,
        isRevolving: Bool,
        startDate: Date?,
        isActive: Bool
    ) {
        self.id = id
        self.name = name
        self.kindRaw = kindRaw
        self.outstandingPrincipal = outstandingPrincipal
        self.annualRate = annualRate
        self.monthlyPayment = monthlyPayment
        self.remainingMonths = remainingMonths
        self.isRevolving = isRevolving
        self.startDate = startDate
        self.isActive = isActive
    }
}

@Model
final class SDGoal {
    var id: UUID = UUID()
    var kindRaw: String = GoalKind.custom.rawValue
    var name: String = ""
    var targetAmount: Decimal = Decimal.zero
    var currentAmount: Decimal = Decimal.zero
    var targetDate: Date?
    var priority: Int = 5
    var monthlyContribution: Decimal?
    var createdAt: Date = Date()
    var isArchived: Bool = false
    var notes: String?

    init(
        id: UUID = UUID(),
        kindRaw: String,
        name: String,
        targetAmount: Decimal,
        currentAmount: Decimal,
        targetDate: Date?,
        priority: Int,
        monthlyContribution: Decimal?,
        createdAt: Date,
        isArchived: Bool,
        notes: String?
    ) {
        self.id = id
        self.kindRaw = kindRaw
        self.name = name
        self.targetAmount = targetAmount
        self.currentAmount = currentAmount
        self.targetDate = targetDate
        self.priority = priority
        self.monthlyContribution = monthlyContribution
        self.createdAt = createdAt
        self.isArchived = isArchived
        self.notes = notes
    }
}

@Model
final class SDCategoryBudget {
    var id: UUID = UUID()
    var categoryID: String = ""
    var limitAmount: Decimal = Decimal.zero
    var rollover: Bool = false
    var isActive: Bool = true

    init(id: UUID = UUID(), categoryID: String, limitAmount: Decimal, rollover: Bool, isActive: Bool) {
        self.id = id
        self.categoryID = categoryID
        self.limitAmount = limitAmount
        self.rollover = rollover
        self.isActive = isActive
    }
}

@Model
final class SDCategorizationRule {
    var id: UUID = UUID()
    var pattern: String = ""
    var categoryID: String = ""
    var isSubscription: Bool = false

    init(id: UUID = UUID(), pattern: String, categoryID: String, isSubscription: Bool) {
        self.id = id
        self.pattern = pattern
        self.categoryID = categoryID
        self.isSubscription = isSubscription
    }
}

/// Message du conseiller. Conservé localement pour restituer l'historique de la
/// conversation ; jamais transmis à un tiers en dehors de l'appel en cours.
@Model
final class SDChatMessage {
    var id: UUID = UUID()
    var date: Date = Date()
    var isFromUser: Bool = true
    var text: String = ""
    /// Mois auquel se rapportait la conversation — les chiffres cités s'y réfèrent.
    var contextMonth: String = ""

    init(id: UUID = UUID(), date: Date, isFromUser: Bool, text: String, contextMonth: String) {
        self.id = id
        self.date = date
        self.isFromUser = isFromUser
        self.text = text
        self.contextMonth = contextMonth
    }
}

/// Réglages utilisateur. Une seule instance ; `DataStore` la crée à la demande.
@Model
final class SDUserSettings {
    var id: UUID = UUID()
    var currencyRaw: String = Currency.eur.rawValue
    var riskProfileRaw: String = RiskProfile.balanced.rawValue
    var investmentHorizonYears: Int = 10
    var emergencyFundMonths: Int = 6
    var usesIrregularIncomeSmoothing: Bool = false
    var smoothingWindowMonths: Int = 6
    var assumedAnnualReturn: Decimal = Decimal(string: "0.04") ?? Decimal.zero
    var assumedAnnualInflation: Decimal = Decimal(string: "0.02") ?? Decimal.zero
    var minimumFreeMoneyShare: Decimal = Decimal(string: "0.10") ?? Decimal.zero
    var householdSize: Int = 1
    var savingsBalance: Decimal = Decimal.zero
    var investmentsBalance: Decimal = Decimal.zero
    var estimatedMonthlyVariableSpending: Decimal?
    var hasCompletedOnboarding: Bool = false

    // Sécurité
    var isAppLockEnabled: Bool = false
    var autoLockMinutes: Int = 5

    // Confidentialité de l'IA — « local uniquement » par défaut : aucune donnée ne
    // quitte l'appareil tant que l'utilisateur n'a pas explicitement choisi autrement.
    var advisorPrivacyRaw: String = AdvisorPrivacyLevel.localOnly.rawValue
    var allowsModelTraining: Bool = false

    // Notifications
    var notificationsEnabled: Bool = false
    var notifyUpcomingDebits: Bool = true
    var notifyBudgetOverrun: Bool = true
    var notifyGoalMilestones: Bool = true
    var notifyMonthlyReport: Bool = true

    init(id: UUID = UUID()) {
        self.id = id
    }
}
