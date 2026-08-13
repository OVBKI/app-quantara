import Foundation

public struct EmergencyFundTier: Hashable, Codable, Sendable, Identifiable {
    public let months: Int
    public let target: Money
    public let isReached: Bool
    /// Mensualité nécessaire pour atteindre ce palier à l'échéance choisie.
    public let requiredMonthlyContribution: Money?

    public var id: Int { months }
}

public struct EmergencyFundPlan: Hashable, Codable, Sendable {
    /// Dépenses essentielles mensuelles — la base du calcul (§10).
    public let monthlyEssentialExpenses: Money
    public let currentBalance: Money
    /// Couverture actuelle, en mois de dépenses essentielles.
    public let monthsOfCoverage: Decimal
    public let selectedMonths: Int
    public let selectedTarget: Money
    public let remainingToTarget: Money
    public let tiers: [EmergencyFundTier]
    public let requiredMonthlyContribution: Money?
    public let estimatedCompletionMonths: Int?
    public let isFullyFunded: Bool

    /// Le premier palier vraiment protecteur : un mois de charges essentielles.
    /// Tant qu'il n'est pas atteint, tout imprévu se transforme en dette.
    public var hasMinimumBuffer: Bool { monthsOfCoverage >= 1 }
}

public enum EmergencyFundEngine {

    public static let tierOptions = [3, 6, 9]

    public static func plan(
        profile: FinancialProfile,
        summary: MonthlySummary,
        horizonMonths: Int? = nil
    ) -> EmergencyFundPlan {

        let essential = summary.essentialExpenses
        let balance = emergencyFundBalance(profile: profile)

        let coverage: Decimal = essential.amount > .zero
            ? balance.amount / essential.amount
            : .zero

        let selectedMonths = profile.preferences.emergencyFundMonths
        let selectedTarget = essential * Decimal(selectedMonths)
        let remaining = (selectedTarget - balance).clampedToZero

        let capacity = BudgetEngine.savingsCapacity(summary: summary, preferences: profile.preferences)

        let tiers = tierOptions.map { months -> EmergencyFundTier in
            let target = essential * Decimal(months)
            let missing = (target - balance).clampedToZero
            let monthly: Money? = {
                guard let horizonMonths, horizonMonths > 0 else { return nil }
                return missing / Decimal(horizonMonths)
            }()
            return EmergencyFundTier(
                months: months,
                target: target,
                isReached: balance >= target,
                requiredMonthlyContribution: monthly
            )
        }

        let requiredMonthly: Money? = {
            if let horizonMonths, horizonMonths > 0 {
                return remaining / Decimal(horizonMonths)
            }
            return nil
        }()

        let completionMonths: Int? = {
            guard remaining.amount > .zero, capacity.amount > .zero else {
                return remaining.amount <= .zero ? 0 : nil
            }
            let raw = remaining.amount / capacity.amount
            var rounded = Decimal()
            var mutable = raw
            NSDecimalRound(&rounded, &mutable, 0, .up)
            return NSDecimalNumber(decimal: rounded).intValue
        }()

        return EmergencyFundPlan(
            monthlyEssentialExpenses: essential,
            currentBalance: balance,
            monthsOfCoverage: coverage,
            selectedMonths: selectedMonths,
            selectedTarget: selectedTarget,
            remainingToTarget: remaining,
            tiers: tiers,
            requiredMonthlyContribution: requiredMonthly,
            estimatedCompletionMonths: completionMonths,
            isFullyFunded: balance >= selectedTarget
        )
    }

    /// Solde affecté au fonds d'urgence.
    ///
    /// Si un objectif de type « fonds d'urgence » existe, il fait foi — l'utilisateur a
    /// explicitement fléché cette somme. Sinon, on retient l'épargne disponible, qui joue
    /// de fait ce rôle.
    public static func emergencyFundBalance(profile: FinancialProfile) -> Money {
        if let goal = profile.activeGoals.first(where: { $0.kind == .emergencyFund }) {
            return goal.currentAmount
        }
        return profile.savingsBalance
    }
}
