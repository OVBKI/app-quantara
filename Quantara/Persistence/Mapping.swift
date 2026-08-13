import Foundation
import QuantaraCore

// Conversion entités SwiftData ↔ types valeur du cœur métier.
//
// Cette frontière existe pour une raison : les vues et les moteurs ne voient que des
// types `Sendable` immuables. Remplacer SwiftData par autre chose ne toucherait que ce
// fichier et `DataStore`.

extension SDAccount {
    func toValue(currency: Currency) -> Account {
        Account(
            id: id,
            name: name,
            kind: AccountKind(rawValue: kindRaw) ?? .checking,
            balance: Money(balance, currency),
            isIncludedInBudget: isIncludedInBudget
        )
    }

    static func make(from value: Account) -> SDAccount {
        SDAccount(
            id: value.id,
            name: value.name,
            kindRaw: value.kind.rawValue,
            balance: value.balance.amount,
            isIncludedInBudget: value.isIncludedInBudget
        )
    }

    func apply(_ value: Account) {
        name = value.name
        kindRaw = value.kind.rawValue
        balance = value.balance.amount
        isIncludedInBudget = value.isIncludedInBudget
    }
}

extension SDIncomeSource {
    func toValue(currency: Currency) -> IncomeSource {
        IncomeSource(
            id: id,
            name: name,
            amount: Money(amount, currency),
            frequency: Frequency(rawValue: frequencyRaw) ?? .monthly,
            category: IncomeCategory(rawValue: categoryRaw) ?? .salary,
            dayOfMonth: dayOfMonth,
            startDate: startDate,
            endDate: endDate,
            isActive: isActive,
            isVariable: isVariable,
            notes: notes
        )
    }

    static func make(from value: IncomeSource) -> SDIncomeSource {
        SDIncomeSource(
            id: value.id,
            name: value.name,
            amount: value.amount.amount,
            frequencyRaw: value.frequency.rawValue,
            categoryRaw: value.category.rawValue,
            dayOfMonth: value.dayOfMonth,
            startDate: value.startDate,
            endDate: value.endDate,
            isActive: value.isActive,
            isVariable: value.isVariable,
            notes: value.notes
        )
    }

    func apply(_ value: IncomeSource) {
        name = value.name
        amount = value.amount.amount
        frequencyRaw = value.frequency.rawValue
        categoryRaw = value.category.rawValue
        dayOfMonth = value.dayOfMonth
        startDate = value.startDate
        endDate = value.endDate
        isActive = value.isActive
        isVariable = value.isVariable
        notes = value.notes
    }
}

extension SDRecurringExpense {
    func toValue(currency: Currency) -> RecurringExpense {
        RecurringExpense(
            id: id,
            name: name,
            amount: Money(amount, currency),
            frequency: Frequency(rawValue: frequencyRaw) ?? .monthly,
            category: FixedExpenseCategory(rawValue: categoryRaw) ?? .otherFixed,
            dayOfMonth: dayOfMonth,
            isEssentialOverride: isEssentialOverride,
            isSubscription: isSubscription,
            startDate: startDate,
            endDate: endDate,
            isActive: isActive,
            sharedRatio: sharedRatio,
            notes: notes
        )
    }

    static func make(from value: RecurringExpense) -> SDRecurringExpense {
        SDRecurringExpense(
            id: value.id,
            name: value.name,
            amount: value.amount.amount,
            frequencyRaw: value.frequency.rawValue,
            categoryRaw: value.category.rawValue,
            dayOfMonth: value.dayOfMonth,
            isEssentialOverride: value.isEssentialOverride,
            isSubscription: value.isSubscription,
            startDate: value.startDate,
            endDate: value.endDate,
            isActive: value.isActive,
            sharedRatio: value.sharedRatio,
            notes: value.notes
        )
    }

    func apply(_ value: RecurringExpense) {
        name = value.name
        amount = value.amount.amount
        frequencyRaw = value.frequency.rawValue
        categoryRaw = value.category.rawValue
        dayOfMonth = value.dayOfMonth
        isEssentialOverride = value.isEssentialOverride
        isSubscription = value.isSubscription
        startDate = value.startDate
        endDate = value.endDate
        isActive = value.isActive
        sharedRatio = value.sharedRatio
        notes = value.notes
    }
}

extension SDTransaction {
    func toValue(currency: Currency) -> Transaction {
        Transaction(
            id: id,
            date: date,
            amount: Money(amount, currency),
            kind: TransactionKind(rawValue: kindRaw) ?? .expense,
            category: categoryID.flatMap { ExpenseCategory(id: $0) },
            incomeCategory: incomeCategoryRaw.flatMap { IncomeCategory(rawValue: $0) },
            label: label,
            accountID: accountID,
            goalID: goalID,
            debtID: debtID,
            note: note,
            tags: tagsRaw.isEmpty ? [] : tagsRaw.split(separator: "\u{1F}").map(String.init),
            merchantRaw: merchantRaw,
            recurringExpenseID: recurringExpenseID,
            incomeSourceID: incomeSourceID,
            sharedRatio: sharedRatio,
            isExcludedFromBudget: isExcludedFromBudget
        )
    }

    static func make(from value: Transaction) -> SDTransaction {
        SDTransaction(
            id: value.id,
            date: value.date,
            amount: value.amount.amount,
            kindRaw: value.kind.rawValue,
            categoryID: value.category?.id,
            incomeCategoryRaw: value.incomeCategory?.rawValue,
            label: value.label,
            accountID: value.accountID,
            goalID: value.goalID,
            debtID: value.debtID,
            note: value.note,
            // Séparateur ASCII « unit separator » : il ne peut pas apparaître dans un
            // libellé saisi, contrairement à une virgule ou un point-virgule.
            tagsRaw: value.tags.joined(separator: "\u{1F}"),
            merchantRaw: value.merchantRaw,
            recurringExpenseID: value.recurringExpenseID,
            incomeSourceID: value.incomeSourceID,
            sharedRatio: value.sharedRatio,
            isExcludedFromBudget: value.isExcludedFromBudget
        )
    }

    func apply(_ value: Transaction) {
        date = value.date
        amount = value.amount.amount
        kindRaw = value.kind.rawValue
        categoryID = value.category?.id
        incomeCategoryRaw = value.incomeCategory?.rawValue
        label = value.label
        accountID = value.accountID
        goalID = value.goalID
        debtID = value.debtID
        note = value.note
        tagsRaw = value.tags.joined(separator: "\u{1F}")
        merchantRaw = value.merchantRaw
        recurringExpenseID = value.recurringExpenseID
        incomeSourceID = value.incomeSourceID
        sharedRatio = value.sharedRatio
        isExcludedFromBudget = value.isExcludedFromBudget
    }
}

extension SDDebt {
    func toValue(currency: Currency) -> Debt {
        Debt(
            id: id,
            name: name,
            kind: DebtKind(rawValue: kindRaw) ?? .consumerLoan,
            outstandingPrincipal: Money(outstandingPrincipal, currency),
            annualRate: annualRate,
            monthlyPayment: Money(monthlyPayment, currency),
            remainingMonths: remainingMonths,
            isRevolving: isRevolving,
            startDate: startDate,
            isActive: isActive
        )
    }

    static func make(from value: Debt) -> SDDebt {
        SDDebt(
            id: value.id,
            name: value.name,
            kindRaw: value.kind.rawValue,
            outstandingPrincipal: value.outstandingPrincipal.amount,
            annualRate: value.annualRate,
            monthlyPayment: value.monthlyPayment.amount,
            remainingMonths: value.remainingMonths,
            isRevolving: value.isRevolving,
            startDate: value.startDate,
            isActive: value.isActive
        )
    }

    func apply(_ value: Debt) {
        name = value.name
        kindRaw = value.kind.rawValue
        outstandingPrincipal = value.outstandingPrincipal.amount
        annualRate = value.annualRate
        monthlyPayment = value.monthlyPayment.amount
        remainingMonths = value.remainingMonths
        isRevolving = value.isRevolving
        startDate = value.startDate
        isActive = value.isActive
    }
}

extension SDGoal {
    func toValue(currency: Currency) -> Goal {
        Goal(
            id: id,
            kind: GoalKind(rawValue: kindRaw) ?? .custom,
            name: name,
            targetAmount: Money(targetAmount, currency),
            currentAmount: Money(currentAmount, currency),
            targetDate: targetDate,
            priority: priority,
            monthlyContribution: monthlyContribution.map { Money($0, currency) },
            createdAt: createdAt,
            isArchived: isArchived,
            notes: notes
        )
    }

    static func make(from value: Goal) -> SDGoal {
        SDGoal(
            id: value.id,
            kindRaw: value.kind.rawValue,
            name: value.name,
            targetAmount: value.targetAmount.amount,
            currentAmount: value.currentAmount.amount,
            targetDate: value.targetDate,
            priority: value.priority,
            monthlyContribution: value.monthlyContribution?.amount,
            createdAt: value.createdAt,
            isArchived: value.isArchived,
            notes: value.notes
        )
    }

    func apply(_ value: Goal) {
        kindRaw = value.kind.rawValue
        name = value.name
        targetAmount = value.targetAmount.amount
        currentAmount = value.currentAmount.amount
        targetDate = value.targetDate
        priority = value.priority
        monthlyContribution = value.monthlyContribution?.amount
        isArchived = value.isArchived
        notes = value.notes
    }
}

extension SDCategoryBudget {
    func toValue(currency: Currency) -> CategoryBudget? {
        guard let category = ExpenseCategory(id: categoryID) else { return nil }
        return CategoryBudget(
            id: id,
            category: category,
            limit: Money(limitAmount, currency),
            rollover: rollover,
            isActive: isActive
        )
    }

    static func make(from value: CategoryBudget) -> SDCategoryBudget {
        SDCategoryBudget(
            id: value.id,
            categoryID: value.category.id,
            limitAmount: value.limit.amount,
            rollover: value.rollover,
            isActive: value.isActive
        )
    }
}

extension SDCategorizationRule {
    func toValue() -> CategorizationRule? {
        guard let category = ExpenseCategory(id: categoryID) else { return nil }
        return CategorizationRule(
            id: id,
            pattern: pattern,
            category: category,
            isSubscription: isSubscription,
            isUserDefined: true
        )
    }
}

extension SDUserSettings {
    var currency: Currency { Currency(rawValue: currencyRaw) ?? .eur }
    var riskProfile: RiskProfile { RiskProfile(rawValue: riskProfileRaw) ?? .balanced }
    var advisorPrivacy: AdvisorPrivacyLevel {
        AdvisorPrivacyLevel(rawValue: advisorPrivacyRaw) ?? .localOnly
    }

    var preferences: BudgetPreferences {
        BudgetPreferences(
            emergencyFundMonths: emergencyFundMonths,
            usesIrregularIncomeSmoothing: usesIrregularIncomeSmoothing,
            smoothingWindowMonths: smoothingWindowMonths,
            assumedAnnualReturn: assumedAnnualReturn,
            assumedAnnualInflation: assumedAnnualInflation,
            minimumFreeMoneyShare: minimumFreeMoneyShare,
            householdSize: householdSize
        )
    }
}
