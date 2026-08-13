import Foundation

public enum DebtStrategy: String, Codable, CaseIterable, Sendable, Identifiable {
    /// Taux le plus élevé d'abord : optimal financièrement.
    case avalanche
    /// Solde le plus faible d'abord : optimal psychologiquement (premières victoires rapides).
    case snowball

    public var id: String { rawValue }
    public var localizationKey: String { "debt.strategy.\(rawValue)" }
}

public struct DebtPayoffStep: Hashable, Codable, Sendable, Identifiable {
    public let debtID: UUID
    public let name: String
    public let order: Int
    public let monthsToPayoff: Int?
    public let totalInterest: Money
    public let payoffDate: Date?

    public var id: UUID { debtID }
}

public struct DebtOverview: Hashable, Codable, Sendable {
    public let totalOutstanding: Money
    public let totalMonthlyPayment: Money
    public let monthlyInterest: Money
    /// Taux d'endettement : mensualités / revenus. Seuil d'alerte usuel : 33 %.
    public let debtToIncomeRatio: Decimal?
    public let highInterestDebts: [Debt]
    public let weightedAverageRate: Decimal?
    public let hasHighInterestDebt: Bool
}

public struct DebtPayoffPlan: Hashable, Codable, Sendable {
    public let strategy: DebtStrategy
    public let steps: [DebtPayoffStep]
    public let totalMonths: Int?
    public let totalInterest: Money
    /// Intérêts économisés par rapport au maintien des mensualités minimales.
    public let interestSaved: Money
    public let extraMonthlyPayment: Money
    public let debtFreeDate: Date?
}

public enum DebtEngine {

    /// Le plafond d'itérations borne les cas pathologiques (mensualité inférieure aux
    /// intérêts sur une dette révolving : le capital ne descend jamais).
    private static let maxSimulationMonths = 600

    // MARK: Vue d'ensemble

    public static func overview(profile: FinancialProfile, monthlyIncome: Money) -> DebtOverview {
        let currency = profile.currency
        let debts = profile.activeDebts

        let outstanding = Money.sum(debts.map(\.outstandingPrincipal), currency: currency)
        let payments = Money.sum(debts.map(\.monthlyPayment), currency: currency)
        let interest = Money.sum(debts.map(\.monthlyInterest), currency: currency)

        let weightedRate: Decimal? = {
            guard outstanding.amount > .zero else { return nil }
            let weighted = debts.reduce(Decimal.zero) { partial, debt in
                partial + debt.annualRate * debt.outstandingPrincipal.amount
            }
            return weighted / outstanding.amount
        }()

        let highInterest = debts.filter(\.isHighInterest)

        return DebtOverview(
            totalOutstanding: outstanding,
            totalMonthlyPayment: payments,
            monthlyInterest: interest,
            debtToIncomeRatio: payments.ratio(to: monthlyIncome),
            highInterestDebts: highInterest.sorted { $0.annualRate > $1.annualRate },
            weightedAverageRate: weightedRate,
            hasHighInterestDebt: !highInterest.isEmpty
        )
    }

    /// Seuil d'alerte du taux d'endettement, aligné sur la pratique du crédit en France
    /// et en Belgique.
    public static let debtToIncomeAlertThreshold = Decimal(string: "0.33") ?? 0

    // MARK: Ordonnancement

    public static func order(_ debts: [Debt], strategy: DebtStrategy) -> [Debt] {
        switch strategy {
        case .avalanche:
            return debts.sorted { lhs, rhs in
                if lhs.annualRate != rhs.annualRate { return lhs.annualRate > rhs.annualRate }
                return lhs.outstandingPrincipal < rhs.outstandingPrincipal
            }
        case .snowball:
            return debts.sorted { lhs, rhs in
                if lhs.outstandingPrincipal != rhs.outstandingPrincipal {
                    return lhs.outstandingPrincipal < rhs.outstandingPrincipal
                }
                return lhs.annualRate > rhs.annualRate
            }
        }
    }

    // MARK: Plan de remboursement

    /// Simule le remboursement mois par mois.
    ///
    /// Méthode « boule de neige » au sens large : la mensualité supplémentaire est
    /// affectée à la dette de tête ; quand celle-ci est soldée, sa mensualité rejoint
    /// l'enveloppe et accélère la suivante.
    public static func payoffPlan(
        debts: [Debt],
        strategy: DebtStrategy = .avalanche,
        extraMonthlyPayment: Money,
        currency: Currency,
        referenceDate: Date = Date(),
        calendar: Calendar = .gregorianUTC
    ) -> DebtPayoffPlan {

        let zero = Money(.zero, currency)
        let active = debts.filter { $0.isActive && $0.outstandingPrincipal.amount > .zero }

        guard !active.isEmpty else {
            return DebtPayoffPlan(
                strategy: strategy,
                steps: [],
                totalMonths: 0,
                totalInterest: zero,
                interestSaved: zero,
                extraMonthlyPayment: extraMonthlyPayment,
                debtFreeDate: referenceDate
            )
        }

        let baseline = simulate(active, extra: zero, strategy: strategy, currency: currency)
        let accelerated = simulate(active, extra: extraMonthlyPayment, strategy: strategy, currency: currency)

        let steps = accelerated.perDebt.enumerated().map { index, entry -> DebtPayoffStep in
            DebtPayoffStep(
                debtID: entry.debt.id,
                name: entry.debt.name,
                order: index + 1,
                monthsToPayoff: entry.months,
                totalInterest: entry.interest,
                payoffDate: entry.months.flatMap {
                    calendar.date(byAdding: .month, value: $0, to: referenceDate)
                }
            )
        }

        return DebtPayoffPlan(
            strategy: strategy,
            steps: steps,
            totalMonths: accelerated.totalMonths,
            totalInterest: accelerated.totalInterest,
            interestSaved: (baseline.totalInterest - accelerated.totalInterest).clampedToZero,
            extraMonthlyPayment: extraMonthlyPayment,
            debtFreeDate: accelerated.totalMonths.flatMap {
                calendar.date(byAdding: .month, value: $0, to: referenceDate)
            }
        )
    }

    private struct SimulationResult {
        let perDebt: [(debt: Debt, months: Int?, interest: Money)]
        let totalMonths: Int?
        let totalInterest: Money
    }

    private static func simulate(
        _ debts: [Debt],
        extra: Money,
        strategy: DebtStrategy,
        currency: Currency
    ) -> SimulationResult {

        let ordered = order(debts, strategy: strategy)
        var balances = ordered.map(\.outstandingPrincipal.amount)
        var interestPaid = [Decimal](repeating: .zero, count: ordered.count)
        var payoffMonth = [Int?](repeating: nil, count: ordered.count)

        // Enveloppe totale : mensualités contractuelles + effort supplémentaire.
        // Les mensualités des dettes soldées restent dans l'enveloppe (effet boule de neige).
        let contractual = ordered.map(\.monthlyPayment.amount)
        var month = 0

        while balances.contains(where: { $0 > .zero }) && month < maxSimulationMonths {
            month += 1

            // Intérêts du mois sur chaque solde restant.
            for index in balances.indices where balances[index] > .zero {
                let interest = balances[index] * ordered[index].monthlyRate
                balances[index] += interest
                interestPaid[index] += interest
            }

            // Budget disponible ce mois-ci.
            var budget = extra.amount
            for index in balances.indices {
                budget += contractual[index]
            }

            // Paiement minimal sur chaque dette encore vivante, la dette de tête en dernier
            // afin de lui verser tout le reliquat.
            var liveIndices = balances.indices.filter { balances[$0] > .zero }
            guard let leadIndex = liveIndices.first else { break }
            liveIndices.removeFirst()

            for index in liveIndices {
                let payment = min(contractual[index], balances[index])
                balances[index] -= payment
                budget -= payment
                if balances[index] <= .zero, payoffMonth[index] == nil {
                    balances[index] = .zero
                    payoffMonth[index] = month
                }
            }

            let leadPayment = min(max(budget, .zero), balances[leadIndex])
            balances[leadIndex] -= leadPayment
            if balances[leadIndex] <= .zero {
                balances[leadIndex] = .zero
                if payoffMonth[leadIndex] == nil { payoffMonth[leadIndex] = month }
            }

            // Aucune dette ne progresse : mensualités inférieures aux intérêts. On s'arrête
            // plutôt que de boucler jusqu'au plafond avec un résultat trompeur.
            if leadPayment <= .zero && liveIndices.isEmpty { break }
        }

        let perDebt = ordered.enumerated().map { index, debt in
            (debt: debt, months: payoffMonth[index], interest: Money(interestPaid[index], currency))
        }
        let allCleared = payoffMonth.allSatisfy { $0 != nil }

        return SimulationResult(
            perDebt: perDebt,
            totalMonths: allCleared ? payoffMonth.compactMap { $0 }.max() : nil,
            totalInterest: Money(DecimalStatistics.sum(interestPaid), currency)
        )
    }
}
