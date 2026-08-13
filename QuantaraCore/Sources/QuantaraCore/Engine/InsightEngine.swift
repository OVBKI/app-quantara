import Foundation

public enum InsightSeverity: String, Codable, CaseIterable, Sendable, Comparable {
    case positive     // 🎯 Une bonne nouvelle
    case information  // 💡 Une information utile
    case warning      // ⚠️ Un point de vigilance
    case critical     // 🚨 Une action requise

    public var rank: Int {
        switch self {
        case .positive:    return 0
        case .information: return 1
        case .warning:     return 2
        case .critical:    return 3
        }
    }

    public static func < (lhs: InsightSeverity, rhs: InsightSeverity) -> Bool {
        lhs.rank < rhs.rank
    }
}

public enum InsightKind: String, Codable, CaseIterable, Sendable {
    case categoryDrift          // Une catégorie dérape
    case surplusAvailable       // Un surplus est disponible
    case goalAhead              // En avance sur un objectif
    case goalBehind             // En retard sur un objectif
    case savingsRateChange      // Le taux d'épargne bouge
    case subscriptionLoad       // Les abonnements pèsent
    case fixedExpenseLoad       // Les charges fixes pèsent
    case debtLoad               // L'endettement est élevé
    case overdraftRisk          // Découvert projeté
    case budgetOverrun          // Enveloppe dépassée
    case emergencyFundMilestone // Palier du fonds d'urgence atteint
    case unusualExpense         // Dépense inhabituelle
    case duplicateDebtEntry     // Un crédit semble saisi deux fois

    public var localizationKey: String { "insight.\(rawValue)" }
}

/// Action concrète attachée à un insight. Sans action, ce n'est qu'une notification
/// de plus — le §12 demande explicitement des propositions actionnables.
public enum InsightAction: Hashable, Codable, Sendable {
    case openCategory(String)
    case openGoal(UUID)
    case openDebt(UUID)
    case openSubscriptions
    case openCashFlow
    case runOptimization
    case adjustBudget(String)
    case openEmergencyFund
}

public struct Insight: Hashable, Codable, Sendable, Identifiable {
    public let id: String
    public let kind: InsightKind
    public let severity: InsightSeverity
    public let title: String
    public let message: String
    /// Amplitude chiffrée du phénomène, quand elle existe (montant en jeu).
    public let magnitude: Money?
    /// Variation relative, quand elle existe.
    public let variation: Decimal?
    public let action: InsightAction?

    public init(
        id: String,
        kind: InsightKind,
        severity: InsightSeverity,
        title: String,
        message: String,
        magnitude: Money? = nil,
        variation: Decimal? = nil,
        action: InsightAction? = nil
    ) {
        self.id = id
        self.kind = kind
        self.severity = severity
        self.title = title
        self.message = message
        self.magnitude = magnitude
        self.variation = variation
        self.action = action
    }
}

/// Détection proactive d'anomalies (§12).
///
/// Entièrement déterministe et locale : ces insights restent disponibles en mode
/// « local uniquement », sans qu'aucune donnée ne quitte l'appareil.
public enum InsightEngine {

    // Seuils explicites plutôt que magiques — ils sont documentés et testables.
    public static let categoryDriftThreshold      = Decimal(string: "0.20") ?? 0
    public static let surplusThreshold            = Decimal(string: "0.15") ?? 0
    public static let goalDeviationThreshold      = Decimal(string: "0.05") ?? 0
    public static let savingsRateChangeThreshold  = Decimal(string: "0.03") ?? 0
    // 2 % du revenu : à 4 000 € nets, soit 80 €/mois — l'ordre de grandeur de
    // l'exemple du cahier des charges (« plusieurs abonnements, 87 €/mois »).
    public static let subscriptionLoadThreshold   = Decimal(string: "0.02") ?? 0
    public static let fixedExpenseLoadThreshold   = Decimal(string: "0.50") ?? 0

    public static func insights(
        profile: FinancialProfile,
        summary: MonthlySummary,
        previousSummary: MonthlySummary?,
        emergencyFund: EmergencyFundPlan,
        goalPlans: [GoalPlan],
        cashFlow: CashFlowForecast?,
        referenceDate: Date = Date()
    ) -> [Insight] {

        var results: [Insight] = []
        let locale = Locale(identifier: "fr_FR")

        // --- Risque de découvert (le plus urgent) ---
        if let cashFlow, cashFlow.hasProjectedOverdraft {
            let dateText = cashFlow.lowestBalanceDate.map {
                $0.formatted(.dateTime.locale(locale).day().month(.wide))
            } ?? "ce mois-ci"
            results.append(
                Insight(
                    id: "overdraft",
                    kind: .overdraftRisk,
                    severity: .critical,
                    title: "Risque de découvert autour du \(dateText)",
                    message: "Au rythme actuel, votre solde descendrait à \(cashFlow.lowestBalance.formatted(locale: locale)). Décaler une dépense ou avancer une rentrée suffirait à repasser au-dessus.",
                    magnitude: cashFlow.lowestBalance,
                    action: .openCashFlow
                )
            )
        }

        // --- Dérive de catégorie ---
        for total in summary.categoryTotals {
            guard let change = total.changeVersusAverage, change > categoryDriftThreshold else { continue }
            guard total.amount.amount > .zero else { continue }
            results.append(
                Insight(
                    id: "drift.\(total.category.id)",
                    kind: .categoryDrift,
                    severity: change > categoryDriftThreshold * 2 ? .warning : .information,
                    title: "Dépenses en hausse",
                    message: "Vos dépenses de cette catégorie sont \(Percent.format(change, locale: locale, fractionDigits: 0)) plus élevées que votre moyenne des trois derniers mois (\(total.amount.formatted(locale: locale)) ce mois-ci).",
                    magnitude: total.amount,
                    variation: change,
                    action: .openCategory(total.category.id)
                )
            )
        }

        // --- Surplus disponible ---
        if let share = summary.disposable.ratio(to: summary.income),
           share > surplusThreshold,
           summary.disposable.amount > .zero {
            results.append(
                Insight(
                    id: "surplus",
                    kind: .surplusAvailable,
                    severity: .positive,
                    title: "\(summary.disposable.roundedToUnit.formatted(locale: locale)) disponibles ce mois-ci",
                    message: "Soit \(Percent.format(share, locale: locale, fractionDigits: 0)) de vos revenus. Les affecter maintenant évite qu'ils se dissolvent d'ici la fin du mois.",
                    magnitude: summary.disposable,
                    variation: share,
                    action: .runOptimization
                )
            )
        }

        // --- Avance / retard sur les objectifs ---
        for goalPlan in goalPlans {
            guard let deviation = goalPlan.scheduleDeviation else { continue }
            if deviation > goalDeviationThreshold {
                results.append(
                    Insight(
                        id: "goal.ahead.\(goalPlan.goal.id.uuidString)",
                        kind: .goalAhead,
                        severity: .positive,
                        title: "En avance sur « \(goalPlan.goal.name) »",
                        message: "Vous avez \(Percent.format(deviation, locale: locale, fractionDigits: 0)) d'avance sur le rythme prévu. Progression : \(Percent.format(goalPlan.progress, locale: locale, fractionDigits: 0)).",
                        variation: deviation,
                        action: .openGoal(goalPlan.goal.id)
                    )
                )
            } else if deviation < -goalDeviationThreshold {
                results.append(
                    Insight(
                        id: "goal.behind.\(goalPlan.goal.id.uuidString)",
                        kind: .goalBehind,
                        severity: .warning,
                        title: "Retard sur « \(goalPlan.goal.name) »",
                        message: "Il manque \(Percent.format(-deviation, locale: locale, fractionDigits: 0)) par rapport au rythme nécessaire. \(goalPlan.requiredMonthlyContribution.map { "Il faudrait \($0.formatted(locale: locale)) par mois." } ?? "")",
                        magnitude: goalPlan.remaining,
                        variation: deviation,
                        action: .openGoal(goalPlan.goal.id)
                    )
                )
            }
        }

        // --- Variation du taux d'épargne ---
        if let previousSummary,
           let current = summary.savingsRate,
           let previous = previousSummary.savingsRate {
            let delta = current - previous
            if abs(delta) >= savingsRateChangeThreshold {
                let improving = delta > 0
                results.append(
                    Insight(
                        id: "savingsRate",
                        kind: .savingsRateChange,
                        severity: improving ? .positive : .warning,
                        title: "Taux d'épargne : \(Percent.format(previous, locale: locale)) → \(Percent.format(current, locale: locale))",
                        message: improving
                            ? "Votre effort d'épargne progresse. Maintenu douze mois, cet écart représente \(((summary.income * delta) * 12).roundedToUnit.formatted(locale: locale))."
                            : "Votre effort d'épargne recule. L'écart représente \(((summary.income * (-delta)) * 12).roundedToUnit.formatted(locale: locale)) sur un an.",
                        variation: delta,
                        action: .runOptimization
                    )
                )
            }
        }

        // --- Poids des abonnements ---
        if let share = summary.subscriptionsTotal.ratio(to: summary.income),
           share > subscriptionLoadThreshold {
            results.append(
                Insight(
                    id: "subscriptions",
                    kind: .subscriptionLoad,
                    severity: .information,
                    title: "\(summary.subscriptionsTotal.roundedToUnit.formatted(locale: locale)) d'abonnements par mois",
                    message: "Soit \((summary.subscriptionsTotal * 12).roundedToUnit.formatted(locale: locale)) par an, \(Percent.format(share, locale: locale, fractionDigits: 0)) de vos revenus. Un passage en revue vaut souvent quelques dizaines d'euros.",
                    magnitude: summary.subscriptionsTotal,
                    variation: share,
                    action: .openSubscriptions
                )
            )
        }

        // --- Poids des charges fixes ---
        if let ratio = summary.fixedExpenseRatio, ratio > fixedExpenseLoadThreshold {
            results.append(
                Insight(
                    id: "fixedLoad",
                    kind: .fixedExpenseLoad,
                    severity: .warning,
                    title: "Charges fixes : \(Percent.format(ratio, locale: locale, fractionDigits: 0)) de vos revenus",
                    message: "Au-delà de 50 %, la marge de manœuvre devient très faible : les ajustements ne peuvent plus venir que des postes structurels (logement, crédits, assurances).",
                    magnitude: summary.fixedExpenses,
                    variation: ratio,
                    action: .adjustBudget("fixed")
                )
            )
        }

        // --- Taux d'endettement ---
        if let dti = summary.debtToIncomeRatio, dti > DebtEngine.debtToIncomeAlertThreshold {
            results.append(
                Insight(
                    id: "debtLoad",
                    kind: .debtLoad,
                    severity: .critical,
                    title: "Taux d'endettement : \(Percent.format(dti, locale: locale, fractionDigits: 0))",
                    message: "Au-dessus du seuil usuel de 33 %, tout imprévu devient difficile à absorber et l'accès à un nouveau crédit se ferme.",
                    magnitude: summary.debtPayments,
                    variation: dti,
                    action: profile.activeDebts.first.map { InsightAction.openDebt($0.id) }
                )
            )
        }

        // --- Palier du fonds d'urgence ---
        for tier in emergencyFund.tiers where tier.isReached {
            results.append(
                Insight(
                    id: "emergency.\(tier.months)",
                    kind: .emergencyFundMilestone,
                    severity: .positive,
                    title: "Fonds d'urgence : \(tier.months) mois couverts",
                    message: "Votre épargne de précaution atteint \(tier.target.formatted(locale: locale)), soit \(tier.months) mois de dépenses essentielles.",
                    magnitude: emergencyFund.currentBalance,
                    action: .openEmergencyFund
                )
            )
        }

        // --- Enveloppes dépassées ---
        for budget in profile.categoryBudgets where budget.isActive {
            guard let spent = summary.categoryTotals.first(where: { $0.category == budget.category })
            else { continue }
            guard spent.amount > budget.limit else { continue }
            let overrun = spent.amount - budget.limit
            results.append(
                Insight(
                    id: "overrun.\(budget.category.id)",
                    kind: .budgetOverrun,
                    severity: .warning,
                    title: "Enveloppe dépassée",
                    message: "Vous avez dépassé le plafond de \(budget.limit.formatted(locale: locale)) de \(overrun.formatted(locale: locale)).",
                    magnitude: overrun,
                    action: .openCategory(budget.category.id)
                )
            )
        }

        // --- Crédit saisi deux fois (dette + charge fixe) ---
        for debt in profile.activeDebts {
            let duplicate = profile.recurringExpenses.first { expense in
                expense.isActive
                    && expense.category.isDebtRelated
                    && expense.monthlyEquivalent == debt.monthlyPayment
            }
            if let duplicate {
                results.append(
                    Insight(
                        id: "duplicate.\(debt.id.uuidString)",
                        kind: .duplicateDebtEntry,
                        severity: .warning,
                        title: "Crédit peut-être compté deux fois",
                        message: "« \(debt.name) » et la charge fixe « \(duplicate.name) » ont la même mensualité. Si c'est le même crédit, supprimez la charge fixe : le budget la compte deux fois.",
                        magnitude: debt.monthlyPayment,
                        action: .openDebt(debt.id)
                    )
                )
            }
        }

        return results.sorted { lhs, rhs in
            if lhs.severity != rhs.severity { return lhs.severity > rhs.severity }
            let lhsMagnitude = lhs.magnitude?.amount ?? .zero
            let rhsMagnitude = rhs.magnitude?.amount ?? .zero
            return lhsMagnitude > rhsMagnitude
        }
    }
}
