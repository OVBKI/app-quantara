import Foundation

public struct CategorizationResult: Hashable, Sendable {
    public let category: ExpenseCategory
    /// Confiance dans [0, 1]. En dessous de 0,6 l'app propose sans appliquer.
    public let confidence: Decimal
    public let matchedPattern: String?
    public let isSubscription: Bool
}

/// Règle de catégorisation apprise ou fournie.
public struct CategorizationRule: Hashable, Codable, Sendable, Identifiable {
    public let id: UUID
    /// Motif recherché dans le libellé normalisé.
    public let pattern: String
    public let category: ExpenseCategory
    public let isSubscription: Bool
    /// Une règle créée par l'utilisateur prime sur les règles embarquées.
    public let isUserDefined: Bool

    public init(
        id: UUID = UUID(),
        pattern: String,
        category: ExpenseCategory,
        isSubscription: Bool = false,
        isUserDefined: Bool = false
    ) {
        self.id = id
        self.pattern = pattern
        self.category = category
        self.isSubscription = isSubscription
        self.isUserDefined = isUserDefined
    }
}

/// Catégorisation locale des libellés bancaires (§20).
///
/// Premier étage, entièrement hors ligne : rapide, gratuit, et surtout aucune donnée
/// n'est transmise. Le repli IA (second étage) n'intervient que sur les libellés non
/// reconnus, et uniquement si l'utilisateur a activé le mode détaillé.
public enum Categorizer {

    /// Normalise un libellé bancaire : majuscules, sans accents, sans dates, sans
    /// numéros de carte, sans mentions techniques (« CB », « PAIEMENT », « VIR »…).
    public static func normalize(_ label: String) -> String {
        let folded = label
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
            .uppercased()

        let noise = [
            "CARTE", "CB", "PAIEMENT", "PAIMT", "ACHAT", "VIREMENT", "VIR", "PRLV",
            "PRELEVEMENT", "SEPA", "FACTURE", "RETRAIT", "DAB"
        ]

        var cleaned = folded
        for token in noise {
            cleaned = cleaned.replacingOccurrences(of: token, with: " ")
        }

        // Supprime les nombres (dates, numéros de transaction) et la ponctuation.
        cleaned = cleaned.map { character -> Character in
            if character.isLetter || character == " " { return character }
            return " "
        }
        .reduce(into: "") { $0.append($1) }

        return cleaned
            .split(separator: " ")
            .filter { $0.count > 1 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
    }

    /// Catégorise un libellé. Les règles utilisateur passent avant les règles embarquées :
    /// une correction manuelle doit toujours gagner.
    public static func categorize(
        label: String,
        userRules: [CategorizationRule] = []
    ) -> CategorizationResult? {
        let normalized = normalize(label)
        guard !normalized.isEmpty else { return nil }

        for rule in userRules where normalized.contains(rule.pattern) {
            return CategorizationResult(
                category: rule.category,
                confidence: 1,
                matchedPattern: rule.pattern,
                isSubscription: rule.isSubscription
            )
        }

        for rule in builtInRules where normalized.contains(rule.pattern) {
            return CategorizationResult(
                category: rule.category,
                confidence: Decimal(string: "0.85") ?? 0,
                matchedPattern: rule.pattern,
                isSubscription: rule.isSubscription
            )
        }

        return nil
    }

    /// Détecte les récurrences dans un historique de transactions.
    ///
    /// Une dépense qui revient au moins trois fois, à intervalle régulier et pour un
    /// montant stable, est presque toujours une charge fixe non déclarée.
    public static func detectRecurrences(
        in transactions: [Transaction],
        calendar: Calendar = .gregorianUTC
    ) -> [(label: String, averageAmount: Money, occurrences: Int, suggestedFrequency: Frequency)] {

        let expenses = transactions.filter { $0.kind == .expense }
        let grouped = Dictionary(grouping: expenses) { normalize($0.label) }

        return grouped.compactMap { label, group -> (String, Money, Int, Frequency)? in
            guard group.count >= 3, let currency = group.first?.amount.currency else { return nil }

            let amounts = group.map(\.effectiveAmount.amount)
            guard let mean = DecimalStatistics.mean(amounts), mean > .zero else { return nil }

            // Montant stable : écart-type inférieur à 15 % de la moyenne.
            if let deviation = DecimalStatistics.standardDeviation(amounts),
               deviation / mean > (Decimal(string: "0.15") ?? 0) {
                return nil
            }

            let dates = group.map(\.date).sorted()
            let intervals = zip(dates, dates.dropFirst()).map { earlier, later in
                calendar.dateComponents([.day], from: earlier, to: later).day ?? 0
            }
            guard !intervals.isEmpty else { return nil }
            let averageInterval = intervals.reduce(0, +) / intervals.count

            let frequency = closestFrequency(toDayInterval: averageInterval)
            guard frequency != .oneOff else { return nil }

            return (label, Money(mean, currency), group.count, frequency)
        }
        .sorted { $0.1 > $1.1 }
    }

    private static func closestFrequency(toDayInterval interval: Int) -> Frequency {
        let candidates: [Frequency] = [.weekly, .biweekly, .monthly, .quarterly, .semiannual, .annual]
        var best: Frequency = .oneOff
        var bestDistance = Int.max
        for candidate in candidates {
            guard let reference = candidate.approximateDayInterval else { continue }
            let distance = abs(reference - interval)
            // Tolérance de 20 % : un prélèvement « mensuel » tombe entre 28 et 33 jours.
            guard distance <= max(3, reference / 5) else { continue }
            if distance < bestDistance {
                bestDistance = distance
                best = candidate
            }
        }
        return best
    }

    // MARK: - Règles embarquées

    /// Dictionnaire de marchands courants en France et en Belgique.
    /// Volontairement conservateur : mieux vaut ne pas catégoriser que mal catégoriser,
    /// une erreur silencieuse fausse le budget sans que l'utilisateur s'en aperçoive.
    public static let builtInRules: [CategorizationRule] = [
        // Courses
        rule("CARREFOUR", .variable(.groceries)),
        rule("LECLERC", .variable(.groceries)),
        rule("INTERMARCHE", .variable(.groceries)),
        rule("AUCHAN", .variable(.groceries)),
        rule("LIDL", .variable(.groceries)),
        rule("ALDI", .variable(.groceries)),
        rule("MONOPRIX", .variable(.groceries)),
        rule("FRANPRIX", .variable(.groceries)),
        rule("CASINO", .variable(.groceries)),
        rule("SUPER U", .variable(.groceries)),
        rule("COLRUYT", .variable(.groceries)),
        rule("DELHAIZE", .variable(.groceries)),
        rule("PICARD", .variable(.groceries)),
        rule("BIOCOOP", .variable(.groceries)),

        // Énergie facturée par un pétrolier : placé avant « TOTAL » car les règles sont
        // évaluées dans l'ordre et la première qui correspond gagne.
        rule("TOTALENERGIES ELEC", .fixed(.electricity)),
        rule("TOTALENERGIES GAZ", .fixed(.gas)),

        // Carburant
        rule("TOTAL", .variable(.fuel)),
        rule("SHELL", .variable(.fuel)),
        rule("ESSO", .variable(.fuel)),
        rule("BP ", .variable(.fuel)),
        rule("STATION", .variable(.fuel)),

        // Transports
        rule("SNCF", .variable(.transport)),
        rule("RATP", .variable(.transport)),
        rule("NAVIGO", .variable(.transport)),
        rule("UBER", .variable(.transport)),
        rule("BLABLACAR", .variable(.transport)),
        rule("STIB", .variable(.transport)),
        rule("SNCB", .variable(.transport)),

        // Restaurants
        rule("MCDONALD", .variable(.restaurants)),
        rule("BURGER KING", .variable(.restaurants)),
        rule("DELIVEROO", .variable(.restaurants)),
        rule("UBER EATS", .variable(.restaurants)),
        rule("JUST EAT", .variable(.restaurants)),
        rule("RESTAURANT", .variable(.restaurants)),
        rule("BOULANGERIE", .variable(.restaurants)),
        rule("STARBUCKS", .variable(.restaurants)),

        // Abonnements
        rule("NETFLIX", .fixed(.subscriptions), isSubscription: true),
        rule("SPOTIFY", .fixed(.subscriptions), isSubscription: true),
        rule("DISNEY", .fixed(.subscriptions), isSubscription: true),
        rule("APPLE COM BILL", .fixed(.subscriptions), isSubscription: true),
        rule("AMAZON PRIME", .fixed(.subscriptions), isSubscription: true),
        rule("CANAL", .fixed(.subscriptions), isSubscription: true),
        rule("DEEZER", .fixed(.subscriptions), isSubscription: true),
        rule("YOUTUBE PREMIUM", .fixed(.subscriptions), isSubscription: true),

        // Télécoms
        rule("ORANGE", .fixed(.phone)),
        rule("SFR", .fixed(.phone)),
        rule("BOUYGUES", .fixed(.phone)),
        rule("FREE MOBILE", .fixed(.phone)),
        rule("PROXIMUS", .fixed(.phone)),
        rule("FREE", .fixed(.internet)),

        // Énergie et eau
        rule("EDF", .fixed(.electricity)),
        rule("ENGIE", .fixed(.gas)),
        rule("VEOLIA", .fixed(.water)),
        rule("SUEZ", .fixed(.water)),

        // Assurances
        rule("AXA", .fixed(.homeInsurance)),
        rule("MAIF", .fixed(.homeInsurance)),
        rule("MACIF", .fixed(.homeInsurance)),
        rule("MATMUT", .fixed(.homeInsurance)),
        rule("ALLIANZ", .fixed(.homeInsurance)),
        rule("MUTUELLE", .fixed(.healthInsurance)),
        rule("HARMONIE", .fixed(.healthInsurance)),

        // Santé
        rule("PHARMACIE", .variable(.health)),
        rule("LABORATOIRE", .variable(.health)),
        rule("OPTIQUE", .variable(.health)),

        // Shopping et loisirs
        rule("AMAZON", .variable(.shopping)),
        rule("FNAC", .variable(.shopping)),
        rule("DECATHLON", .variable(.shopping)),
        rule("ZARA", .variable(.shopping)),
        rule("IKEA", .variable(.shopping)),
        rule("LEROY MERLIN", .variable(.shopping)),
        rule("STEAM", .variable(.videoGames)),
        rule("PLAYSTATION", .variable(.videoGames)),
        rule("NINTENDO", .variable(.videoGames)),
        rule("XBOX", .variable(.videoGames)),
        rule("CINEMA", .variable(.leisure)),
        rule("UGC", .variable(.leisure)),
        rule("GAUMONT", .variable(.leisure)),

        // Voyages
        rule("BOOKING", .variable(.travel)),
        rule("AIRBNB", .variable(.travel)),
        rule("AIR FRANCE", .variable(.travel)),
        rule("RYANAIR", .variable(.travel)),
        rule("EASYJET", .variable(.travel)),

        // Animaux
        rule("VETERINAIRE", .variable(.pets)),
        rule("ANIMALERIE", .variable(.pets))
    ]

    private static func rule(
        _ pattern: String,
        _ category: ExpenseCategory,
        isSubscription: Bool = false
    ) -> CategorizationRule {
        CategorizationRule(
            pattern: pattern,
            category: category,
            isSubscription: isSubscription,
            isUserDefined: false
        )
    }
}
