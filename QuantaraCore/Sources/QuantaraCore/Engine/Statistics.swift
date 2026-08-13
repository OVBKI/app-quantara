import Foundation

/// Statistiques descriptives sur des `Decimal`.
///
/// Réécrites plutôt qu'empruntées à `Double` : convertir des montants en virgule
/// flottante pour calculer une médiane réintroduit précisément l'imprécision que
/// `Decimal` sert à éviter.
public enum DecimalStatistics {

    public static func sum(_ values: [Decimal]) -> Decimal {
        values.reduce(Decimal.zero, +)
    }

    public static func mean(_ values: [Decimal]) -> Decimal? {
        guard !values.isEmpty else { return nil }
        return sum(values) / Decimal(values.count)
    }

    /// Médiane. Préférée à la moyenne pour les revenus irréguliers et les dépenses par
    /// catégorie : un seul mois exceptionnel ne doit pas déplacer la référence.
    public static func median(_ values: [Decimal]) -> Decimal? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        if sorted.count % 2 == 1 { return sorted[middle] }
        return (sorted[middle - 1] + sorted[middle]) / 2
    }

    /// Percentile par interpolation linéaire. `fraction` dans [0, 1].
    public static func percentile(_ values: [Decimal], fraction: Decimal) -> Decimal? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        if sorted.count == 1 { return sorted[0] }
        let clamped = min(max(fraction, 0), 1)
        let position = clamped * Decimal(sorted.count - 1)
        var lowerDecimal = Decimal()
        var mutablePosition = position
        NSDecimalRound(&lowerDecimal, &mutablePosition, 0, .down)
        let lowerIndex = NSDecimalNumber(decimal: lowerDecimal).intValue
        let upperIndex = min(lowerIndex + 1, sorted.count - 1)
        let weight = position - lowerDecimal
        return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight
    }

    /// Écart-type de population. Utilisé pour repérer les dépenses inhabituelles.
    public static func standardDeviation(_ values: [Decimal]) -> Decimal? {
        guard values.count > 1, let average = mean(values) else { return nil }
        let variance = sum(values.map { ($0 - average) * ($0 - average) }) / Decimal(values.count)
        return squareRoot(variance)
    }

    /// Racine carrée par la méthode de Héron. `Decimal` n'expose pas `sqrt` ;
    /// vingt itérations suffisent très largement à la précision d'affichage.
    public static func squareRoot(_ value: Decimal) -> Decimal {
        guard value > .zero else { return .zero }
        var estimate = value / 2
        if estimate == .zero { estimate = value }
        for _ in 0..<20 {
            guard estimate != .zero else { break }
            let next = (estimate + value / estimate) / 2
            if next == estimate { break }
            estimate = next
        }
        return estimate
    }

    /// Élévation à une puissance entière positive par exponentiation rapide.
    /// Base des calculs d'intérêts composés.
    public static func power(_ base: Decimal, _ exponent: Int) -> Decimal {
        guard exponent >= 0 else {
            let positive = power(base, -exponent)
            return positive == .zero ? .zero : 1 / positive
        }
        var result = Decimal(1)
        var multiplier = base
        var remaining = exponent
        while remaining > 0 {
            if remaining & 1 == 1 { result *= multiplier }
            multiplier *= multiplier
            remaining >>= 1
        }
        return result
    }
}

extension Array where Element == Money {
    /// Médiane d'une série de montants.
    public func median(currency: Currency) -> Money? {
        guard let value = DecimalStatistics.median(map(\.amount)) else { return nil }
        return Money(value, currency)
    }

    public func mean(currency: Currency) -> Money? {
        guard let value = DecimalStatistics.mean(map(\.amount)) else { return nil }
        return Money(value, currency)
    }
}
