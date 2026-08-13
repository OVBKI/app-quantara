import SwiftUI
import UIKit
import QuantaraCore

struct TransactionsView: View {

    @Environment(DataStore.self) private var store

    @State private var searchText: String = ""
    @State private var selectedKind: TransactionKind?
    @State private var isShowingQuickAdd = false
    @State private var isShowingImport = false
    @State private var detectedRecurrences: [DetectedRecurrence] = []

    var body: some View {
        NavigationStack {
            List {
                if !detectedRecurrences.isEmpty {
                    recurrenceSection
                }

                ForEach(groupedTransactions, id: \.key) { group in
                    Section {
                        ForEach(group.value) { transaction in
                            TransactionRow(transaction: transaction)
                                .swipeActions {
                                    Button("action.delete", role: .destructive) {
                                        store.deleteTransaction(id: transaction.id)
                                    }
                                }
                        }
                    } header: {
                        HStack {
                            Text(group.key.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                            Spacer()
                            Text(dayTotal(group.value).formatted())
                                .monospacedDigit()
                        }
                    }
                }

                if filteredTransactions.isEmpty {
                    EmptyStateView(
                        symbol: "list.bullet.rectangle",
                        title: "transactions.empty.title",
                        message: "transactions.empty.message",
                        actionLabel: "home.quickAdd",
                        action: { isShowingQuickAdd = true }
                    )
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $searchText, prompt: Text("transactions.search"))
            .navigationTitle("tab.transactions")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button("transactions.filter.all") { selectedKind = nil }
                        Divider()
                        ForEach(TransactionKind.allCases, id: \.self) { kind in
                            Button(String(localized: String.LocalizationValue(kind.localizationKey))) {
                                selectedKind = kind
                            }
                        }
                    } label: {
                        Image(systemName: selectedKind == nil
                              ? "line.3.horizontal.decrease.circle"
                              : "line.3.horizontal.decrease.circle.fill")
                    }
                    .accessibilityLabel("transactions.filter")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            isShowingQuickAdd = true
                        } label: {
                            Label("home.quickAdd", systemImage: "plus")
                        }
                        Button {
                            isShowingImport = true
                        } label: {
                            Label("transactions.import", systemImage: "square.and.arrow.down")
                        }
                        Button {
                            detectRecurrences()
                        } label: {
                            Label("transactions.detectRecurrences", systemImage: "repeat")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $isShowingQuickAdd) { QuickAddTransactionView() }
            .sheet(isPresented: $isShowingImport) { ImportView() }
        }
    }

    // MARK: Récurrences détectées

    private var recurrenceSection: some View {
        Section {
            ForEach(detectedRecurrences) { recurrence in
                VStack(alignment: .leading, spacing: 6) {
                    Text(recurrence.label)
                        .font(.subheadline.weight(.medium))
                    Text(
                        String(
                            format: String(localized: "transactions.recurrence.detail"),
                            recurrence.averageAmount.rounded().formatted(),
                            recurrence.frequency.localizedName,
                            recurrence.occurrences
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    HStack {
                        Button("transactions.recurrence.convert") {
                            convert(recurrence)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)

                        Button("transactions.recurrence.ignore") {
                            detectedRecurrences.removeAll { $0.id == recurrence.id }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("transactions.recurrence.title")
        }
    }

    // MARK: Données

    private var filteredTransactions: [Transaction] {
        store.profile.transactions.filter { transaction in
            if let selectedKind, transaction.kind != selectedKind { return false }
            guard !searchText.isEmpty else { return true }
            let haystack = [
                transaction.label,
                transaction.category?.localizedName ?? "",
                transaction.note ?? ""
            ].joined(separator: " ")
            return haystack.localizedCaseInsensitiveContains(searchText)
        }
    }

    private var groupedTransactions: [(key: Date, value: [Transaction])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: filteredTransactions) {
            calendar.startOfDay(for: $0.date)
        }
        return grouped.sorted { $0.key > $1.key }
    }

    private func dayTotal(_ transactions: [Transaction]) -> Money {
        let currency = store.profile.currency
        return transactions.reduce(Money(.zero, currency)) { partial, transaction in
            switch transaction.kind {
            case .income:  return partial + transaction.effectiveAmount
            case .transfer: return partial
            default:       return partial - transaction.effectiveAmount
            }
        }
    }

    private func detectRecurrences() {
        let detected = Categorizer.detectRecurrences(in: store.profile.transactions)
        let existing = Set(store.profile.recurringExpenses.map { Categorizer.normalize($0.name) })
        detectedRecurrences = detected
            .filter { !existing.contains($0.label) }
            .map {
                DetectedRecurrence(
                    label: $0.label,
                    averageAmount: $0.averageAmount,
                    occurrences: $0.occurrences,
                    frequency: $0.suggestedFrequency
                )
            }
    }

    private func convert(_ recurrence: DetectedRecurrence) {
        let category = Categorizer.categorize(
            label: recurrence.label,
            userRules: store.categorizationRules
        )
        let fixedCategory: FixedExpenseCategory = {
            if case .fixed(let value) = category?.category { return value }
            return .otherFixed
        }()

        store.add(
            RecurringExpense(
                name: recurrence.label.capitalized,
                amount: recurrence.averageAmount.rounded(),
                frequency: recurrence.frequency,
                category: fixedCategory,
                isSubscription: category?.isSubscription ?? false
            )
        )
        detectedRecurrences.removeAll { $0.id == recurrence.id }
    }
}

struct DetectedRecurrence: Identifiable {
    let id = UUID()
    let label: String
    let averageAmount: Money
    let occurrences: Int
    let frequency: Frequency
}

// MARK: - Ligne de transaction

struct TransactionRow: View {
    let transaction: Transaction

    var body: some View {
        HStack(spacing: Theme.Spacing.small) {
            Image(systemName: transaction.category?.symbolName ?? defaultSymbol)
                .foregroundStyle(tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.label)
                    .font(.subheadline)
                    .lineLimit(1)
                if let category = transaction.category {
                    Text(category.localizedName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Text(signedAmount)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
    }

    private var defaultSymbol: String {
        switch transaction.kind {
        case .income:      return "arrow.down.circle.fill"
        case .savings:     return "banknote.fill"
        case .transfer:    return "arrow.left.arrow.right.circle.fill"
        case .debtPayment: return "creditcard.fill"
        case .expense:     return "cart.fill"
        }
    }

    private var tint: Color {
        switch transaction.kind {
        case .income:      return Theme.Palette.income
        case .savings:     return Theme.Palette.savings
        case .transfer:    return .secondary
        case .debtPayment: return Theme.Palette.debt
        case .expense:     return .primary
        }
    }

    private var signedAmount: String {
        let formatted = transaction.effectiveAmount.formatted()
        switch transaction.kind {
        case .income:   return "+ " + formatted
        case .transfer: return formatted
        default:        return "− " + formatted
        }
    }
}
