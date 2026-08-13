import Foundation
import SwiftData
import Observation
import QuantaraCore

/// Accès unique aux données.
///
/// Rôle : lire et écrire SwiftData, et exposer à l'interface un instantané immuable
/// (`FinancialProfile`) accompagné de son analyse complète. Aucun calcul financier ici —
/// tout vient de `QuantaraCore`.
@MainActor
@Observable
final class DataStore {

    private let context: ModelContext

    /// Instantané courant. Reconstruit après chaque mutation.
    private(set) var profile: FinancialProfile
    /// Analyse du mois sélectionné : tous les moteurs, calculés une seule fois.
    private(set) var analysis: FinancialAnalysis
    private(set) var settings: SDUserSettings
    private(set) var categorizationRules: [CategorizationRule] = []

    var selectedMonth: YearMonth {
        didSet { recomputeAnalysis() }
    }

    /// Date de référence injectable — les tests et les aperçus SwiftUI doivent pouvoir
    /// figer « aujourd'hui » sans quoi rien n'est reproductible.
    var referenceDate: Date {
        didSet { recomputeAnalysis() }
    }

    init(context: ModelContext, referenceDate: Date = Date()) {
        self.context = context
        self.referenceDate = referenceDate
        self.selectedMonth = YearMonth(date: referenceDate)

        let settings = Self.loadOrCreateSettings(in: context)
        self.settings = settings

        let profile = Self.buildProfile(context: context, settings: settings)
        self.profile = profile
        self.analysis = FinancialAnalysis.make(
            profile: profile,
            month: YearMonth(date: referenceDate),
            referenceDate: referenceDate
        )
        reloadRules()
    }

    // MARK: - Rechargement

    func reload() {
        settings = Self.loadOrCreateSettings(in: context)
        profile = Self.buildProfile(context: context, settings: settings)
        reloadRules()
        recomputeAnalysis()
    }

    private func recomputeAnalysis() {
        analysis = FinancialAnalysis.make(
            profile: profile,
            month: selectedMonth,
            referenceDate: referenceDate
        )
    }

    private func reloadRules() {
        let descriptor = FetchDescriptor<SDCategorizationRule>()
        categorizationRules = ((try? context.fetch(descriptor)) ?? []).compactMap { $0.toValue() }
    }

    private func save() {
        do {
            try context.save()
        } catch {
            // Une écriture qui échoue silencieusement produirait une app qui « oublie »
            // des dépenses. On la remonte au moins dans les journaux.
            assertionFailure("Échec d'enregistrement SwiftData : \(error)")
        }
        reload()
    }

    // MARK: - Revenus

    func add(_ income: IncomeSource) {
        context.insert(SDIncomeSource.make(from: income))
        save()
    }

    func update(_ income: IncomeSource) {
        guard let entity = fetchOne(SDIncomeSource.self, id: income.id) else { return }
        entity.apply(income)
        save()
    }

    func deleteIncome(id: UUID) {
        guard let entity = fetchOne(SDIncomeSource.self, id: id) else { return }
        context.delete(entity)
        save()
    }

    // MARK: - Dépenses récurrentes

    func add(_ expense: RecurringExpense) {
        context.insert(SDRecurringExpense.make(from: expense))
        save()
    }

    func update(_ expense: RecurringExpense) {
        guard let entity = fetchOne(SDRecurringExpense.self, id: expense.id) else { return }
        entity.apply(expense)
        save()
    }

    func deleteRecurringExpense(id: UUID) {
        guard let entity = fetchOne(SDRecurringExpense.self, id: id) else { return }
        context.delete(entity)
        save()
    }

    // MARK: - Transactions

    func add(_ transaction: Transaction) {
        context.insert(SDTransaction.make(from: transaction))
        applySideEffects(of: transaction)
        save()
    }

    func add(_ transactions: [Transaction]) {
        for transaction in transactions {
            context.insert(SDTransaction.make(from: transaction))
            applySideEffects(of: transaction)
        }
        save()
    }

    func update(_ transaction: Transaction) {
        guard let entity = fetchOne(SDTransaction.self, id: transaction.id) else { return }
        entity.apply(transaction)
        save()
    }

    func deleteTransaction(id: UUID) {
        guard let entity = fetchOne(SDTransaction.self, id: id) else { return }
        context.delete(entity)
        save()
    }

    /// Un versement rattaché à un objectif doit faire avancer cet objectif : sans cela,
    /// la progression affichée resterait figée alors que l'argent a bien été mis de côté.
    private func applySideEffects(of transaction: Transaction) {
        guard transaction.kind == .savings,
              let goalID = transaction.goalID,
              let goal = fetchOne(SDGoal.self, id: goalID)
        else { return }
        goal.currentAmount += transaction.effectiveAmount.amount
    }

    // MARK: - Dettes

    func add(_ debt: Debt) {
        context.insert(SDDebt.make(from: debt))
        save()
    }

    func update(_ debt: Debt) {
        guard let entity = fetchOne(SDDebt.self, id: debt.id) else { return }
        entity.apply(debt)
        save()
    }

    func deleteDebt(id: UUID) {
        guard let entity = fetchOne(SDDebt.self, id: id) else { return }
        context.delete(entity)
        save()
    }

    // MARK: - Objectifs

    func add(_ goal: Goal) {
        context.insert(SDGoal.make(from: goal))
        save()
    }

    func update(_ goal: Goal) {
        guard let entity = fetchOne(SDGoal.self, id: goal.id) else { return }
        entity.apply(goal)
        save()
    }

    func deleteGoal(id: UUID) {
        guard let entity = fetchOne(SDGoal.self, id: id) else { return }
        context.delete(entity)
        save()
    }

    func contribute(_ amount: Money, to goalID: UUID) {
        guard let goal = fetchOne(SDGoal.self, id: goalID) else { return }
        goal.currentAmount += amount.amount
        context.insert(
            SDTransaction.make(
                from: Transaction(
                    date: referenceDate,
                    amount: amount,
                    kind: .savings,
                    label: goal.name,
                    goalID: goalID
                )
            )
        )
        save()
    }

    // MARK: - Comptes

    func add(_ account: Account) {
        context.insert(SDAccount.make(from: account))
        save()
    }

    func update(_ account: Account) {
        guard let entity = fetchOne(SDAccount.self, id: account.id) else { return }
        entity.apply(account)
        save()
    }

    // MARK: - Enveloppes et règles

    func add(_ budget: CategoryBudget) {
        context.insert(SDCategoryBudget.make(from: budget))
        save()
    }

    func deleteCategoryBudget(id: UUID) {
        guard let entity = fetchOne(SDCategoryBudget.self, id: id) else { return }
        context.delete(entity)
        save()
    }

    /// Enregistre une correction de catégorisation comme règle permanente : corriger
    /// deux fois le même marchand serait une friction inutile.
    func learnCategorization(pattern: String, category: ExpenseCategory, isSubscription: Bool = false) {
        let normalized = Categorizer.normalize(pattern)
        guard !normalized.isEmpty else { return }
        context.insert(
            SDCategorizationRule(
                pattern: normalized,
                categoryID: category.id,
                isSubscription: isSubscription
            )
        )
        save()
    }

    // MARK: - Réglages

    func updateSettings(_ mutate: (SDUserSettings) -> Void) {
        mutate(settings)
        save()
    }

    // MARK: - Conversation

    func chatHistory() -> [SDChatMessage] {
        let descriptor = FetchDescriptor<SDChatMessage>(sortBy: [SortDescriptor(\.date)])
        return (try? context.fetch(descriptor)) ?? []
    }

    func appendChatMessage(_ text: String, isFromUser: Bool) {
        context.insert(
            SDChatMessage(
                date: Date(),
                isFromUser: isFromUser,
                text: text,
                contextMonth: selectedMonth.description
            )
        )
        try? context.save()
    }

    func clearChatHistory() {
        for message in chatHistory() { context.delete(message) }
        try? context.save()
    }

    // MARK: - Effacement RGPD

    /// Suppression définitive de toutes les données (RGPD art. 17).
    /// Irréversible — l'appelant doit avoir obtenu une double confirmation.
    func deleteAllData() {
        deleteAll(SDTransaction.self)
        deleteAll(SDIncomeSource.self)
        deleteAll(SDRecurringExpense.self)
        deleteAll(SDDebt.self)
        deleteAll(SDGoal.self)
        deleteAll(SDAccount.self)
        deleteAll(SDCategoryBudget.self)
        deleteAll(SDCategorizationRule.self)
        deleteAll(SDChatMessage.self)
        deleteAll(SDUserSettings.self)
        try? context.save()
        reload()
    }

    // MARK: - Utilitaires

    private func fetchOne<T: PersistentModel>(_ type: T.Type, id: UUID) -> T? {
        // Le filtrage se fait en mémoire : `#Predicate` sur un `UUID` reste fragile
        // selon les versions de SwiftData, et les volumes ici sont faibles.
        let all = (try? context.fetch(FetchDescriptor<T>())) ?? []
        return all.first { model in
            (model as? any Identified)?.identifier == id
        }
    }

    private func deleteAll<T: PersistentModel>(_ type: T.Type) {
        let all = (try? context.fetch(FetchDescriptor<T>())) ?? []
        for model in all { context.delete(model) }
    }

    // MARK: - Construction du profil

    private static func loadOrCreateSettings(in context: ModelContext) -> SDUserSettings {
        let descriptor = FetchDescriptor<SDUserSettings>()
        if let existing = (try? context.fetch(descriptor))?.first { return existing }
        let created = SDUserSettings()
        context.insert(created)
        try? context.save()
        return created
    }

    private static func buildProfile(
        context: ModelContext,
        settings: SDUserSettings
    ) -> FinancialProfile {
        let currency = settings.currency

        let accounts = (try? context.fetch(FetchDescriptor<SDAccount>())) ?? []
        let incomes = (try? context.fetch(FetchDescriptor<SDIncomeSource>())) ?? []
        let recurring = (try? context.fetch(FetchDescriptor<SDRecurringExpense>())) ?? []
        let transactions = (try? context.fetch(
            FetchDescriptor<SDTransaction>(sortBy: [SortDescriptor(\.date, order: .reverse)])
        )) ?? []
        let debts = (try? context.fetch(FetchDescriptor<SDDebt>())) ?? []
        let goals = (try? context.fetch(FetchDescriptor<SDGoal>())) ?? []
        let budgets = (try? context.fetch(FetchDescriptor<SDCategoryBudget>())) ?? []

        return FinancialProfile(
            currency: currency,
            accounts: accounts.map { $0.toValue(currency: currency) },
            incomes: incomes.map { $0.toValue(currency: currency) },
            recurringExpenses: recurring.map { $0.toValue(currency: currency) },
            transactions: transactions.map { $0.toValue(currency: currency) },
            debts: debts.map { $0.toValue(currency: currency) },
            goals: goals.map { $0.toValue(currency: currency) },
            categoryBudgets: budgets.compactMap { $0.toValue(currency: currency) },
            savingsBalance: Money(settings.savingsBalance, currency),
            investmentsBalance: Money(settings.investmentsBalance, currency),
            riskProfile: settings.riskProfile,
            investmentHorizonYears: settings.investmentHorizonYears,
            preferences: settings.preferences,
            estimatedMonthlyVariableSpending: settings.estimatedMonthlyVariableSpending
                .map { Money($0, currency) }
        )
    }
}

/// Protocole interne permettant de retrouver une entité par identifiant sans dupliquer
/// une requête par type.
protocol Identified {
    var identifier: UUID { get }
}

extension SDAccount: Identified { var identifier: UUID { id } }
extension SDIncomeSource: Identified { var identifier: UUID { id } }
extension SDRecurringExpense: Identified { var identifier: UUID { id } }
extension SDTransaction: Identified { var identifier: UUID { id } }
extension SDDebt: Identified { var identifier: UUID { id } }
extension SDGoal: Identified { var identifier: UUID { id } }
extension SDCategoryBudget: Identified { var identifier: UUID { id } }
extension SDCategorizationRule: Identified { var identifier: UUID { id } }
extension SDChatMessage: Identified { var identifier: UUID { id } }
extension SDUserSettings: Identified { var identifier: UUID { id } }
