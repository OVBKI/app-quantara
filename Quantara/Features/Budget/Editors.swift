import SwiftUI
import QuantaraCore

/// Champ de saisie monétaire.
///
/// Passe par `Decimal` et non par `Double` : une saisie de 1 234,56 € ne doit pas
/// devenir 1 234,5599999 en base.
struct AmountField: View {
    let title: LocalizedStringKey
    @Binding var amount: Decimal
    var currency: Currency = .eur

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField(
                "0",
                value: $amount,
                format: .currency(code: currency.rawValue)
            )
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.trailing)
            .monospacedDigit()
        }
    }
}

// MARK: - Revenu

struct IncomeEditorView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let income: IncomeSource?

    @State private var name: String = ""
    @State private var amount: Decimal = 0
    @State private var frequency: Frequency = .monthly
    @State private var category: IncomeCategory = .salary
    @State private var dayOfMonth: Int = 1
    @State private var hasDayOfMonth: Bool = false
    @State private var isVariable: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("field.name", text: $name)
                    AmountField(title: "field.amount", amount: $amount, currency: store.profile.currency)
                    Picker("field.frequency", selection: $frequency) {
                        ForEach(Frequency.allCases) { value in
                            Text(value.localizedName).tag(value)
                        }
                    }
                    Picker("field.category", selection: $category) {
                        ForEach(IncomeCategory.allCases) { value in
                            Label(value.localizedName, systemImage: value.symbolName).tag(value)
                        }
                    }
                }

                if frequency.isRecurring && frequency != .monthly {
                    Section {
                        HStack {
                            Text("field.monthlyEquivalent")
                            Spacer()
                            Text(
                                frequency
                                    .monthlyEquivalent(of: Money(amount, store.profile.currency))
                                    .rounded()
                                    .formatted()
                            )
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        }
                    } footer: {
                        Text("field.monthlyEquivalent.explanation")
                    }
                }

                Section {
                    Toggle("field.hasReceiptDay", isOn: $hasDayOfMonth)
                    if hasDayOfMonth {
                        Picker("field.receiptDay", selection: $dayOfMonth) {
                            ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                        }
                    }
                } footer: {
                    Text("field.receiptDay.explanation")
                }

                Section {
                    Toggle("field.isVariableIncome", isOn: $isVariable)
                } footer: {
                    Text("field.isVariableIncome.explanation")
                }

                if let income {
                    Section {
                        Button("action.delete", role: .destructive) {
                            store.deleteIncome(id: income.id)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(income == nil ? "income.new" : "income.edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(name.isEmpty || amount <= 0)
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let income else { return }
        name = income.name
        amount = income.amount.amount
        frequency = income.frequency
        category = income.category
        isVariable = income.isVariable
        if let day = income.dayOfMonth {
            hasDayOfMonth = true
            dayOfMonth = day
        }
    }

    private func save() {
        let value = IncomeSource(
            id: income?.id ?? UUID(),
            name: name,
            amount: Money(amount, store.profile.currency),
            frequency: frequency,
            category: category,
            dayOfMonth: hasDayOfMonth ? dayOfMonth : nil,
            startDate: income?.startDate ?? Date(timeIntervalSince1970: 0),
            endDate: income?.endDate,
            isActive: true,
            isVariable: isVariable
        )
        if income == nil { store.add(value) } else { store.update(value) }
        dismiss()
    }
}

// MARK: - Dépense récurrente

struct RecurringExpenseEditorView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let expense: RecurringExpense?

    @State private var name: String = ""
    @State private var amount: Decimal = 0
    @State private var frequency: Frequency = .monthly
    @State private var category: FixedExpenseCategory = .rent
    @State private var dayOfMonth: Int = 1
    @State private var hasDayOfMonth: Bool = false
    @State private var isSubscription: Bool = false
    @State private var essentialOverride: Bool?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("field.name", text: $name)
                    AmountField(title: "field.amount", amount: $amount, currency: store.profile.currency)
                    Picker("field.frequency", selection: $frequency) {
                        ForEach(Frequency.allCases.filter(\.isRecurring)) { value in
                            Text(value.localizedName).tag(value)
                        }
                    }
                    Picker("field.category", selection: $category) {
                        ForEach(FixedExpenseCategory.allCases) { value in
                            Label(value.localizedName, systemImage: value.symbolName).tag(value)
                        }
                    }
                }

                if frequency != .monthly {
                    Section {
                        HStack {
                            Text("field.monthlyEquivalent")
                            Spacer()
                            Text(
                                frequency
                                    .monthlyEquivalent(of: Money(amount, store.profile.currency))
                                    .rounded()
                                    .formatted()
                            )
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        }
                    } footer: {
                        Text("field.monthlyEquivalent.explanation")
                    }
                }

                Section {
                    Toggle("field.hasDebitDay", isOn: $hasDayOfMonth)
                    if hasDayOfMonth {
                        Picker("field.debitDay", selection: $dayOfMonth) {
                            ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                        }
                    }
                    Toggle("field.isSubscription", isOn: $isSubscription)
                }

                Section {
                    Toggle(
                        "field.isEssential",
                        isOn: Binding(
                            get: { essentialOverride ?? category.isEssential },
                            set: { essentialOverride = $0 }
                        )
                    )
                } footer: {
                    Text("field.isEssential.explanation")
                }

                if category.isDebtRelated {
                    Section {
                        Label("field.debtHint", systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let expense {
                    Section {
                        Button("action.delete", role: .destructive) {
                            store.deleteRecurringExpense(id: expense.id)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(expense == nil ? "expense.new" : "expense.edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(name.isEmpty || amount <= 0)
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let expense else { return }
        name = expense.name
        amount = expense.amount.amount
        frequency = expense.frequency
        category = expense.category
        isSubscription = expense.isSubscription
        essentialOverride = expense.isEssentialOverride
        if let day = expense.dayOfMonth {
            hasDayOfMonth = true
            dayOfMonth = day
        }
    }

    private func save() {
        let value = RecurringExpense(
            id: expense?.id ?? UUID(),
            name: name,
            amount: Money(amount, store.profile.currency),
            frequency: frequency,
            category: category,
            dayOfMonth: hasDayOfMonth ? dayOfMonth : nil,
            isEssentialOverride: essentialOverride,
            isSubscription: isSubscription,
            startDate: expense?.startDate ?? Date(timeIntervalSince1970: 0),
            endDate: expense?.endDate,
            isActive: true,
            sharedRatio: expense?.sharedRatio ?? 1
        )
        if expense == nil { store.add(value) } else { store.update(value) }
        dismiss()
    }
}

// MARK: - Dette

struct DebtEditorView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let debt: Debt?

    @State private var name: String = ""
    @State private var kind: DebtKind = .consumerLoan
    @State private var principal: Decimal = 0
    @State private var ratePercent: Decimal = 0
    @State private var payment: Decimal = 0

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("field.name", text: $name)
                    Picker("field.debtKind", selection: $kind) {
                        ForEach(DebtKind.allCases, id: \.self) { value in
                            Text(value.localizedName).tag(value)
                        }
                    }
                    AmountField(title: "field.outstanding", amount: $principal, currency: store.profile.currency)
                    HStack {
                        Text("field.annualRate")
                        Spacer()
                        TextField("0", value: $ratePercent, format: .number.precision(.fractionLength(0...2)))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                        Text("%")
                    }
                    AmountField(title: "field.monthlyPayment", amount: $payment, currency: store.profile.currency)
                } footer: {
                    Text("field.debt.explanation")
                }

                if let debt {
                    Section {
                        Button("action.delete", role: .destructive) {
                            store.deleteDebt(id: debt.id)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(debt == nil ? "debt.new" : "debt.edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(name.isEmpty || principal <= 0)
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let debt else { return }
        name = debt.name
        kind = debt.kind
        principal = debt.outstandingPrincipal.amount
        ratePercent = debt.annualRate * 100
        payment = debt.monthlyPayment.amount
    }

    private func save() {
        let value = Debt(
            id: debt?.id ?? UUID(),
            name: name,
            kind: kind,
            outstandingPrincipal: Money(principal, store.profile.currency),
            annualRate: ratePercent / 100,
            monthlyPayment: Money(payment, store.profile.currency),
            remainingMonths: debt?.remainingMonths,
            isRevolving: debt?.isRevolving,
            startDate: debt?.startDate,
            isActive: true
        )
        if debt == nil { store.add(value) } else { store.update(value) }
        dismiss()
    }
}
