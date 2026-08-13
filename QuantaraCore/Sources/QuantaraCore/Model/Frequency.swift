import Foundation

/// Périodicité d'un flux récurrent.
///
/// Le cœur de la normalisation budgétaire : toute somme récurrente est ramenée à un
/// équivalent mensuel via son nombre d'occurrences annuelles, jamais via une
/// approximation « un mois = 30 jours » (qui dérive de 6 jours par an).
public enum Frequency: String, Codable, CaseIterable, Sendable, Identifiable {
    case daily
    case weekly
    case biweekly      // toutes les deux semaines (26 fois par an, ≠ bimensuel)
    case monthly
    case quarterly
    case semiannual
    case annual
    case oneOff        // ponctuel : compte pour le mois de sa date, jamais lissé

    public var id: String { rawValue }

    /// Nombre d'occurrences par an. `nil` pour un flux ponctuel, qui n'est pas récurrent.
    public var occurrencesPerYear: Decimal? {
        switch self {
        case .daily:      return 365
        case .weekly:     return 52
        case .biweekly:   return 26
        case .monthly:    return 12
        case .quarterly:  return 4
        case .semiannual: return 2
        case .annual:     return 1
        case .oneOff:     return nil
        }
    }

    /// Facteur de conversion vers l'équivalent mensuel.
    ///
    /// Exemples du cahier des charges :
    /// - assurance annuelle 1 200 € → 1 200 × (1/12) = 100 €/mois
    /// - salaire mensuel 3 000 €    → 3 000 × 1      = 3 000 €/mois
    public var monthlyFactor: Decimal {
        guard let occurrences = occurrencesPerYear else { return .zero }
        return occurrences / 12
    }

    /// Facteur de conversion vers l'équivalent annuel.
    public var annualFactor: Decimal { occurrencesPerYear ?? .zero }

    /// Ordre des opérations volontaire : on multiplie **avant** de diviser.
    /// `1 200 × (1/12)` passe par 0,08333…33 et rend 99,999…996 ; `1 200 × 1 ÷ 12`
    /// rend exactement 100. L'écart est invisible à l'affichage mais réel en mémoire,
    /// et il fait diverger toute comparaison de montants.
    public func monthlyEquivalent(of money: Money) -> Money {
        guard let occurrences = occurrencesPerYear else { return Money.zero(money.currency) }
        return money * occurrences / 12
    }

    public func annualEquivalent(of money: Money) -> Money {
        money * annualFactor
    }

    public var isRecurring: Bool { self != .oneOff }

    public var localizationKey: String { "frequency.\(rawValue)" }

    /// Nombre de jours approximatif entre deux occurrences — utilisé par la projection
    /// de trésorerie pour placer les échéances non mensuelles dans le calendrier.
    public var approximateDayInterval: Int? {
        switch self {
        case .daily:      return 1
        case .weekly:     return 7
        case .biweekly:   return 14
        case .monthly:    return 30
        case .quarterly:  return 91
        case .semiannual: return 182
        case .annual:     return 365
        case .oneOff:     return nil
        }
    }
}
