import Foundation

/// Outils que le modèle peut appeler. Chacun délègue à `QuantaraCore` :
/// le modèle décide **quoi** calculer, le moteur décide **combien**.
public enum AdvisorTool: String, CaseIterable, Sendable {
    case simulateSavings          = "simulate_savings"
    case timeToReachAmount        = "time_to_reach_amount"
    case planGoal                 = "plan_goal"
    case simulateIncomeChange     = "simulate_income_change"
    case simulateExpenseReduction = "simulate_expense_reduction"
    case debtPayoffPlan           = "debt_payoff_plan"
    case emergencyFundPlan        = "emergency_fund_plan"
    case categoryBreakdown        = "category_breakdown"
    case affordabilityCheck       = "affordability_check"
}

/// Erreur d'outil renvoyée au modèle.
///
/// Formulée pour être lue par lui : elle explique ce qui ne va pas et ce qu'il peut faire,
/// afin qu'il corrige son appel plutôt que d'inventer un résultat.
public struct AdvisorToolError: Error, Codable, Sendable {
    public let tool: String
    public let message: String
    public let hint: String?

    public init(tool: String, message: String, hint: String? = nil) {
        self.tool = tool
        self.message = message
        self.hint = hint
    }
}

// MARK: - Schémas

/// Définitions JSON Schema des outils, telles qu'envoyées à l'API.
///
/// Encodées en littéraux plutôt qu'assemblées dynamiquement : l'ordre des clés reste
/// stable d'un appel à l'autre, ce qui préserve le cache de prompt (les outils sont
/// rendus avant le système et les messages).
public enum AdvisorToolSchemas {

    /// Propriété calculée plutôt que constante globale : un `[[String: Any]]` n'est
    /// pas `Sendable`, et une constante statique de ce type serait rejetée sous
    /// concurrence stricte.
    public static var all: [[String: Any]] {
        [
        [
            "name": AdvisorTool.simulateSavings.rawValue,
            "description": "Projette l'évolution d'une épargne à versements mensuels réguliers, intérêts composés. À utiliser pour toute question du type « que se passe-t-il si j'épargne X par mois ? ».",
            "input_schema": [
                "type": "object",
                "properties": [
                    "monthly_amount": ["type": "number", "description": "Versement mensuel, dans la devise du profil."],
                    "years": ["type": "integer", "description": "Horizon en années (1 à 50)."],
                    "initial_amount": ["type": "number", "description": "Capital de départ. 0 si absent."],
                    "annual_return_percent": ["type": "number", "description": "Rendement annuel en pourcentage. Omettre pour utiliser l'hypothèse du profil."]
                ],
                "required": ["monthly_amount", "years"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.timeToReachAmount.rawValue,
            "description": "Calcule le nombre de mois nécessaires pour atteindre un montant cible à un rythme d'épargne donné. Pour les questions « quand aurai-je X ? ».",
            "input_schema": [
                "type": "object",
                "properties": [
                    "target_amount": ["type": "number", "description": "Montant à atteindre."],
                    "monthly_amount": ["type": "number", "description": "Versement mensuel."],
                    "initial_amount": ["type": "number", "description": "Capital de départ. 0 si absent."],
                    "annual_return_percent": ["type": "number", "description": "Rendement annuel en pourcentage."]
                ],
                "required": ["target_amount", "monthly_amount"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.planGoal.rawValue,
            "description": "Calcule la mensualité nécessaire pour un objectif, vérifie sa faisabilité au regard de la capacité d'épargne, et propose trois alternatives chiffrées si l'objectif n'est pas atteignable.",
            "input_schema": [
                "type": "object",
                "properties": [
                    "target_amount": ["type": "number", "description": "Montant visé."],
                    "months": ["type": "integer", "description": "Délai souhaité en mois."],
                    "current_amount": ["type": "number", "description": "Somme déjà constituée. 0 si absente."]
                ],
                "required": ["target_amount", "months"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.simulateIncomeChange.rawValue,
            "description": "Recalcule le budget après une variation de revenu exprimée en pourcentage.",
            "input_schema": [
                "type": "object",
                "properties": [
                    "percent_change": ["type": "number", "description": "Variation en pourcentage. 5 pour +5 %, -10 pour -10 %."]
                ],
                "required": ["percent_change"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.simulateExpenseReduction.rawValue,
            "description": "Recalcule le budget et la capacité d'épargne après une réduction mensuelle de dépenses.",
            "input_schema": [
                "type": "object",
                "properties": [
                    "monthly_amount": ["type": "number", "description": "Réduction mensuelle envisagée."]
                ],
                "required": ["monthly_amount"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.debtPayoffPlan.rawValue,
            "description": "Simule le remboursement des dettes avec une mensualité supplémentaire, selon la stratégie avalanche (taux décroissant) ou boule de neige (solde croissant).",
            "input_schema": [
                "type": "object",
                "properties": [
                    "extra_monthly_payment": ["type": "number", "description": "Effort mensuel supplémentaire. 0 pour le scénario de base."],
                    "strategy": ["type": "string", "enum": ["avalanche", "snowball"], "description": "Stratégie de remboursement."]
                ],
                "required": ["extra_monthly_payment"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.emergencyFundPlan.rawValue,
            "description": "Calcule la cible du fonds d'urgence pour un nombre de mois de couverture et la mensualité nécessaire pour l'atteindre à l'échéance choisie.",
            "input_schema": [
                "type": "object",
                "properties": [
                    "months_of_coverage": ["type": "integer", "description": "Mois de dépenses essentielles visés (3, 6 ou 9 typiquement)."],
                    "horizon_months": ["type": "integer", "description": "Délai souhaité pour l'atteindre, en mois."]
                ],
                "required": ["months_of_coverage"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.categoryBreakdown.rawValue,
            "description": "Renvoie l'historique mensuel d'une catégorie de dépense, sa moyenne et sa tendance.",
            "input_schema": [
                "type": "object",
                "properties": [
                    "category_id": ["type": "string", "description": "Identifiant de catégorie, au format « variable.groceries » ou « fixed.rent »."],
                    "months": ["type": "integer", "description": "Nombre de mois d'historique (1 à 24)."]
                ],
                "required": ["category_id"],
                "additionalProperties": false
            ]
        ],
        [
            "name": AdvisorTool.affordabilityCheck.rawValue,
            "description": "Évalue si un achat est soutenable : impact sur la trésorerie, sur le fonds d'urgence et sur les objectifs, avec un verdict et des alternatives.",
            "input_schema": [
                "type": "object",
                "properties": [
                    "amount": ["type": "number", "description": "Montant de l'achat envisagé."],
                    "target_date": ["type": "string", "description": "Date visée au format AAAA-MM-JJ. Omettre pour un achat immédiat."]
                ],
                "required": ["amount"],
                "additionalProperties": false
            ]
        ]
        ]
    }
}

// MARK: - Exécution

/// Exécute les appels d'outils du modèle contre le moteur de calcul.
///
/// Toute entrée aberrante produit une erreur explicite plutôt qu'un résultat trompeur :
/// un horizon de 500 ans ou un montant négatif doivent être signalés, pas absorbés.
public struct AdvisorToolRunner: Sendable {

    private let analysis: FinancialAnalysis
    private let locale: Locale

    public init(analysis: FinancialAnalysis, locale: Locale = Locale(identifier: "fr_FR")) {
        self.analysis = analysis
        self.locale = locale
    }

    /// Exécute un outil et renvoie son résultat sérialisé en JSON.
    public func run(tool name: String, input: [String: Any]) -> String {
        guard let tool = AdvisorTool(rawValue: name) else {
            return encode(AdvisorToolError(
                tool: name,
                message: "Outil inconnu.",
                hint: "Outils disponibles : \(AdvisorTool.allCases.map(\.rawValue).joined(separator: ", "))."
            ))
        }

        do {
            switch tool {
            case .simulateSavings:          return try encodeAny(simulateSavings(input))
            case .timeToReachAmount:        return try encodeAny(timeToReach(input))
            case .planGoal:                 return try encodeAny(planGoal(input))
            case .simulateIncomeChange:     return try encodeAny(simulateIncomeChange(input))
            case .simulateExpenseReduction: return try encodeAny(simulateExpenseReduction(input))
            case .debtPayoffPlan:           return try encodeAny(debtPayoff(input))
            case .emergencyFundPlan:        return try encodeAny(emergencyFund(input))
            case .categoryBreakdown:        return try encodeAny(categoryBreakdown(input))
            case .affordabilityCheck:       return try encodeAny(affordability(input))
            }
        } catch let error as AdvisorToolError {
            return encode(error)
        } catch {
            return encode(AdvisorToolError(tool: name, message: error.localizedDescription))
        }
    }

    // MARK: Implémentations

    private func simulateSavings(_ input: [String: Any]) throws -> [String: Any?] {
        let monthly = try decimal(input, "monthly_amount", tool: .simulateSavings, minimum: 0)
        let years = try integer(input, "years", tool: .simulateSavings, range: 1...50)
        let initial = (try? decimal(input, "initial_amount", tool: .simulateSavings, minimum: 0)) ?? 0
        let rate = optionalPercent(input, "annual_return_percent")
            ?? analysis.profile.preferences.assumedAnnualReturn

        let projection = SimulationEngine.projectSavings(
            monthlyContribution: Money(monthly, analysis.profile.currency),
            initialAmount: Money(initial, analysis.profile.currency),
            annualReturn: rate,
            months: years * 12,
            annualInflation: analysis.profile.preferences.assumedAnnualInflation,
            referenceDate: analysis.referenceDate
        )

        return [
            "final_amount": rounded(projection.finalAmount.amount),
            "total_contributed": rounded(projection.totalContributed.amount),
            "total_interest": rounded(projection.totalInterest.amount),
            "inflation_adjusted_final_amount": projection.inflationAdjustedFinalAmount.map { rounded($0.amount) },
            "annual_return_percent": rounded(rate * 100, scale: 2),
            "years": years,
            "yearly_points": projection.points.map { point in
                ["month": point.monthIndex, "total": rounded(point.total.amount)] as [String: Any]
            },
            "assumptions": projection.assumptions
        ]
    }

    private func timeToReach(_ input: [String: Any]) throws -> [String: Any?] {
        let target = try decimal(input, "target_amount", tool: .timeToReachAmount, minimum: 0)
        let monthly = try decimal(input, "monthly_amount", tool: .timeToReachAmount, minimum: 0)
        let initial = (try? decimal(input, "initial_amount", tool: .timeToReachAmount, minimum: 0)) ?? 0
        let rate = optionalPercent(input, "annual_return_percent")
            ?? analysis.profile.preferences.assumedAnnualReturn

        let currency = analysis.profile.currency
        guard let months = SimulationEngine.monthsToReach(
            target: Money(target, currency),
            monthlyContribution: Money(monthly, currency),
            initialAmount: Money(initial, currency),
            annualReturn: rate
        ) else {
            return [
                "reachable": false,
                "reason": "À ce rythme, la cible n'est pas atteinte avant 50 ans. Augmenter le versement mensuel est nécessaire."
            ]
        }

        let date = Calendar.gregorianUTC.date(byAdding: .month, value: months, to: analysis.referenceDate)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        return [
            "reachable": true,
            "months": months,
            "years": rounded(Decimal(months) / 12, scale: 1),
            "estimated_date": date.map { formatter.string(from: $0) },
            "annual_return_percent": rounded(rate * 100, scale: 2)
        ]
    }

    private func planGoal(_ input: [String: Any]) throws -> [String: Any?] {
        let target = try decimal(input, "target_amount", tool: .planGoal, minimum: 0)
        let months = try integer(input, "months", tool: .planGoal, range: 1...600)
        let current = (try? decimal(input, "current_amount", tool: .planGoal, minimum: 0)) ?? 0

        let currency = analysis.profile.currency
        let targetDate = Calendar.gregorianUTC.date(
            byAdding: .month,
            value: months,
            to: analysis.referenceDate
        )

        let goal = Goal(
            name: "Objectif simulé",
            targetAmount: Money(target, currency),
            currentAmount: Money(current, currency),
            targetDate: targetDate
        )

        let plan = GoalEngine.plan(
            for: goal,
            capacity: analysis.savingsCapacity,
            referenceDate: analysis.referenceDate
        )

        return [
            "required_monthly_contribution": plan.requiredMonthlyContribution.map { rounded($0.amount) },
            "current_savings_capacity": rounded(analysis.savingsCapacity.amount),
            "is_feasible": plan.isFeasible,
            "shortfall": plan.capacityShortfall.map { rounded($0.amount) },
            "months": months,
            "alternatives": plan.alternatives.map { alternative in
                [
                    "kind": alternative.kind.rawValue,
                    "monthly_contribution": rounded(alternative.monthlyContribution.amount),
                    "months": alternative.months,
                    "target_amount": rounded(alternative.targetAmount.amount),
                    "additional_monthly_effort": rounded(alternative.additionalMonthlyEffort.amount)
                ] as [String: Any]
            }
        ]
    }

    private func simulateIncomeChange(_ input: [String: Any]) throws -> [String: Any?] {
        let percent = try decimal(input, "percent_change", tool: .simulateIncomeChange, minimum: -100)
        let result = SimulationEngine.scenarioIncomeChange(
            percentChange: percent / 100,
            summary: analysis.summary,
            preferences: analysis.profile.preferences,
            referenceDate: analysis.referenceDate
        )
        return scenarioPayload(result)
    }

    private func simulateExpenseReduction(_ input: [String: Any]) throws -> [String: Any?] {
        let amount = try decimal(input, "monthly_amount", tool: .simulateExpenseReduction, minimum: 0)
        let result = SimulationEngine.scenarioExpenseReduction(
            amount: Money(amount, analysis.profile.currency),
            summary: analysis.summary,
            preferences: analysis.profile.preferences,
            referenceDate: analysis.referenceDate
        )
        return scenarioPayload(result)
    }

    private func scenarioPayload(_ result: ScenarioResult) -> [String: Any?] {
        [
            "monthly_disposable_change": rounded(result.monthlyDisposableChange.amount),
            "new_monthly_disposable": rounded(result.newMonthlyDisposable.amount),
            "new_savings_capacity": rounded(result.newSavingsCapacity.amount),
            "new_savings_rate_percent": result.newSavingsRate.map { rounded($0 * 100, scale: 1) },
            "ten_year_impact": rounded(result.tenYearImpact.amount),
            "assumptions": result.assumptions
        ]
    }

    private func debtPayoff(_ input: [String: Any]) throws -> [String: Any?] {
        let extra = try decimal(input, "extra_monthly_payment", tool: .debtPayoffPlan, minimum: 0)
        let strategyName = input["strategy"] as? String ?? "avalanche"
        guard let strategy = DebtStrategy(rawValue: strategyName) else {
            throw AdvisorToolError(
                tool: AdvisorTool.debtPayoffPlan.rawValue,
                message: "Stratégie inconnue : « \(strategyName) ».",
                hint: "Valeurs acceptées : avalanche, snowball."
            )
        }

        guard !analysis.profile.activeDebts.isEmpty else {
            return ["has_debts": false, "message": "Aucune dette n'est renseignée dans le profil."]
        }

        let plan = DebtEngine.payoffPlan(
            debts: analysis.profile.activeDebts,
            strategy: strategy,
            extraMonthlyPayment: Money(extra, analysis.profile.currency),
            currency: analysis.profile.currency,
            referenceDate: analysis.referenceDate
        )

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        return [
            "has_debts": true,
            "strategy": strategy.rawValue,
            "total_months": plan.totalMonths,
            "debt_free_date": plan.debtFreeDate.map { formatter.string(from: $0) },
            "total_interest": rounded(plan.totalInterest.amount),
            "interest_saved_versus_minimum": rounded(plan.interestSaved.amount),
            // Une dette dont l'échéance n'est pas calculable (mensualité inférieure aux
            // intérêts) n'expose pas la clé : `JSONSerialization` refuse un `Optional`,
            // et un champ absent se lit mieux qu'un `null`.
            "order": plan.steps.map { step -> [String: Any] in
                var entry: [String: Any] = [
                    "name": step.name,
                    "order": step.order,
                    "total_interest": rounded(step.totalInterest.amount)
                ]
                if let months = step.monthsToPayoff { entry["months_to_payoff"] = months }
                return entry
            }
        ]
    }

    private func emergencyFund(_ input: [String: Any]) throws -> [String: Any?] {
        let months = try integer(input, "months_of_coverage", tool: .emergencyFundPlan, range: 1...24)
        let horizon = (try? integer(input, "horizon_months", tool: .emergencyFundPlan, range: 1...240)) ?? 24

        let essential = analysis.emergencyFund.monthlyEssentialExpenses
        let target = essential * Decimal(months)
        let remaining = (target - analysis.emergencyFund.currentBalance).clampedToZero
        let monthly = remaining / Decimal(horizon)

        return [
            "monthly_essential_expenses": rounded(essential.amount),
            "current_balance": rounded(analysis.emergencyFund.currentBalance.amount),
            "months_of_coverage_now": rounded(analysis.emergencyFund.monthsOfCoverage, scale: 1),
            "target_months": months,
            "target_amount": rounded(target.amount),
            "remaining_to_target": rounded(remaining.amount),
            "horizon_months": horizon,
            "required_monthly_contribution": rounded(monthly.amount),
            "fits_current_capacity": monthly <= analysis.savingsCapacity,
            "current_savings_capacity": rounded(analysis.savingsCapacity.amount)
        ]
    }

    private func categoryBreakdown(_ input: [String: Any]) throws -> [String: Any?] {
        guard let identifier = input["category_id"] as? String,
              let category = ExpenseCategory(id: identifier) else {
            throw AdvisorToolError(
                tool: AdvisorTool.categoryBreakdown.rawValue,
                message: "Identifiant de catégorie invalide.",
                hint: "Format attendu : « variable.groceries » ou « fixed.rent »."
            )
        }
        let months = (try? integer(input, "months", tool: .categoryBreakdown, range: 1...24)) ?? 6

        let history = BudgetEngine.categoryHistory(
            category,
            profile: analysis.profile,
            endingAt: analysis.month,
            months: months
        )
        let amounts = history.map(\.amount.amount)

        return [
            "category": identifier,
            "is_essential": category.isEssential,
            "history": history.map { entry in
                ["month": entry.month.description, "amount": rounded(entry.amount.amount)] as [String: Any]
            },
            "average": DecimalStatistics.mean(amounts).map { rounded($0) },
            "median": DecimalStatistics.median(amounts).map { rounded($0) },
            "highest": amounts.max().map { rounded($0) },
            "lowest": amounts.min().map { rounded($0) }
        ]
    }

    private func affordability(_ input: [String: Any]) throws -> [String: Any?] {
        let amount = try decimal(input, "amount", tool: .affordabilityCheck, minimum: 0)
        let targetDate: Date? = (input["target_date"] as? String).flatMap { text in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withFullDate]
            return formatter.date(from: text)
        }

        let impact = AffordabilityEngine.evaluate(
            amount: Money(amount, analysis.profile.currency),
            targetDate: targetDate,
            profile: analysis.profile,
            summary: analysis.summary,
            emergencyFund: analysis.emergencyFund,
            cashFlow: analysis.cashFlow,
            goalPlans: analysis.goalPlans,
            referenceDate: analysis.referenceDate
        )

        return [
            "verdict": impact.verdict.rawValue,
            "disposable_after": rounded(impact.disposableAfter.amount),
            "lowest_projected_balance": impact.lowestProjectedBalance.map { rounded($0.amount) },
            "causes_overdraft": impact.causesOverdraft,
            "emergency_coverage_after_months": impact.emergencyCoverageAfter.map { rounded($0, scale: 1) },
            "goal_delay_months": impact.goalDelayMonths,
            "affected_goal": impact.affectedGoalName,
            "required_monthly_saving": impact.requiredMonthlySaving.map { rounded($0.amount) },
            "reasons": impact.reasons,
            "alternatives": impact.alternatives
        ]
    }

    // MARK: Validation des entrées

    private func decimal(
        _ input: [String: Any],
        _ key: String,
        tool: AdvisorTool,
        minimum: Decimal? = nil
    ) throws -> Decimal {
        let value: Decimal
        if let number = input[key] as? NSNumber {
            value = Decimal(string: number.stringValue) ?? .zero
        } else if let text = input[key] as? String, let parsed = Decimal(string: text) {
            value = parsed
        } else {
            throw AdvisorToolError(
                tool: tool.rawValue,
                message: "Paramètre « \(key) » manquant ou non numérique.",
                hint: "Fournis un nombre."
            )
        }
        if let minimum, value < minimum {
            throw AdvisorToolError(
                tool: tool.rawValue,
                message: "Le paramètre « \(key) » vaut \(value), en dessous du minimum autorisé (\(minimum)).",
                hint: "Corrige la valeur ou explique à l'utilisateur pourquoi elle n'a pas de sens."
            )
        }
        return value
    }

    private func integer(
        _ input: [String: Any],
        _ key: String,
        tool: AdvisorTool,
        range: ClosedRange<Int>
    ) throws -> Int {
        guard let number = input[key] as? NSNumber else {
            throw AdvisorToolError(
                tool: tool.rawValue,
                message: "Paramètre « \(key) » manquant ou non entier."
            )
        }
        let value = number.intValue
        guard range.contains(value) else {
            throw AdvisorToolError(
                tool: tool.rawValue,
                message: "Le paramètre « \(key) » vaut \(value), hors des bornes autorisées (\(range.lowerBound) à \(range.upperBound)).",
                hint: "Au-delà de ces bornes, le résultat n'aurait pas de sens financier."
            )
        }
        return value
    }

    private func optionalPercent(_ input: [String: Any], _ key: String) -> Decimal? {
        guard let number = input[key] as? NSNumber else { return nil }
        return (Decimal(string: number.stringValue) ?? .zero) / 100
    }

    // MARK: Encodage

    private func rounded(_ value: Decimal, scale: Int = 2) -> Decimal {
        var input = value
        var result = Decimal()
        NSDecimalRound(&result, &input, scale, .plain)
        return result
    }

    /// Sérialise un résultat d'outil.
    ///
    /// Les valeurs absentes sont retirées plutôt que sérialisées en `null` : un champ
    /// manquant se lit sans ambiguïté, là où `null` peut être compris comme « zéro ».
    private func encodeAny(_ payload: [String: Any?]) throws -> String {
        let compacted = payload.compactMapValues { $0.map(sanitize) }
        let data = try JSONSerialization.data(
            withJSONObject: compacted,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return String(decoding: data, as: UTF8.self)
    }

    /// `NSDecimalNumber` traverse `JSONSerialization` sans passer par un `Double` :
    /// la précision décimale est préservée jusque dans le JSON transmis au modèle.
    private func sanitize(_ value: Any) -> Any {
        switch value {
        case let decimal as Decimal:
            return NSDecimalNumber(decimal: decimal)
        case let dictionary as [String: Any]:
            return dictionary.mapValues(sanitize)
        case let array as [Any]:
            return array.map(sanitize)
        default:
            return value
        }
    }

    private func encode(_ error: AdvisorToolError) -> String {
        let payload: [String: Any] = [
            "error": error.message,
            "tool": error.tool,
            "hint": error.hint ?? ""
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        else { return "{\"error\":\"\(error.message)\"}" }
        return String(decoding: data, as: UTF8.self)
    }
}
