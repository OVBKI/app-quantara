import SwiftUI
import UniformTypeIdentifiers
import QuantaraCore

struct ImportView: View {

    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var isShowingFileImporter = false
    @State private var result: TransactionImporter.Result?
    @State private var errorMessage: String?
    @State private var dateFormat: String = "dd/MM/yyyy"
    @State private var hasHeaderRow = true

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("import.explanation")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Picker("import.dateFormat", selection: $dateFormat) {
                        Text("31/12/2026").tag("dd/MM/yyyy")
                        Text("2026-12-31").tag("yyyy-MM-dd")
                        Text("12/31/2026").tag("MM/dd/yyyy")
                        Text("31.12.2026").tag("dd.MM.yyyy")
                    }
                    Toggle("import.hasHeader", isOn: $hasHeaderRow)
                }

                Section {
                    Button {
                        isShowingFileImporter = true
                    } label: {
                        Label("import.chooseFile", systemImage: "doc.badge.plus")
                    }
                }

                if let result {
                    Section {
                        LabeledContent("import.found", value: "\(result.transactions.count)")
                        LabeledContent("import.categorized", value: "\(result.categorizedCount)")
                        if result.skippedLines > 0 {
                            LabeledContent("import.skipped", value: "\(result.skippedLines)")
                        }
                    } header: {
                        Text("import.preview")
                    } footer: {
                        if result.skippedLines > 0 {
                            Text("import.skipped.explanation")
                        }
                    }

                    Section {
                        ForEach(result.transactions.prefix(8)) { transaction in
                            TransactionRow(transaction: transaction)
                        }
                    }

                    Section {
                        Button("import.confirm") {
                            store.add(result.transactions)
                            dismiss()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Theme.Palette.critical)
                    }
                }
            }
            .navigationTitle("transactions.import")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $isShowingFileImporter,
                allowedContentTypes: [.commaSeparatedText, .plainText, .text]
            ) { outcome in
                handle(outcome)
            }
        }
    }

    private func handle(_ outcome: Result<URL, Error>) {
        errorMessage = nil
        do {
            let url = try outcome.get()
            // Un fichier choisi hors du bac à sable requiert un accès explicite.
            guard url.startAccessingSecurityScopedResource() else {
                errorMessage = String(localized: "import.error.access")
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }

            let content = try String(contentsOf: url, encoding: .utf8)
            result = try TransactionImporter.parse(
                csv: content,
                mapping: .init(date: 0, label: 1, amount: 2, dateFormat: dateFormat),
                currency: store.profile.currency,
                userRules: store.categorizationRules,
                hasHeaderRow: hasHeaderRow
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
