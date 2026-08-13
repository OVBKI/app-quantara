import Foundation

/// Devise du profil. Quantara est mono-devise par profil : la conversion temps réel
/// (et la fiscalité des plus-values de change) est hors périmètre v1.
public enum Currency: String, Codable, Sendable, CaseIterable, Identifiable {
    case eur = "EUR"
    case usd = "USD"
    case gbp = "GBP"
    case chf = "CHF"
    case cad = "CAD"

    public var id: String { rawValue }

    public var symbol: String {
        switch self {
        case .eur: return "€"
        case .usd: return "$"
        case .gbp: return "£"
        case .chf: return "CHF"
        case .cad: return "CA$"
        }
    }

    /// Nombre de décimales significatives. Toutes les devises supportées en utilisent 2.
    public var fractionDigits: Int { 2 }
}

/// Montant monétaire.
///
/// Volontairement adossé à `Decimal` et non à `Double` : en binaire, `0.1 + 0.2 != 0.3`,
/// et l'erreur devient visible dès qu'on additionne quelques centaines de transactions.
///
/// Les opérations entre devises différentes sont une erreur de programmation et
/// déclenchent une `preconditionFailure` — un profil n'a qu'une devise.
public struct Money: Hashable, Sendable, Codable {

    public var amount: Decimal
    public var currency: Currency

    public init(_ amount: Decimal, _ currency: Currency = .eur) {
        self.amount = amount
        self.currency = currency
    }

    public init(_ amount: Int, _ currency: Currency = .eur) {
        self.init(Decimal(amount), currency)
    }

    /// Pratique pour les saisies utilisateur et les tests. On passe par une chaîne pour
    /// éviter de propager l'imprécision binaire du `Double` dans le `Decimal`.
    public init(approximately value: Double, _ currency: Currency = .eur) {
        self.init(Decimal(string: String(value)) ?? .zero, currency)
    }

    public static func zero(_ currency: Currency = .eur) -> Money {
        Money(Decimal.zero, currency)
    }

    public var isZero: Bool { amount == .zero }
    public var isPositive: Bool { amount > .zero }
    public var isNegative: Bool { amount < .zero }

    public var magnitude: Money { Money(abs(amount), currency) }
    public var negated: Money { Money(-amount, currency) }

    /// Remet à zéro les montants négatifs. Utile partout où un reste à vivre négatif
    /// ne doit pas se propager dans une répartition.
    public var clampedToZero: Money { amount < .zero ? Money.zero(currency) : self }

    // MARK: - Arithmétique

    public static func + (lhs: Money, rhs: Money) -> Money {
        assertSameCurrency(lhs, rhs)
        return Money(lhs.amount + rhs.amount, lhs.currency)
    }

    public static func - (lhs: Money, rhs: Money) -> Money {
        assertSameCurrency(lhs, rhs)
        return Money(lhs.amount - rhs.amount, lhs.currency)
    }

    public static func * (lhs: Money, rhs: Decimal) -> Money {
        Money(lhs.amount * rhs, lhs.currency)
    }

    // Pas de surcharge symétrique `Decimal * Money` : `Money` est
    // `ExpressibleByIntegerLiteral`, si bien qu'une expression aussi banale que
    // `ratio * 100` deviendrait ambiguë (le littéral pouvant être lu comme un
    // `Money`). La multiplication s'écrit donc toujours montant en premier.

    public static func / (lhs: Money, rhs: Decimal) -> Money {
        guard rhs != .zero else { return Money.zero(lhs.currency) }
        return Money(lhs.amount / rhs, lhs.currency)
    }

    public static func += (lhs: inout Money, rhs: Money) { lhs = lhs + rhs }
    public static func -= (lhs: inout Money, rhs: Money) { lhs = lhs - rhs }

    /// Ratio sans unité entre deux montants. `nil` si le dénominateur est nul —
    /// on ne renvoie pas 0, qui se confondrait avec un ratio réellement nul.
    public func ratio(to other: Money) -> Decimal? {
        Money.assertSameCurrency(self, other)
        guard other.amount != .zero else { return nil }
        return amount / other.amount
    }

    // MARK: - Arrondi

    /// Arrondi bancaire (mi-pair) par défaut : sur une somme de nombreuses lignes il ne
    /// dérive pas systématiquement vers le haut, contrairement à l'arrondi commercial.
    public func rounded(scale: Int = 2, mode: Decimal.RoundingMode = .bankers) -> Money {
        var input = amount
        var result = Decimal()
        NSDecimalRound(&result, &input, scale, mode)
        return Money(result, currency)
    }

    /// Arrondi à l'unité la plus proche — utilisé pour les montants conseillés,
    /// où « 187,43 € par mois » sonne faussement précis face à « 187 € ».
    public var roundedToUnit: Money { rounded(scale: 0, mode: .plain) }

    // MARK: - Somme

    public static func sum(_ values: [Money], currency: Currency) -> Money {
        values.reduce(Money.zero(currency)) { partial, next in
            assertSameCurrency(partial, next)
            return partial + next
        }
    }

    private static func assertSameCurrency(_ lhs: Money, _ rhs: Money) {
        precondition(
            lhs.currency == rhs.currency,
            "Opération entre devises différentes (\(lhs.currency.rawValue) / \(rhs.currency.rawValue)) : un profil Quantara est mono-devise."
        )
    }
}

// MARK: - Comparable

extension Money: Comparable {
    public static func < (lhs: Money, rhs: Money) -> Bool {
        assertSameCurrency(lhs, rhs)
        return lhs.amount < rhs.amount
    }
}

// MARK: - Littéraux

extension Money: ExpressibleByIntegerLiteral {
    /// Littéral entier en euros. Réservé aux tests et aux valeurs par défaut ;
    /// le code de production passe explicitement la devise du profil.
    public init(integerLiteral value: Int) {
        self.init(Decimal(value), .eur)
    }
}

// MARK: - Formatage

extension Money {
    public func formatted(locale: Locale = .current, fractionDigits: Int? = nil) -> String {
        let digits = fractionDigits ?? currency.fractionDigits
        return amount.formatted(
            .currency(code: currency.rawValue)
                .locale(locale)
                .precision(.fractionLength(digits))
        )
    }

    /// Format compact pour les tuiles et les axes de graphique : « 12,4 k€ ».
    public func formattedCompact(locale: Locale = .current) -> String {
        let absolute = abs(amount)
        if absolute >= 1_000_000 {
            return (amount / 1_000_000).formatted(.number.locale(locale).precision(.fractionLength(1)))
                + " M" + currency.symbol
        }
        if absolute >= 10_000 {
            return (amount / 1_000).formatted(.number.locale(locale).precision(.fractionLength(1)))
                + " k" + currency.symbol
        }
        return formatted(locale: locale, fractionDigits: 0)
    }
}

extension Money: CustomStringConvertible {
    public var description: String { formatted(locale: Locale(identifier: "fr_FR")) }
}

// MARK: - Pourcentages

public enum Percent {
    /// Formate un ratio (0,185) en pourcentage (« 18,5 % »).
    public static func format(_ ratio: Decimal?, locale: Locale = .current, fractionDigits: Int = 1) -> String {
        guard let ratio else { return "—" }
        return ratio.formatted(
            .percent.locale(locale).precision(.fractionLength(fractionDigits))
        )
    }

    /// Variation relative entre deux valeurs. `nil` si la référence est nulle.
    public static func change(from previous: Money, to current: Money) -> Decimal? {
        guard previous.amount != .zero else { return nil }
        return (current.amount - previous.amount) / abs(previous.amount)
    }
}
