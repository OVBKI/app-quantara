import SwiftUI
import StoreKit
import QuantaraCore

struct PaywallView: View {

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var isPurchasing = false
    @State private var errorMessage: String?

    private let premiumFeatures: [(symbol: String, key: LocalizedStringKey)] = [
        ("sparkles", "paywall.feature.advisor"),
        ("wand.and.stars", "paywall.feature.optimization"),
        ("target", "paywall.feature.goals"),
        ("chart.xyaxis.line", "paywall.feature.simulations"),
        ("calendar", "paywall.feature.reports"),
        ("chart.line.uptrend.xyaxis", "paywall.feature.investment")
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    header
                    features
                    // Ce qui reste gratuit est affiché : masquer les limites du gratuit
                    // se paie en désabonnements et en avis négatifs.
                    freeTier
                    purchaseButton

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(Theme.Palette.critical)
                    }

                    Text("paywall.legal")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .padding(Theme.Spacing.large)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("paywall.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("settings.premium.restore") {
                        Task { try? await environment.entitlements.restore() }
                    }
                    .font(.subheadline)
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: Theme.Spacing.small) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(Theme.Palette.accent)
            Text("paywall.headline")
                .font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
            Text("paywall.subheadline")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            ForEach(premiumFeatures, id: \.symbol) { feature in
                HStack(spacing: Theme.Spacing.small) {
                    Image(systemName: feature.symbol)
                        .foregroundStyle(Theme.Palette.accent)
                        .frame(width: 28)
                    Text(feature.key)
                        .font(.subheadline)
                    Spacer()
                }
            }
        }
        .cardStyle()
    }

    private var freeTier: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            Text("paywall.freeTier.title")
                .font(.subheadline.weight(.semibold))
            Text("paywall.freeTier.detail")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .cardStyle()
    }

    private var purchaseButton: some View {
        Button {
            purchase()
        } label: {
            if isPurchasing {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                Text("paywall.subscribe")
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(isPurchasing)
    }

    private func purchase() {
        isPurchasing = true
        errorMessage = nil
        Task {
            do {
                try await environment.entitlements.purchase()
                if environment.entitlements.isPremium { dismiss() }
            } catch {
                errorMessage = error.localizedDescription
            }
            isPurchasing = false
        }
    }
}
