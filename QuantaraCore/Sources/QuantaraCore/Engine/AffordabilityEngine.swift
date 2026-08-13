import Foundation

public enum AffordabilityVerdict: String, Codable, Sendable {
    case comfortable   // Sans conséquence notable
    case tight         // Possible, mais avec un impact réel
    case risky         // Compromet un équilibre (trésorerie, fonds d'urgence, objectif)
    case unaffordable  // Hors de portée sans arbitrage majeur

    public var localizationKey: String { "affordability.\(rawValue)" }
}

public struct AffordabilityImpact: Hashable, Codable, Sendable {
    public let verdict: AffordabilityVerdict
    public let amount: Money
    /// Reste disponible du mois après l'achat.
    public let disposableAfter: Money
    /// Solde le plus bas projeté après l'achat.
    public let lowestProjectedBalance: Money?
    public let causesOverdraft: Bool
    /// Mois de couverture du fonds d'urgence après l'achat, si l'épargne est mobilisée.
    public let emergencyCoverageAfter: Decimal?
    /// Report induit sur les objectifs, en mois.
    public let goalDelayMonths: Int?
    public let affectedGoalName: String?
    /// Mensualité nécessaire pour se l'offrir à l'échéance visée, si épargne préalable.
    public let requiredMonthlySaving: Money?
    public let reasons: [String]
    public let alternatives: [String]
}

/// « Puis-je me le permettre ? »
///
/// La question que les utilisateurs se posent réellement, et à laquelle un tableau de
/// bord ne répond pas. Elle mobilise tout le reste du moteur : trésorerie, fonds
/// d'urgence, objectifs.
public enum AffordabilityEngine {

    public static func evaluate(
        amount: Money,
        targetDate: Date? = nil,
        profile: FinancialProfile,
        summary: MonthlySummary,
        emergencyFund: EmergencyFundPlan,
        cashFlow: CashFlowForecast?,
        goalPlans: [GoalPlan],
        referenceDate: Date = Date(),
        calendar: Calendar = .gregorianUTC
    ) -> AffordabilityImpact {

        let locale = Locale(identifier: "fr_FR")
        var reasons: [String] = []
        var alternatives: [String] = []

        let disposableAfter = summary.disposable - amount

        // --- Achat immédiat : impact trésorerie ---
        let lowestAfter = cashFlow.map { $0.lowestBalance - amount }
        let causesOverdraft = (lowestAfter?.amount ?? .zero) < .zero

        // --- Impact sur le fonds d'urgence si l'épargne doit être mobilisée ---
        let mustDipIntoSavings = disposableAfter.amount < .zero
        let emergencyAfter: Decimal? = {
            guard emergencyFund.monthlyEssentialExpenses.amount > .zero else { return nil }
            let balanceAfter = mustDipIntoSavings
                ? emergencyFund.currentBalance - disposableAfter.magnitude
                : emergencyFund.currentBalance
            return balanceAfter.amount / emergencyFund.monthlyEssentialExpenses.amount
        }()

        // --- Impact sur le premier objectif prioritaire ---
        let firstGoal = goalPlans.first { !$0.goal.isComplete && $0.goal.kind != .emergencyFund }
        let capacity = BudgetEngine.savingsCapacity(summary: summary, preferences: profile.preferences)
        let goalDelay: Int? = {
            guard firstGoal != nil, capacity.amount > .zero else { return nil }
            return GoalEngine.monthsToCover(amount, at: capacity)
        }()

        // --- Épargner d'abord plutôt qu'acheter maintenant ---
        let requiredMonthly: Money? = {
            guard let targetDate else { return nil }
            let months = YearMonth(date: referenceDate, calendar: calendar)
                .months(until: YearMonth(date: targetDate, calendar: calendar))
            guard months > 0 else { return nil }
            return amount / Decimal(months)
        }()

        // --- Verdict ---
        let verdict: AffordabilityVerdict
        if causesOverdraft {
            verdict = .unaffordable
            reasons.append("Cet achat ferait passer votre solde à \(lowestAfter?.formatted(locale: locale) ?? "un niveau négatif") avant la fin du mois.")
        } else if mustDipIntoSavings, let coverage = emergencyAfter, coverage < 3 {
            verdict = .risky
            reasons.append("Il faudrait puiser dans votre épargne de précaution, qui tomberait à \(formatMonths(coverage)) de couverture — sous le seuil de trois mois.")
        } else if mustDipIntoSavings {
            verdict = .tight
            reasons.append("Votre reste disponible ne suffit pas : \(disposableAfter.magnitude.formatted(locale: locale)) seraient prélevés sur votre épargne.")
        } else if let share = amount.ratio(to: summary.disposable.clampedToZero), share > (Decimal(string: "0.60") ?? 0) {
            verdict = .tight
            reasons.append("Cet achat représente \(Percent.format(share, locale: locale, fractionDigits: 0)) de votre reste disponible du mois.")
        } else {
            verdict = .comfortable
            reasons.append("Votre reste disponible passerait de \(summary.disposable.formatted(locale: locale)) à \(disposableAfter.formatted(locale: locale)).")
        }

        if let goalDelay, goalDelay > 0, let goal = firstGoal {
            reasons.append("Report d'environ \(goalDelay) mois sur « \(goal.goal.name) ».")
        }

        // --- Alternatives ---
        if verdict != .comfortable {
            if let requiredMonthly {
                alternatives.append("Épargner \(requiredMonthly.roundedToUnit.formatted(locale: locale)) par mois pour l'acheter comptant à la date visée.")
            }
            if capacity.amount > .zero, let months = GoalEngine.monthsToCover(amount, at: capacity) {
                alternatives.append("Attendre \(months) mois : votre capacité actuelle de \(capacity.roundedToUnit.formatted(locale: locale)) par mois y suffit sans toucher à l'épargne.")
            }
            alternatives.append("Étaler la dépense sur deux mois pour lisser l'impact sur la trésorerie.")
        }

        return AffordabilityImpact(
            verdict: verdict,
            amount: amount,
            disposableAfter: disposableAfter,
            lowestProjectedBalance: lowestAfter,
            causesOverdraft: causesOverdraft,
            emergencyCoverageAfter: emergencyAfter,
            goalDelayMonths: goalDelay,
            affectedGoalName: firstGoal?.goal.name,
            requiredMonthlySaving: requiredMonthly,
            reasons: reasons,
            alternatives: alternatives
        )
    }

    private static func formatMonths(_ months: Decimal) -> String {
        var rounded = Decimal()
        var mutable = months
        NSDecimalRound(&rounded, &mutable, 1, .plain)
        let formatted = rounded.formatted(
            .number.locale(Locale(identifier: "fr_FR")).precision(.fractionLength(0...1))
        )
        return "\(formatted) mois"
    }
}
