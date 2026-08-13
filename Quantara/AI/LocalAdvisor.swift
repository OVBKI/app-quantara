import Foundation
import QuantaraCore

/// Conseiller déterministe, sans réseau.
///
/// C'est le mode par défaut (§17 : « local uniquement »). Il ne converse pas librement,
/// mais il produit l'essentiel : plan financier, insights, optimisation, plans d'objectifs
/// et rapport mensuel. Le produit reste donc utile sans qu'aucune donnée ne quitte
/// l'appareil — ce qui n'est pas un mode dégradé de façade, mais un choix assumé.
struct LocalAdvisor: AdvisorService {

    let locale: Locale

    init(locale: Locale = Locale(identifier: "fr_FR")) {
        self.locale = locale
    }

    func respond(
        to question: String,
        analysis: FinancialAnalysis,
        history: [AdvisorMessage],
        task: AdvisorPrompt.Task
    ) -> AsyncThrowingStream<AdvisorChunk, Error> {

        let answer: String
        switch task {
        case .financialPlan:       answer = financialPlan(analysis)
        case .optimization:        answer = optimizationPlan(analysis)
        case .monthlyReport:       answer = monthlyReport(analysis)
        case .investmentEducation: answer = investmentGuidance(analysis)
        case .chat:                answer = self.answer(to: question, analysis: analysis)
        }

        return AsyncThrowingStream { continuation in
            // Restitution progressive : sans elle, une réponse instantanée passerait pour
            // un texte préenregistré plutôt que pour un raisonnement.
            let work = Task {
                for sentence in answer.split(separator: "\n", omittingEmptySubsequences: false) {
                    guard !Task.isCancelled else { break }
                    continuation.yield(.text(String(sentence) + "\n"))
                    try? await Task.sleep(for: .milliseconds(35))
                }
                continuation.yield(.done)
                continuation.finish()
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }

    // MARK: - Plan financier

    private func financialPlan(_ analysis: FinancialAnalysis) -> String {
        let summary = analysis.summary
        var lines: [String] = []

        lines.append("**Votre situation**")
        lines.append("")
        lines.append("Revenus : \(money(summary.income))")
        lines.append("Dépenses : \(money(summary.totalExpenses))")
        lines.append("Reste disponible : \(money(summary.disposable))")
        if let rate = summary.savingsRate {
            lines.append("Taux d'épargne : \(percent(rate))")
        }
        lines.append("")

        if analysis.allocation.lines.isEmpty {
            lines.append("Votre budget ne dégage pas de reste disponible ce mois-ci. La priorité est de réduire les charges avant d'envisager une répartition.")
            return lines.joined(separator: "\n")
        }

        lines.append("**Répartition proposée**")
        lines.append("")
        for line in analysis.allocation.lines {
            lines.append("• \(bucketName(line.bucket)) — \(money(line.amount.roundedToUnit))")
            lines.append("  \(line.rationale)")
            lines.append("")
        }

        if !analysis.allocation.skippedSteps.isEmpty {
            lines.append("**Ce qui n'a pas été retenu**")
            lines.append("")
            for skipped in analysis.allocation.skippedSteps {
                lines.append("• \(skipped)")
            }
            lines.append("")
        }

        if let first = analysis.insights.first(where: { $0.severity >= .warning }) {
            lines.append("**À faire en premier**")
            lines.append("")
            lines.append(first.message)
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Optimisation

    private func optimizationPlan(_ analysis: FinancialAnalysis) -> String {
        let plan = analysis.optimization
        guard !plan.isEmpty else {
            return "Je n'ai pas trouvé de piste d'économie significative ce mois-ci. Vos dépenses restent dans vos habitudes.\n\nC'est une bonne nouvelle : il n'y a rien à corriger."
        }

        var lines: [String] = []
        lines.append("**J'ai trouvé \(money(plan.totalMonthlySaving.roundedToUnit)) d'optimisation potentielle par mois.**")
        lines.append("")
        lines.append("Soit \(money(plan.totalAnnualSaving.roundedToUnit)) sur un an.")
        lines.append("")

        for opportunity in plan.opportunities where opportunity.monthlySaving.amount > 0 {
            lines.append("• **\(opportunity.title)** — \(money(opportunity.monthlySaving.roundedToUnit))/mois")
            lines.append("  \(opportunity.detail)")
            lines.append("  Effort : \(effortName(opportunity.effort)) · Confiance : \(percent(opportunity.confidence, digits: 0))")
            lines.append("")
        }

        lines.append("**Nouvelle capacité d'épargne : \(money(plan.projectedSavingsCapacity.roundedToUnit))/mois**")
        if let tenYear = plan.tenYearImpact {
            lines.append("")
            lines.append("Maintenue dix ans et placée à \(percent(analysis.profile.preferences.assumedAnnualReturn)), cette économie représenterait \(money(tenYear.roundedToUnit)). C'est une hypothèse de rendement, pas une promesse.")
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Rapport mensuel

    private func monthlyReport(_ analysis: FinancialAnalysis) -> String {
        let report = MonthlyReportEngine.report(
            for: analysis.month,
            profile: analysis.profile,
            referenceDate: analysis.referenceDate
        )
        var lines: [String] = []
        lines.append("**Rapport de \(analysis.month.formatted(locale: locale))**")
        lines.append("")
        for highlight in report.highlights {
            lines.append("• \(highlight)")
        }
        lines.append("")

        if !report.topCategories.isEmpty {
            lines.append("**Principaux postes**")
            lines.append("")
            for category in report.topCategories {
                lines.append("• \(categoryName(category.category)) — \(money(category.amount)) (\(percent(category.share, digits: 0)))")
            }
            lines.append("")
        }

        if !report.unusualExpenses.isEmpty {
            lines.append("**Dépenses inhabituelles**")
            lines.append("")
            for transaction in report.unusualExpenses {
                lines.append("• \(transaction.label) — \(money(transaction.effectiveAmount))")
            }
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Investissement

    private func investmentGuidance(_ analysis: FinancialAnalysis) -> String {
        let guidance = analysis.investment
        var lines: [String] = []

        lines.append("**Avant tout**")
        lines.append("")
        lines.append(guidance.disclaimer)
        lines.append("")

        lines.append("**Vos prérequis**")
        lines.append("")
        for check in guidance.readiness {
            lines.append("\(check.isSatisfied ? "✓" : "✗") \(check.title)")
            lines.append("  \(check.detail)")
            lines.append("")
        }

        guard guidance.isReady else {
            lines.append("**Ce qui bloque aujourd'hui**")
            lines.append("")
            for reason in guidance.blockingReasons {
                lines.append("• \(reason)")
            }
            return lines.joined(separator: "\n")
        }

        lines.append("**Classes d'actifs (à titre éducatif)**")
        lines.append("")
        for asset in guidance.assetClasses {
            lines.append("• **\(assetName(asset.assetClass))** — part indicative \(percent(asset.indicativeShare, digits: 0))")
            lines.append("  Horizon : \(asset.horizon)")
            lines.append("  Avantages : \(asset.advantages.joined(separator: " · "))")
            lines.append("  Risques : \(asset.risks.joined(separator: " · "))")
            lines.append("")
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Questions courantes

    /// Réponses gabarits, appariées par mots-clés. Volontairement limitées : mieux vaut
    /// renvoyer vers le mode avancé que simuler une conversation qu'on ne tient pas.
    private func answer(to question: String, analysis: FinancialAnalysis) -> String {
        let normalized = question.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale)
        let summary = analysis.summary

        if normalized.contains("equilibre") || normalized.contains("equilibr") {
            var text = "Votre budget \(summary.isBalanced ? "est équilibré" : "n'est pas équilibré") ce mois-ci.\n\n"
            text += "Revenus \(money(summary.income)), dépenses \(money(summary.totalExpenses)), reste \(money(summary.disposable)).\n"
            if let ratio = summary.fixedExpenseRatio {
                text += "\nVos charges fixes représentent \(percent(ratio)) de vos revenus."
                if ratio > InsightEngine.fixedExpenseLoadThreshold {
                    text += " Au-delà de 50 %, la marge de manœuvre devient très faible."
                }
            }
            return text
        }

        if normalized.contains("economis") || normalized.contains("epargn") {
            let capacity = analysis.savingsCapacity
            return "Votre capacité d'épargne actuelle est de \(money(capacity.roundedToUnit)) par mois.\n\n"
                + "Elle correspond à votre reste disponible (\(money(summary.disposable))) une fois préservée une marge d'argent libre de \(percent(analysis.profile.preferences.minimumFreeMoneyShare, digits: 0)).\n\n"
                + (analysis.optimization.isEmpty
                    ? "Je n'ai pas identifié de piste d'économie supplémentaire ce mois-ci."
                    : "Le plan d'optimisation identifie \(money(analysis.optimization.totalMonthlySaving.roundedToUnit)) supplémentaires par mois.")
        }

        if normalized.contains("investir") || normalized.contains("investis") {
            return investmentGuidance(analysis)
        }

        if normalized.contains("depense") && (normalized.contains("pourquoi") || normalized.contains("autant")) {
            guard let top = summary.categoryTotals.first else {
                return "Je n'ai pas encore assez de transactions pour analyser vos dépenses."
            }
            var text = "Votre premier poste ce mois-ci est \(categoryName(top.category)) : \(money(top.amount)), soit \(percent(top.share, digits: 0)) du total.\n"
            if let change = top.changeVersusAverage, change > 0 {
                text += "\nC'est \(percent(change, digits: 0)) au-dessus de votre moyenne des trois derniers mois."
            }
            return text
        }

        // Aucun gabarit ne correspond : le dire franchement plutôt que produire une
        // réponse vague qui donnerait l'illusion d'une conversation.
        return "Le mode « local uniquement » répond aux questions courantes sur votre budget, votre capacité d'épargne et vos objectifs, sans qu'aucune donnée ne quitte votre appareil.\n\n"
            + "Pour une conversation libre, activez l'IA avancée dans Réglages › Confidentialité. Vos données resteront agrégées : aucun libellé de transaction n'est transmis.\n\n"
            + "En attendant, voici l'essentiel : revenus \(money(summary.income)), dépenses \(money(summary.totalExpenses)), reste disponible \(money(summary.disposable))."
    }

    // MARK: - Formatage

    private func money(_ value: Money) -> String { value.formatted(locale: locale) }

    private func percent(_ value: Decimal?, digits: Int = 1) -> String {
        Percent.format(value, locale: locale, fractionDigits: digits)
    }

    private func bucketName(_ bucket: AllocationBucket) -> String {
        String(localized: String.LocalizationValue(bucket.localizationKey))
    }

    private func categoryName(_ category: ExpenseCategory) -> String {
        String(localized: String.LocalizationValue(category.localizationKey))
    }

    private func assetName(_ assetClass: AssetClass) -> String {
        String(localized: String.LocalizationValue(assetClass.localizationKey))
    }

    private func effortName(_ effort: OpportunityEffort) -> String {
        String(localized: String.LocalizationValue(effort.localizationKey))
    }
}
