import Foundation

/// Une issue chiffrée proposée quand un objectif n'est pas atteignable tel quel.
/// Le §9 demande explicitement « voici trois solutions » — chacune est calculée,
/// jamais suggérée en langage vague.
public struct GoalAlternative: Hashable, Codable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable {
        case extendDeadline    // Allonger l'échéance
        case reduceTarget      // Réduire la cible
        case increaseCapacity  // Dégager de la capacité via l'optimisation
    }

    public let kind: Kind
    public let monthlyContribution: Money
    public let months: Int
    public let targetAmount: Money
    /// Effort supplémentaire requis par rapport à la capacité actuelle.
    public let additionalMonthlyEffort: Money

    public var id: String { kind.rawValue }
}

public struct GoalPlan: Hashable, Codable, Sendable, Identifiable {
    public let goal: Goal
    public let remaining: Money
    public let progress: Decimal
    public let monthsUntilTarget: Int?
    /// Mensualité nécessaire pour tenir l'échéance (§9 : 15 000 / 24 = 625 €).
    public let requiredMonthlyContribution: Money?
    /// Mensualité retenue : celle choisie par l'utilisateur, à défaut la mensualité requise.
    public let plannedMonthlyContribution: Money?
    public let projectedCompletionDate: Date?
    public let projectedCompletionMonths: Int?
    public let isFeasible: Bool
    public let capacityShortfall: Money?
    public let alternatives: [GoalAlternative]
    /// Écart entre la progression réelle et la progression théorique attendue à ce jour.
    public let scheduleDeviation: Decimal?

    public var id: UUID { goal.id }

    public var isAheadOfSchedule: Bool { (scheduleDeviation ?? 0) > 0 }
}

public enum GoalEngine {

    public static func plan(
        for goal: Goal,
        capacity: Money,
        referenceDate: Date = Date(),
        calendar: Calendar = .gregorianUTC
    ) -> GoalPlan {

        let currency = goal.targetAmount.currency
        let remaining = goal.remainingAmount

        let monthsUntilTarget: Int? = goal.targetDate.map { target in
            let from = YearMonth(date: referenceDate, calendar: calendar)
            let to = YearMonth(date: target, calendar: calendar)
            return max(0, from.months(until: to))
        }

        // Mensualité requise pour tenir l'échéance.
        let required: Money? = {
            guard let monthsUntilTarget, monthsUntilTarget > 0 else { return nil }
            return remaining / Decimal(monthsUntilTarget)
        }()

        let planned = goal.monthlyContribution ?? required

        // Date d'atteinte estimée au rythme retenu.
        let completionMonths: Int? = {
            guard remaining.amount > .zero else { return 0 }
            guard let planned, planned.amount > .zero else { return nil }
            return monthsToCover(remaining, at: planned)
        }()

        let completionDate: Date? = completionMonths.flatMap {
            calendar.date(byAdding: .month, value: $0, to: referenceDate)
        }

        let isFeasible: Bool = {
            guard let required else { return true } // sans échéance, tout rythme convient
            return required <= capacity
        }()

        let shortfall: Money? = {
            guard let required, required > capacity else { return nil }
            return required - capacity
        }()

        let alternatives = isFeasible
            ? []
            : self.alternatives(
                remaining: remaining,
                target: goal.targetAmount,
                current: goal.currentAmount,
                capacity: capacity,
                monthsUntilTarget: monthsUntilTarget,
                currency: currency
            )

        // Avance / retard : progression réelle vs progression théorique linéaire.
        let deviation: Decimal? = {
            guard let targetDate = goal.targetDate else { return nil }
            let totalMonths = YearMonth(date: goal.createdAt, calendar: calendar)
                .months(until: YearMonth(date: targetDate, calendar: calendar))
            guard totalMonths > 0 else { return nil }
            let elapsed = YearMonth(date: goal.createdAt, calendar: calendar)
                .months(until: YearMonth(date: referenceDate, calendar: calendar))
            guard elapsed > 0 else { return nil }
            let expected = min(Decimal(elapsed) / Decimal(totalMonths), 1)
            return goal.progress - expected
        }()

        return GoalPlan(
            goal: goal,
            remaining: remaining,
            progress: goal.progress,
            monthsUntilTarget: monthsUntilTarget,
            requiredMonthlyContribution: required,
            plannedMonthlyContribution: planned,
            projectedCompletionDate: completionDate,
            projectedCompletionMonths: completionMonths,
            isFeasible: isFeasible,
            capacityShortfall: shortfall,
            alternatives: alternatives,
            scheduleDeviation: deviation
        )
    }

    /// Trois issues chiffrées quand la mensualité requise dépasse la capacité.
    private static func alternatives(
        remaining: Money,
        target: Money,
        current: Money,
        capacity: Money,
        monthsUntilTarget: Int?,
        currency: Currency
    ) -> [GoalAlternative] {

        var results: [GoalAlternative] = []
        let zero = Money.zero(currency)

        // 1. Allonger l'échéance : même cible, même capacité, plus de temps.
        if capacity.amount > .zero, let months = monthsToCover(remaining, at: capacity) {
            results.append(
                GoalAlternative(
                    kind: .extendDeadline,
                    monthlyContribution: capacity,
                    months: months,
                    targetAmount: target,
                    additionalMonthlyEffort: zero
                )
            )
        }

        // 2. Réduire la cible : même échéance, même capacité, objectif ajusté.
        if let monthsUntilTarget, monthsUntilTarget > 0, capacity.amount > .zero {
            let reachable = current + capacity * Decimal(monthsUntilTarget)
            results.append(
                GoalAlternative(
                    kind: .reduceTarget,
                    monthlyContribution: capacity,
                    months: monthsUntilTarget,
                    targetAmount: reachable,
                    additionalMonthlyEffort: zero
                )
            )
        }

        // 3. Dégager de la capacité : même cible, même échéance, effort supplémentaire.
        if let monthsUntilTarget, monthsUntilTarget > 0 {
            let required = remaining / Decimal(monthsUntilTarget)
            results.append(
                GoalAlternative(
                    kind: .increaseCapacity,
                    monthlyContribution: required,
                    months: monthsUntilTarget,
                    targetAmount: target,
                    additionalMonthlyEffort: (required - capacity).clampedToZero
                )
            )
        }

        return results
    }

    /// Nombre de mois entiers nécessaires pour couvrir un montant à une mensualité donnée.
    public static func monthsToCover(_ amount: Money, at monthly: Money) -> Int? {
        guard monthly.amount > .zero else { return nil }
        guard amount.amount > .zero else { return 0 }
        let raw = amount.amount / monthly.amount
        var rounded = Decimal()
        var mutable = raw
        NSDecimalRound(&rounded, &mutable, 0, .up)
        return NSDecimalNumber(decimal: rounded).intValue
    }

    /// Plans de tous les objectifs actifs, triés par priorité puis par urgence d'échéance.
    public static func plans(
        profile: FinancialProfile,
        capacity: Money,
        referenceDate: Date = Date()
    ) -> [GoalPlan] {
        profile.activeGoals
            .map { plan(for: $0, capacity: capacity, referenceDate: referenceDate) }
            .sorted { lhs, rhs in
                if lhs.goal.priority != rhs.goal.priority {
                    return lhs.goal.priority < rhs.goal.priority
                }
                switch (lhs.monthsUntilTarget, rhs.monthsUntilTarget) {
                case let (left?, right?): return left < right
                case (nil, _?):           return false
                case (_?, nil):           return true
                default:                  return lhs.goal.name < rhs.goal.name
                }
            }
    }
}
