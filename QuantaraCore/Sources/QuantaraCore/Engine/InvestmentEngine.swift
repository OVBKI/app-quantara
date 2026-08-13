import Foundation

public enum AssetClass: String, Codable, CaseIterable, Sendable, Identifiable {
    case cash          // Liquidités / livrets
    case bonds         // Obligations
    case equityETF     // ETF actions diversifiés
    case stocks        // Actions en direct
    case funds         // Fonds gérés
    case realEstate    // Immobilier (dont pierre-papier)
    case other         // Autres placements

    public var id: String { rawValue }
    public var localizationKey: String { "asset.\(rawValue)" }

    /// Horizon en dessous duquel cette classe d'actifs est généralement déconseillée.
    public var typicalHorizonYears: Int {
        switch self {
        case .cash:       return 0
        case .bonds:      return 3
        case .funds:      return 5
        case .equityETF:  return 8
        case .realEstate: return 10
        case .stocks:     return 10
        case .other:      return 5
        }
    }

    /// Niveau de risque relatif (1 = faible, 5 = élevé). Repère pédagogique, pas une note.
    public var riskLevel: Int {
        switch self {
        case .cash:       return 1
        case .bonds:      return 2
        case .funds:      return 3
        case .realEstate: return 3
        case .equityETF:  return 4
        case .stocks:     return 5
        case .other:      return 4
        }
    }
}

public struct AssetClassEducation: Hashable, Codable, Sendable, Identifiable {
    public let assetClass: AssetClass
    public let indicativeShare: Decimal
    public let advantages: [String]
    public let risks: [String]
    public let horizon: String

    public var id: String { assetClass.rawValue }
}

public struct ReadinessCheck: Hashable, Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let detail: String
    public let isSatisfied: Bool
    public let isBlocking: Bool
}

public struct InvestmentGuidance: Hashable, Codable, Sendable {
    public let readiness: [ReadinessCheck]
    public let isReady: Bool
    /// Montant mensuel envisageable une fois les prérequis remplis.
    public let indicativeMonthlyCapacity: Money
    public let riskProfile: RiskProfile
    public let horizonYears: Int
    public let assetClasses: [AssetClassEducation]
    public let blockingReasons: [String]
    /// Avertissement non masquable, affiché avant tout contenu (§11).
    public let disclaimer: String

    public static let standardDisclaimer = """
    Ces informations sont fournies à titre éducatif et ne constituent pas un conseil en \
    investissement personnalisé. Tout investissement comporte un risque de perte en \
    capital, y compris totale. Les performances passées ne préjugent pas des \
    performances futures. Aucun rendement n'est garanti. Pour une recommandation \
    adaptée à votre situation, adressez-vous à un conseiller financier agréé.
    """
}

/// Volet investissement — **éducatif uniquement**.
///
/// Le §11 demandait une « stratégie personnalisée ». En Union européenne, une
/// recommandation personnalisée portant sur un instrument financier relève du conseil
/// en investissement (MiFID II) et suppose un agrément. Ce moteur produit donc :
/// des classes d'actifs génériques, jamais de produit, d'émetteur, d'ISIN ni de courtier ;
/// un langage descriptif et non prescriptif ; et des prérequis explicites.
public enum InvestmentEngine {

    public static func guidance(
        profile: FinancialProfile,
        summary: MonthlySummary,
        emergencyFund: EmergencyFundPlan,
        allocation: AllocationPlan
    ) -> InvestmentGuidance {

        let currency = profile.currency
        let locale = Locale(identifier: "fr_FR")
        var checks: [ReadinessCheck] = []
        var blocking: [String] = []

        // --- Prérequis 1 : fonds d'urgence ---
        let hasThreeMonths = emergencyFund.monthsOfCoverage >= 3
        checks.append(
            ReadinessCheck(
                id: "emergencyFund",
                title: "Fonds d'urgence d'au moins 3 mois",
                detail: hasThreeMonths
                    ? "Votre épargne de précaution couvre vos dépenses essentielles au-delà de trois mois."
                    : "Votre épargne couvre \(emergencyFund.currentBalance.formatted(locale: locale)) sur les \((emergencyFund.monthlyEssentialExpenses * 3).formatted(locale: locale)) correspondant à trois mois de dépenses essentielles. Investir avant d'avoir ce socle expose à devoir vendre au pire moment.",
                isSatisfied: hasThreeMonths,
                isBlocking: true
            )
        )
        if !hasThreeMonths {
            blocking.append("Avant d'investir, votre fonds d'urgence devrait idéalement atteindre \((emergencyFund.monthlyEssentialExpenses * 3).roundedToUnit.formatted(locale: locale)).")
        }

        // --- Prérequis 2 : dettes coûteuses ---
        let costlyDebts = profile.activeDebts.filter(\.isHighInterest)
        let hasNoCostlyDebt = costlyDebts.isEmpty
        checks.append(
            ReadinessCheck(
                id: "debts",
                title: "Aucune dette à taux élevé",
                detail: hasNoCostlyDebt
                    ? "Aucun crédit au-dessus de 8 % ne pèse sur votre budget."
                    : "\(costlyDebts.count) crédit(s) au-dessus de 8 % : les rembourser rapporte un gain certain, là où un placement ne rapporte qu'une espérance.",
                isSatisfied: hasNoCostlyDebt,
                isBlocking: true
            )
        )
        if !hasNoCostlyDebt {
            blocking.append("Rembourser les crédits à plus de 8 % rapporte davantage, et sans risque, qu'un placement diversifié.")
        }

        // --- Prérequis 3 : capacité régulière ---
        let capacity = allocation.amount(for: .investment)
        let hasCapacity = capacity.amount > .zero
        checks.append(
            ReadinessCheck(
                id: "capacity",
                title: "Capacité mensuelle régulière",
                detail: hasCapacity
                    ? "Votre budget dégage \(capacity.roundedToUnit.formatted(locale: locale)) par mois mobilisables sur un horizon long."
                    : "Aucun montant n'est actuellement dégagé pour un horizon long une fois les priorités couvertes.",
                isSatisfied: hasCapacity,
                isBlocking: false
            )
        )

        // --- Prérequis 4 : horizon cohérent avec le profil ---
        let horizonOK = profile.investmentHorizonYears >= profile.riskProfile.minimumHorizonYears
        checks.append(
            ReadinessCheck(
                id: "horizon",
                title: "Horizon cohérent avec le profil de risque",
                detail: horizonOK
                    ? "Votre horizon de \(profile.investmentHorizonYears) ans est compatible avec un profil \(profile.riskProfile.rawValue)."
                    : "Un profil \(profile.riskProfile.rawValue) suppose généralement au moins \(profile.riskProfile.minimumHorizonYears) ans, contre \(profile.investmentHorizonYears) an(s) indiqués.",
                isSatisfied: horizonOK,
                isBlocking: false
            )
        )

        let isReady = checks.filter(\.isBlocking).allSatisfy(\.isSatisfied) && hasCapacity

        return InvestmentGuidance(
            readiness: checks,
            isReady: isReady,
            indicativeMonthlyCapacity: hasCapacity ? capacity : Money(.zero, currency),
            riskProfile: profile.riskProfile,
            horizonYears: profile.investmentHorizonYears,
            assetClasses: education(
                for: profile.riskProfile,
                horizonYears: profile.investmentHorizonYears
            ),
            blockingReasons: blocking,
            disclaimer: InvestmentGuidance.standardDisclaimer
        )
    }

    /// Répartition indicative par classe d'actifs.
    ///
    /// Volontairement grossière (par cinquièmes) : une précision au pourcentage près
    /// donnerait l'illusion d'une recommandation calibrée, ce que ce contenu n'est pas.
    public static func education(
        for profile: RiskProfile,
        horizonYears: Int
    ) -> [AssetClassEducation] {

        let growthShare = profile.indicativeGrowthShare
        let defensiveShare = 1 - growthShare
        // Horizon court : on renforce la poche de liquidités quel que soit le profil.
        let cashShare = horizonYears < 3 ? (Decimal(string: "0.30") ?? 0) : (Decimal(string: "0.10") ?? 0)
        let bondShare = (defensiveShare - cashShare).clamped(min: 0)
        let equityShare = growthShare * (Decimal(string: "0.70") ?? 0)
        let realEstateShare = growthShare * (Decimal(string: "0.20") ?? 0)
        let otherShare = growthShare * (Decimal(string: "0.10") ?? 0)

        return [
            AssetClassEducation(
                assetClass: .cash,
                indicativeShare: cashShare,
                advantages: [
                    "Disponible immédiatement",
                    "Capital nominal préservé",
                    "Aucune volatilité"
                ],
                risks: [
                    "Rendement souvent inférieur à l'inflation : le pouvoir d'achat s'érode"
                ],
                horizon: "Court terme (moins de 3 ans)"
            ),
            AssetClassEducation(
                assetClass: .bonds,
                indicativeShare: bondShare,
                advantages: [
                    "Revenus plus prévisibles que les actions",
                    "Volatilité généralement plus faible",
                    "Amortit les baisses des marchés actions"
                ],
                risks: [
                    "Sensibilité aux taux d'intérêt : la valeur baisse quand les taux montent",
                    "Risque de défaut de l'émetteur"
                ],
                horizon: "Moyen terme (3 à 8 ans)"
            ),
            AssetClassEducation(
                assetClass: .equityETF,
                indicativeShare: equityShare,
                advantages: [
                    "Diversification immédiate sur des centaines d'entreprises",
                    "Frais généralement faibles",
                    "Historiquement, le meilleur rendement réel sur longue période"
                ],
                risks: [
                    "Forte volatilité : des baisses de 30 à 50 % sont survenues par le passé",
                    "Aucune garantie sur le capital",
                    "Perte possible si l'on doit vendre au mauvais moment"
                ],
                horizon: "Long terme (8 ans et plus)"
            ),
            AssetClassEducation(
                assetClass: .realEstate,
                indicativeShare: realEstateShare,
                advantages: [
                    "Revenus locatifs potentiellement réguliers",
                    "Décorrélation partielle des marchés financiers"
                ],
                risks: [
                    "Faible liquidité : la revente prend du temps",
                    "Frais d'entrée et de gestion élevés",
                    "Vacance locative et impayés"
                ],
                horizon: "Long terme (10 ans et plus)"
            ),
            AssetClassEducation(
                assetClass: .other,
                indicativeShare: otherShare,
                advantages: [
                    "Diversification supplémentaire"
                ],
                risks: [
                    "Risques très variables selon le support",
                    "Souvent moins liquides et moins régulés",
                    "À n'envisager qu'après avoir compris précisément le produit"
                ],
                horizon: "Variable"
            )
        ].filter { $0.indicativeShare > .zero }
    }
}

private extension Decimal {
    func clamped(min lowerBound: Decimal) -> Decimal {
        Swift.max(self, lowerBound)
    }
}
