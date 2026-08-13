import Foundation
import QuantaraCore

/// Import CSV.
///
/// Prévu dès la v1 : sans connexion bancaire, c'est la seule façon d'alimenter
/// l'historique sans tout ressaisir — et l'historique conditionne la qualité de
/// l'analyse (moyennes, dérives, détection de récurrences).
enum TransactionImporter {

    struct ColumnMapping: Sendable {
        var date: Int
        var label: Int
        var amount: Int
        var dateFormat: String

        static let `default` = ColumnMapping(date: 0, label: 1, amount: 2, dateFormat: "dd/MM/yyyy")
    }

    struct Result: Sendable {
        let transactions: [Transaction]
        let skippedLines: Int
        let categorizedCount: Int
    }

    enum ImportError: LocalizedError {
        case emptyFile
        case noValidRows

        var errorDescription: String? {
            switch self {
            case .emptyFile:   return String(localized: "import.error.empty")
            case .noValidRows: return String(localized: "import.error.noRows")
            }
        }
    }

    /// Analyse un contenu CSV.
    ///
    /// Le signe du montant détermine le sens : négatif → dépense, positif → revenu.
    /// C'est la convention de tous les exports bancaires français et belges.
    static func parse(
        csv content: String,
        mapping: ColumnMapping = .default,
        currency: Currency,
        userRules: [CategorizationRule] = [],
        hasHeaderRow: Bool = true
    ) throws -> Result {

        let lines = content
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        guard !lines.isEmpty else { throw ImportError.emptyFile }

        let separator = detectSeparator(in: lines[0])
        let rows = hasHeaderRow ? Array(lines.dropFirst()) : lines

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = mapping.dateFormat

        var transactions: [Transaction] = []
        var skipped = 0
        var categorized = 0

        for row in rows {
            let fields = splitCSVRow(row, separator: separator)
            guard fields.count > max(mapping.date, max(mapping.label, mapping.amount)) else {
                skipped += 1
                continue
            }

            guard let date = formatter.date(from: fields[mapping.date].trimmingCharacters(in: .whitespaces)),
                  let amount = parseAmount(fields[mapping.amount])
            else {
                skipped += 1
                continue
            }

            let label = fields[mapping.label].trimmingCharacters(in: .whitespaces)
            let isIncome = amount > 0
            let categorization = isIncome
                ? nil
                : Categorizer.categorize(label: label, userRules: userRules)
            if categorization != nil { categorized += 1 }

            transactions.append(
                Transaction(
                    date: date,
                    amount: Money(abs(amount), currency),
                    kind: isIncome ? .income : .expense,
                    category: categorization?.category,
                    label: label,
                    merchantRaw: label
                )
            )
        }

        guard !transactions.isEmpty else { throw ImportError.noValidRows }

        return Result(
            transactions: transactions,
            skippedLines: skipped,
            categorizedCount: categorized
        )
    }

    /// Les exports français utilisent le point-virgule (la virgule est le séparateur
    /// décimal). On détecte plutôt que d'imposer.
    private static func detectSeparator(in line: String) -> Character {
        let semicolons = line.filter { $0 == ";" }.count
        let commas = line.filter { $0 == "," }.count
        let tabs = line.filter { $0 == "\t" }.count
        if tabs > semicolons && tabs > commas { return "\t" }
        return semicolons >= commas ? ";" : ","
    }

    /// Découpage respectant les guillemets : un libellé peut contenir le séparateur.
    private static func splitCSVRow(_ row: String, separator: Character) -> [String] {
        var fields: [String] = []
        var current = ""
        var insideQuotes = false

        for character in row {
            if character == "\"" {
                insideQuotes.toggle()
            } else if character == separator && !insideQuotes {
                fields.append(current)
                current = ""
            } else {
                current.append(character)
            }
        }
        fields.append(current)
        return fields.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")) }
    }

    /// Accepte « 1 234,56 », « 1.234,56 » et « 1,234.56 » : chaque banque a sa convention.
    static func parseAmount(_ raw: String) -> Decimal? {
        var cleaned = raw
            .replacingOccurrences(of: "\u{00A0}", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "€", with: "")
            .replacingOccurrences(of: "$", with: "")
            .trimmingCharacters(in: .whitespaces)

        let lastComma = cleaned.lastIndex(of: ",")
        let lastDot = cleaned.lastIndex(of: ".")

        switch (lastComma, lastDot) {
        case let (comma?, dot?):
            // Le séparateur décimal est le dernier des deux ; l'autre groupe les milliers.
            if comma > dot {
                cleaned = cleaned.replacingOccurrences(of: ".", with: "")
                cleaned = cleaned.replacingOccurrences(of: ",", with: ".")
            } else {
                cleaned = cleaned.replacingOccurrences(of: ",", with: "")
            }
        case (.some, .none):
            cleaned = cleaned.replacingOccurrences(of: ",", with: ".")
        default:
            break
        }

        return Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
    }
}
