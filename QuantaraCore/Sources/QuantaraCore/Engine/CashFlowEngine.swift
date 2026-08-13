import Foundation

public struct CashFlowEvent: Hashable, Codable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable {
        case income
        case fixedExpense
        case debtPayment
    }

    public let id: UUID
    public let date: Date
    public let label: String
    public let amount: Money
    public let kind: Kind

    public var signedAmount: Money {
        kind == .income ? amount : amount.negated
    }
}

public struct CashFlowDay: Hashable, Codable, Sendable, Identifiable {
    public let date: Date
    public let dayOfMonth: Int
    public let openingBalance: Money
    public let events: [CashFlowEvent]
    public let variableSpending: Money
    public let closingBalance: Money

    public var id: Int { dayOfMonth }
}

public struct CashFlowForecast: Hashable, Codable, Sendable {
    public let month: YearMonth
    public let startingBalance: Money
    public let days: [CashFlowDay]
    public let endingBalance: Money
    /// Point bas de la trajectoire — l'indicateur qui compte vraiment.
    public let lowestBalance: Money
    public let lowestBalanceDate: Date?
    public let hasProjectedOverdraft: Bool
    /// Dépense variable quotidienne retenue pour la projection.
    public let dailyVariableRate: Money
    public let upcomingEvents: [CashFlowEvent]
}

/// Projection de trésorerie jour par jour.
///
/// Un budget équilibré sur le mois peut être à découvert le 12 si le loyer tombe avant
/// le salaire. Les agrégats mensuels ne le voient pas ; cette projection si.
public enum CashFlowEngine {

    public static func forecast(
        month: YearMonth,
        profile: FinancialProfile,
        summary: MonthlySummary,
        startingBalance: Money? = nil,
        referenceDate: Date = Date(),
        calendar: Calendar = .gregorianUTC
    ) -> CashFlowForecast {

        let currency = profile.currency
        let daysInMonth = month.numberOfDays(calendar: calendar)
        let isCurrentMonth = month.contains(referenceDate, calendar: calendar)
        let today = isCurrentMonth ? calendar.component(.day, from: referenceDate) : 0

        let opening = startingBalance ?? profile.liquidity

        // Rythme de dépense variable retenu : le réalisé du mois si l'échantillon est
        // suffisant, sinon la moyenne historique, sinon l'estimation d'onboarding.
        let dailyRate = dailyVariableRate(
            summary: summary,
            profile: profile,
            month: month,
            daysElapsed: today,
            daysInMonth: daysInMonth
        )

        let events = scheduledEvents(
            month: month,
            profile: profile,
            calendar: calendar
        )
        let eventsByDay = Dictionary(grouping: events) {
            calendar.component(.day, from: $0.date)
        }

        var balance = opening
        var days: [CashFlowDay] = []
        var lowest = opening
        var lowestDate: Date?

        for day in 1...daysInMonth {
            let date = month.date(day: day, calendar: calendar)
            let dayEvents = eventsByDay[day] ?? []
            let dayOpening = balance

            for event in dayEvents {
                balance += event.signedAmount
            }

            // Le passé du mois en cours est déjà reflété dans le solde de départ :
            // n'y réappliquons pas une dépense théorique.
            let variable = (isCurrentMonth && day <= today) ? Money.zero(currency) : dailyRate
            balance -= variable

            if balance < lowest {
                lowest = balance
                lowestDate = date
            }

            days.append(
                CashFlowDay(
                    date: date,
                    dayOfMonth: day,
                    openingBalance: dayOpening,
                    events: dayEvents,
                    variableSpending: variable,
                    closingBalance: balance
                )
            )
        }

        let upcoming = events
            .filter { $0.date >= referenceDate }
            .sorted { $0.date < $1.date }

        return CashFlowForecast(
            month: month,
            startingBalance: opening,
            days: days,
            endingBalance: balance,
            lowestBalance: lowest,
            lowestBalanceDate: lowestDate,
            hasProjectedOverdraft: lowest.amount < .zero,
            dailyVariableRate: dailyRate,
            upcomingEvents: Array(upcoming.prefix(10))
        )
    }

    /// Échéances datées du mois : revenus, charges fixes, mensualités de crédit.
    ///
    /// Faute de jour renseigné, une charge est placée au 1er (prudent : elle pèse tôt)
    /// et un revenu à la fin du mois (prudent aussi : il arrive tard).
    public static func scheduledEvents(
        month: YearMonth,
        profile: FinancialProfile,
        calendar: Calendar = .gregorianUTC
    ) -> [CashFlowEvent] {

        var events: [CashFlowEvent] = []
        let daysInMonth = month.numberOfDays(calendar: calendar)

        for income in profile.activeIncomes(in: month) where income.frequency.isRecurring {
            let day = income.dayOfMonth ?? daysInMonth
            events.append(
                CashFlowEvent(
                    id: income.id,
                    date: month.date(day: day, calendar: calendar),
                    label: income.name,
                    amount: income.monthlyEquivalent,
                    kind: .income
                )
            )
        }

        for expense in profile.activeRecurringExpenses(in: month) {
            let day = expense.dayOfMonth ?? 1
            events.append(
                CashFlowEvent(
                    id: expense.id,
                    date: month.date(day: day, calendar: calendar),
                    label: expense.name,
                    amount: expense.monthlyEquivalent,
                    kind: .fixedExpense
                )
            )
        }

        for debt in profile.activeDebts where debt.monthlyPayment.amount > .zero {
            events.append(
                CashFlowEvent(
                    id: debt.id,
                    date: month.date(day: 5, calendar: calendar),
                    label: debt.name,
                    amount: debt.monthlyPayment,
                    kind: .debtPayment
                )
            )
        }

        return events.sorted { $0.date < $1.date }
    }

    private static func dailyVariableRate(
        summary: MonthlySummary,
        profile: FinancialProfile,
        month: YearMonth,
        daysElapsed: Int,
        daysInMonth: Int
    ) -> Money {
        let currency = profile.currency

        if daysElapsed >= 5, summary.variableSpentToDate.amount > .zero {
            return summary.variableSpentToDate / Decimal(daysElapsed)
        }
        if let historical = BudgetEngine.averageVariableSpending(
            profile: profile,
            endingAt: month.previous,
            months: 3
        ) {
            return historical / Decimal(daysInMonth)
        }
        if let estimate = profile.estimatedMonthlyVariableSpending {
            return estimate / Decimal(daysInMonth)
        }
        return Money.zero(currency)
    }
}
