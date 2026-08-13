import Foundation

public enum AllocationBucket: String, Codable, CaseIterable, Sendable, Identifiable {
    case safetyBuffer      // Coussin de sécurité immédiat
    case highInterestDebt  // Dettes coûteuses
    case emergencyFund     // Fonds d'urgence
    case goals             // Objectifs personnels
    case investment        // Investissement
    case freeMoney         // Argent libre

    public var id: String { rawValue }
    public var localizationKey: String { "allocation.\(rawValue)" }

    public var symbolName: String {
        switch self {
        case .safetyBuffer:     return "shield.fill"
        case .highInterestDebt: return "creditcard.trianglebadge.exclamationmark"
        case .emergencyFund:    return "shield.lefthalf.filled"
        case .goals:            return "target"
        case .investment:       return "chart.line.uptrend.xyaxis"
        case .freeMoney:        return "sparkles"
        }
    }
}

public struct AllocationLine: Hashable, Codable, Sendable, Identifiable {
    public let bucket: AllocationBucket
    public let amount: Money
    /// Part du disponible affectée à ce poste.
    public let share: Decimal
    /// Motif en clair. Affiché tel quel dans l'app et réutilisé par le conseiller IA,
    /// afin que l'écran et le chat ne racontent jamais deux histoires différentes.
    public let rationale: String
    /// Objectif ou dette concerné, quand la ligne en cible un précisément.
    public let targetID: UUID?
    public let targetName: String?

    public var id: String { "\(bucket.rawValue).\(targetID?.uuidString ?? "-")" }
}

public struct AllocationPlan: Hashable, Codable, Sendable {
    public let disposable: Money
    public let lines: [AllocationLine]
    public let allocated: Money
    public let unallocated: Money
    /// Étapes de la cascade non déclenchées, avec la raison — sert à expliquer
    /// pourquoi l'investissement n'apparaît pas.
    public let skippedSteps: [String]

    public func amount(for bucket: AllocationBucket) -> Money {
        let matching = lines.filter { $0.bucket == bucket }
        guard let first = matching.first else { return Money.zero(disposable.currency) }
        return Money.sum(matching.map(\.amount), currency: first.amount.currency)
    }
}

/// Répartition du reste disponible.
///
/// Cascade personnalisée, pas de règle fixe : le cahier des charges (§7) exclut
/// explicitement une répartition standard type 50/30/20. L'ordre suit la logique de
/// protection : on sécurise avant d'optimiser, on éteint les dettes coûteuses avant
/// d'investir, et on préserve toujours une marge d'argent libre.
public enum AllocationEngine {

    private static let safetyBufferShare = Decimal(string: "0.60") ?? 0
    private static let highInterestDebtShare = Decimal(string: "0.50") ?? 0
    private static let emergencyFundShare = Decimal(string: "0.40") ?? 0

    public static func plan(
        profile: FinancialProfile,
        summary: MonthlySummary,
        emergencyFund: EmergencyFundPlan,
        goalPlans: [GoalPlan],
        referenceDate: Date = Date()
    ) -> AllocationPlan {

        let currency = profile.currency
        let zero = Money.zero(currency)
        let disposable = summary.disposable.clampedToZero

        guard disposable.amount > .zero else {
            return AllocationPlan(
                disposable: summary.disposable,
                lines: [],
                allocated: zero,
                unallocated: zero,
                skippedSteps: ["Aucun reste disponible à répartir ce mois-ci."]
            )
        }

        var remaining = disposable
        var lines: [AllocationLine] = []
        var skipped: [String] = []

        // Marge d'argent libre réservée d'emblée : un budget qui affecte 100 % du
        // disponible ne tient jamais un mois entier.
        let freeMoneyFloor = disposable * profile.preferences.minimumFreeMoneyShare
        var budget = (remaining - freeMoneyFloor).clampedToZero

        // --- 1. Coussin de sécurité : moins d'un mois de charges essentielles ---
        if !emergencyFund.hasMinimumBuffer, emergencyFund.monthlyEssentialExpenses.amount > .zero {
            let needed = (emergencyFund.monthlyEssentialExpenses - emergencyFund.currentBalance).clampedToZero
            let amount = min(budget * safetyBufferShare, needed)
            if amount.amount > .zero {
                lines.append(
                    AllocationLine(
                        bucket: .safetyBuffer,
                        amount: amount,
                        share: amount.amount / disposable.amount,
                        rationale: "Votre épargne couvre \(formatMonths(emergencyFund.monthsOfCoverage)) de dépenses essentielles. En dessous d'un mois, le moindre imprévu se transforme en dette : ce poste passe avant tout le reste.",
                        targetID: nil,
                        targetName: nil
                    )
                )
                budget -= amount
            }
        }

        // --- 2. Dettes à taux élevé (> 8 %) ---
        let highInterest = profile.activeDebts.filter(\.isHighInterest)
            .sorted { $0.annualRate > $1.annualRate }
        if let debt = highInterest.first {
            let amount = min(budget * highInterestDebtShare, debt.outstandingPrincipal)
            if amount.amount > .zero {
                lines.append(
                    AllocationLine(
                        bucket: .highInterestDebt,
                        amount: amount,
                        share: amount.amount / disposable.amount,
                        rationale: "« \(debt.name) » coûte \(Percent.format(debt.annualRate, locale: frenchLocale)) par an. Rembourser plus vite rapporte ici un gain certain, supérieur au rendement moyen espéré d'un placement.",
                        targetID: debt.id,
                        targetName: debt.name
                    )
                )
                budget -= amount
            }
        } else if !profile.activeDebts.isEmpty {
            skipped.append("Aucune dette au-dessus de 8 % : le remboursement anticipé n'est pas prioritaire.")
        }

        // --- 3. Fonds d'urgence jusqu'au palier choisi ---
        if !emergencyFund.isFullyFunded, emergencyFund.remainingToTarget.amount > .zero {
            let amount = min(budget * emergencyFundShare, emergencyFund.remainingToTarget)
            if amount.amount > .zero {
                lines.append(
                    AllocationLine(
                        bucket: .emergencyFund,
                        amount: amount,
                        share: amount.amount / disposable.amount,
                        rationale: "Il reste \(emergencyFund.remainingToTarget.formatted(locale: frenchLocale)) pour atteindre \(emergencyFund.selectedMonths) mois de dépenses essentielles (\(emergencyFund.selectedTarget.formatted(locale: frenchLocale))).",
                        targetID: nil,
                        targetName: nil
                    )
                )
                budget -= amount
            }
        }

        // --- 4. Objectifs, par priorité puis urgence ---
        let fundableGoals = goalPlans
            .filter { $0.goal.kind != .emergencyFund && !$0.goal.isComplete }
        for goalPlan in fundableGoals where budget.amount > .zero {
            let requested = goalPlan.plannedMonthlyContribution
                ?? goalPlan.requiredMonthlyContribution
                ?? zero
            let amount = min(requested, budget)
            guard amount.amount > .zero else { continue }

            let rationale: String
            if let months = goalPlan.monthsUntilTarget, months > 0,
               let required = goalPlan.requiredMonthlyContribution {
                rationale = "« \(goalPlan.goal.name) » demande \(required.formatted(locale: frenchLocale)) par mois pour être atteint dans \(months) mois."
            } else {
                rationale = "« \(goalPlan.goal.name) » n'a pas d'échéance : la contribution s'ajuste à ce qui reste disponible."
            }

            lines.append(
                AllocationLine(
                    bucket: .goals,
                    amount: amount,
                    share: amount.amount / disposable.amount,
                    rationale: rationale,
                    targetID: goalPlan.goal.id,
                    targetName: goalPlan.goal.name
                )
            )
            budget -= amount
        }

        // --- 5. Investissement, sous conditions strictes ---
        let hasBuffer = emergencyFund.monthsOfCoverage >= 3
        let hasCostlyDebt = !highInterest.isEmpty
        if hasBuffer && !hasCostlyDebt && budget.amount > .zero {
            let amount = budget * profile.riskProfile.indicativeGrowthShare
            if amount.amount > .zero {
                lines.append(
                    AllocationLine(
                        bucket: .investment,
                        amount: amount,
                        share: amount.amount / disposable.amount,
                        rationale: "Votre fonds d'urgence couvre \(formatMonths(emergencyFund.monthsOfCoverage)) et aucune dette coûteuse ne subsiste : une part du surplus peut être orientée vers un horizon long. Information éducative — tout investissement comporte un risque de perte en capital.",
                        targetID: nil,
                        targetName: nil
                    )
                )
                budget -= amount
            }
        } else if !hasBuffer {
            skipped.append("Investissement écarté : le fonds d'urgence couvre \(formatMonths(emergencyFund.monthsOfCoverage)), moins que les 3 mois recommandés au préalable.")
        } else if hasCostlyDebt {
            skipped.append("Investissement écarté : une dette à plus de 8 % reste en cours ; la rembourser est un gain certain.")
        }

        // --- 6. Argent libre : la marge réservée + le solde non affecté ---
        let freeMoney = freeMoneyFloor + budget
        if freeMoney.amount > .zero {
            lines.append(
                AllocationLine(
                    bucket: .freeMoney,
                    amount: freeMoney,
                    share: freeMoney.amount / disposable.amount,
                    rationale: "Marge de manœuvre du mois. Un budget sans respiration n'est pas tenu — cette part n'a pas à être justifiée.",
                    targetID: nil,
                    targetName: nil
                )
            )
        }

        let allocated = Money.sum(lines.map(\.amount), currency: currency)
        remaining = (disposable - allocated).clampedToZero

        return AllocationPlan(
            disposable: summary.disposable,
            lines: lines,
            allocated: allocated,
            unallocated: remaining,
            skippedSteps: skipped
        )
    }

    // MARK: Aide au formatage

    private static let frenchLocale = Locale(identifier: "fr_FR")

    private static func formatMonths(_ months: Decimal) -> String {
        var rounded = Decimal()
        var mutable = months
        NSDecimalRound(&rounded, &mutable, 1, .plain)
        let value = NSDecimalNumber(decimal: rounded).doubleValue
        if value < 1 { return "moins d'un mois" }
        let formatted = rounded.formatted(.number.locale(frenchLocale).precision(.fractionLength(0...1)))
        return "\(formatted) mois"
    }
}
