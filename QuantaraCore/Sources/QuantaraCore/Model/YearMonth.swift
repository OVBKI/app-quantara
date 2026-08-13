import Foundation

/// Repère de période budgétaire (année + mois).
///
/// On n'utilise pas `Date` comme clé de période : un `Date` porte une heure et un fuseau,
/// deux sources de bugs quand on compare des mois.
public struct YearMonth: Hashable, Codable, Sendable, Comparable, CustomStringConvertible {

    public let year: Int
    public let month: Int   // 1...12

    public init(year: Int, month: Int) {
        precondition((1...12).contains(month), "Mois invalide : \(month)")
        self.year = year
        self.month = month
    }

    public init(date: Date, calendar: Calendar = .gregorianUTC) {
        let components = calendar.dateComponents([.year, .month], from: date)
        self.init(year: components.year ?? 1970, month: components.month ?? 1)
    }

    public static func current(calendar: Calendar = .gregorianUTC, now: Date = Date()) -> YearMonth {
        YearMonth(date: now, calendar: calendar)
    }

    // MARK: - Navigation

    public func adding(months delta: Int) -> YearMonth {
        let zeroBased = (year * 12 + (month - 1)) + delta
        return YearMonth(year: zeroBased / 12, month: zeroBased % 12 + 1)
    }

    public var previous: YearMonth { adding(months: -1) }
    public var next: YearMonth { adding(months: 1) }

    /// Nombre de mois séparant deux périodes (positif si `other` est postérieur).
    public func months(until other: YearMonth) -> Int {
        (other.year * 12 + other.month) - (year * 12 + month)
    }

    public static func range(from start: YearMonth, count: Int) -> [YearMonth] {
        guard count > 0 else { return [] }
        return (0..<count).map { start.adding(months: $0) }
    }

    /// Les `count` derniers mois se terminant par celui-ci (inclus), du plus ancien au plus récent.
    public func lastMonths(_ count: Int) -> [YearMonth] {
        guard count > 0 else { return [] }
        return (0..<count).map { adding(months: -(count - 1 - $0)) }
    }

    // MARK: - Dates

    public func startDate(calendar: Calendar = .gregorianUTC) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: 1)) ?? Date(timeIntervalSince1970: 0)
    }

    public func endDate(calendar: Calendar = .gregorianUTC) -> Date {
        let start = startDate(calendar: calendar)
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: start) ?? start
        return calendar.date(byAdding: .second, value: -1, to: nextMonth) ?? start
    }

    public func numberOfDays(calendar: Calendar = .gregorianUTC) -> Int {
        calendar.range(of: .day, in: .month, for: startDate(calendar: calendar))?.count ?? 30
    }

    public func contains(_ date: Date, calendar: Calendar = .gregorianUTC) -> Bool {
        YearMonth(date: date, calendar: calendar) == self
    }

    /// Date correspondant à un jour du mois, saturée au dernier jour si nécessaire
    /// (un prélèvement au 31 tombe le 28 ou le 29 en février).
    public func date(day: Int, calendar: Calendar = .gregorianUTC) -> Date {
        let clamped = min(max(day, 1), numberOfDays(calendar: calendar))
        return calendar.date(from: DateComponents(year: year, month: month, day: clamped))
            ?? startDate(calendar: calendar)
    }

    // MARK: - Comparable

    public static func < (lhs: YearMonth, rhs: YearMonth) -> Bool {
        (lhs.year, lhs.month) < (rhs.year, rhs.month)
    }

    // MARK: - Affichage

    public var description: String { String(format: "%04d-%02d", year, month) }

    public func formatted(locale: Locale = .current, style: Date.FormatStyle.Symbol.Month = .wide) -> String {
        let date = startDate()
        return date.formatted(
            Date.FormatStyle(calendar: .gregorianUTC, timeZone: .gmt)
                .locale(locale)
                .month(style)
                .year()
        )
    }
}

extension Calendar {
    /// Calendrier de référence pour tous les calculs de période : grégorien, UTC.
    /// Un calcul budgétaire ne doit pas changer de résultat selon le fuseau de l'appareil.
    public static let gregorianUTC: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        return calendar
    }()
}
