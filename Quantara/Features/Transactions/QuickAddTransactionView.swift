import SwiftUI
import QuantaraCore

/// Saisie rapide d'une dépense.
///
/// La friction de saisie est la première cause d'abandon d'une application de budget :
/// l'écran s'ouvre sur le pavé numérique, catégorise automatiquement à partir du libellé,
/// et se valide en deux gestes.
struct QuickAddTransactionView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var amount: Decimal = 0
    @State private var label: String = ""
    @State private var kind: TransactionKind = .expense
    @State private var category: ExpenseCategory = .variable(.groceries)
    @State private var incomeCategory: IncomeCategory = .salary
    @State private var date: Date = Date()
    @State private var note: String = ""
    @State private var goalID: UUID?
    @State private var wasAutoCategorized = false
    @FocusState private var isAmountFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField(
                            "0",
                            value: $amount,
                            format: .currency(code: store.profile.currency.rawValue)
                        )
                        .font(.system(size: 40, weight: .semibold, design: .rounded))
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.center)
                        .focused($isAmountFocused)
                    }
                    .padding(.vertical, Theme.Spacing.small)
                }

                Section {
                    Picker("field.kind", selection: $kind) {
                        Text("transaction.kind.expense").tag(TransactionKind.expense)
                        Text("transaction.kind.income").tag(TransactionKind.income)
                        Text("transaction.kind.savings").tag(TransactionKind.savings)
                    }
                    .pickerStyle(.segmented)

                    TextField("field.label", text: $label)
                        .onChange(of: label) { _, newValue in autoCategorize(newValue) }

                    DatePicker("field.date", selection: $date, displayedComponents: .date)
                }

                Section {
                    switch kind {
                    case .income:
                        Picker("field.category", selection: $incomeCategory) {
                            ForEach(IncomeCategory.allCases) { value in
                                Label(value.localizedName, systemImage: value.symbolName).tag(value)
                            }
                        }
                    case .savings:
                        Picker("field.goal", selection: $goalID) {
                            Text("field.goal.none").tag(UUID?.none)
                            ForEach(store.profile.activeGoals) { goal in
                                Text(goal.name).tag(UUID?.some(goal.id))
                            }
                        }
                    default:
                        Picker("field.category", selection: $category) {
                            ForEach(VariableExpenseCategory.allCases) { value in
                                Label(value.localizedName, systemImage: value.symbolName)
                                    .tag(ExpenseCategory.variable(value))
                            }
                            ForEach(FixedExpenseCategory.allCases) { value in
                                Label(value.localizedName, systemImage: value.symbolName)
                                    .tag(ExpenseCategory.fixed(value))
                            }
                        }
                        if wasAutoCategorized {
                            Label("quickAdd.autoCategorized", systemImage: "wand.and.stars")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    TextField("field.note", text: $note, axis: .vertical)
                        .lineLimit(1...3)
                }
            }
            .navigationTitle("quickAdd.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(amount <= 0)
                }
            }
            .onAppear { isAmountFocused = true }
        }
    }

    /// Catégorisation locale, hors ligne, sans envoi de données.
    private func autoCategorize(_ text: String) {
        guard kind == .expense, text.count >= 3 else { return }
        guard let result = Categorizer.categorize(label: text, userRules: store.categorizationRules)
        else { return }
        category = result.category
        wasAutoCategorized = true
    }

    private func save() {
        let currency = store.profile.currency
        let transaction = BudgetTransaction(
            date: date,
            amount: Money(amount, currency),
            kind: kind,
            category: kind == .expense ? category : nil,
            incomeCategory: kind == .income ? incomeCategory : nil,
            label: label.isEmpty ? defaultLabel : label,
            goalID: kind == .savings ? goalID : nil,
            note: note.isEmpty ? nil : note
        )
        store.add(transaction)

        // Une catégorie corrigée manuellement devient une règle : l'utilisateur ne doit
        // pas avoir à recorriger le même marchand le mois suivant.
        if kind == .expense, !label.isEmpty, !wasAutoCategorized {
            store.learnCategorization(pattern: label, category: category)
        }

        dismiss()
    }

    private var defaultLabel: String {
        switch kind {
        case .income:  return incomeCategory.localizedName
        case .savings: return String(localized: "transaction.kind.savings")
        default:       return category.localizedName
        }
    }
}
