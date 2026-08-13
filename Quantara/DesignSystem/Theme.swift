import SwiftUI
import UIKit
import QuantaraCore

/// Système de design.
///
/// Objectif (§18) : une interface premium, minimaliste, très lisible. Les couleurs sont
/// définies par sémantique (« revenu », « alerte ») et non par teinte : le mode sombre
/// et l'augmentation de contraste sont ainsi gérés en un seul endroit.
enum Theme {

    // MARK: Couleurs

    enum Palette {
        /// Teinte de marque : un vert profond, plus sobre qu'un bleu bancaire générique.
        static let accent = Color("AccentColor", bundle: .main)

        static let income = Color(hue: 0.38, saturation: 0.55, brightness: 0.62)
        static let fixedExpense = Color(hue: 0.60, saturation: 0.45, brightness: 0.70)
        static let variableExpense = Color(hue: 0.08, saturation: 0.60, brightness: 0.85)
        static let savings = Color(hue: 0.52, saturation: 0.50, brightness: 0.72)
        static let disposable = Color(hue: 0.13, saturation: 0.65, brightness: 0.88)
        static let debt = Color(hue: 0.02, saturation: 0.62, brightness: 0.80)

        static let positive = Color(hue: 0.38, saturation: 0.60, brightness: 0.60)
        static let warning = Color(hue: 0.10, saturation: 0.75, brightness: 0.88)
        static let critical = Color(hue: 0.01, saturation: 0.70, brightness: 0.78)

        static func color(for severity: InsightSeverity) -> Color {
            switch severity {
            case .positive:    return positive
            case .information: return .secondary
            case .warning:     return warning
            case .critical:    return critical
            }
        }

        static func color(for bucket: AllocationBucket) -> Color {
            switch bucket {
            case .safetyBuffer:     return savings
            case .highInterestDebt: return debt
            case .emergencyFund:    return fixedExpense
            case .goals:            return accent
            case .investment:       return income
            case .freeMoney:        return disposable
            }
        }

        /// Palette catégorielle : teintes réparties sur le cercle chromatique, saturation
        /// et luminosité constantes pour qu'aucune catégorie ne domine visuellement.
        static func categoryColor(index: Int) -> Color {
            let hues: [Double] = [0.38, 0.60, 0.08, 0.52, 0.13, 0.02, 0.78, 0.45, 0.92, 0.30]
            return Color(
                hue: hues[index % hues.count],
                saturation: 0.52,
                brightness: 0.78
            )
        }
    }

    // MARK: Espacements et rayons

    enum Spacing {
        static let tight: CGFloat = 6
        static let small: CGFloat = 10
        static let medium: CGFloat = 16
        static let large: CGFloat = 24
        static let section: CGFloat = 32
    }

    enum Radius {
        static let card: CGFloat = 20
        static let control: CGFloat = 12
        static let pill: CGFloat = 999
    }
}

// MARK: - Carte

/// Conteneur standard. Un seul style de carte dans toute l'application : la cohérence
/// visuelle fait davantage pour la sensation « premium » que la variété.
struct Card<Content: View>: View {
    var padding: CGFloat = Theme.Spacing.medium
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
            )
    }
}

extension View {
    func cardStyle(padding: CGFloat = Theme.Spacing.medium) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
            )
    }
}

// MARK: - En-tête de section

struct SectionHeader: View {
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    var action: (() -> Void)?
    var actionLabel: LocalizedStringKey?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let action, let actionLabel {
                Button(actionLabel, action: action)
                    .font(.subheadline.weight(.medium))
            }
        }
    }
}

// MARK: - Montant

/// Affichage d'un montant. Les chiffres sont en chasse fixe pour que la comparaison
/// visuelle entre lignes reste possible, et l'ensemble est verbalisé pour VoiceOver.
struct AmountText: View {
    let amount: Money
    var style: Font = .title2.weight(.semibold)
    var showsSign: Bool = false
    var color: Color?

    var body: some View {
        Text(formatted)
            .font(style)
            .monospacedDigit()
            .foregroundStyle(color ?? .primary)
            .accessibilityLabel(Text(formatted))
    }

    private var formatted: String {
        let base = amount.formatted()
        guard showsSign, amount.amount > 0 else { return base }
        return "+" + base
    }
}

// MARK: - Barre de progression

struct ProgressBar: View {
    let progress: Decimal
    var tint: Color = Theme.Palette.accent
    var height: CGFloat = 10

    private var clamped: Double {
        min(max(NSDecimalNumber(decimal: progress).doubleValue, 0), 1)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.quaternary)
                Capsule()
                    .fill(tint)
                    .frame(width: geometry.size.width * clamped)
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityValue(Text(Percent.format(progress, fractionDigits: 0)))
    }
}

// MARK: - Anneau

struct ProgressRing: View {
    let progress: Decimal
    var tint: Color = Theme.Palette.accent
    var lineWidth: CGFloat = 10

    private var clamped: Double {
        min(max(NSDecimalNumber(decimal: progress).doubleValue, 0), 1)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(.quaternary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .accessibilityElement()
        .accessibilityValue(Text(Percent.format(progress, fractionDigits: 0)))
    }
}

// MARK: - Tuile d'indicateur

struct StatTile: View {
    let title: LocalizedStringKey
    let amount: Money
    var caption: String?
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            Text(title)
                .font(.footnote)
                .foregroundStyle(.secondary)
            AmountText(amount: amount, style: .title3.weight(.semibold), color: tint)
            if let caption {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - État vide

struct EmptyStateView: View {
    let symbol: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    var actionLabel: LocalizedStringKey?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: Theme.Spacing.medium) {
            Image(systemName: symbol)
                .font(.system(size: 44))
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.section)
    }
}

// MARK: - Localisation des énumérations du cœur métier

extension ExpenseCategory {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension IncomeCategory {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension FixedExpenseCategory {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension VariableExpenseCategory {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension Frequency {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension GoalKind {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension DebtKind {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension AllocationBucket {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension RiskProfile {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension AssetClass {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension AccountKind {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension AdvisorPrivacyLevel {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}

extension OpportunityEffort {
    var localizedName: String { String(localized: String.LocalizationValue(localizationKey)) }
}
