import { Money, type Currency } from '../money';
import type { AssetClassId, FinancialProfile, Holding } from '../model';

/**
 * Suivi de portefeuille.
 *
 * L'application enregistre ce que vous décidez de placer et ce que cela vaut. Elle ne
 * recommande rien, ne va chercher aucun cours, et ne projette aucun rendement : la valeur
 * actuelle est celle que vous avez saisie, à la date que vous avez indiquée. Un chiffre
 * affiché ici est donc toujours le vôtre.
 */

export const ASSET_CLASS_LABELS: Record<AssetClassId, string> = {
  etf: 'ETF / fonds indiciels',
  stocks: 'Actions',
  bonds: 'Obligations',
  funds: 'Fonds',
  realEstate: 'Immobilier',
  cashEquivalent: 'Liquidités',
  otherAsset: 'Autre',
};

export const ASSET_CLASS_IDS = Object.keys(ASSET_CLASS_LABELS) as AssetClassId[];

export interface HoldingView {
  readonly holding: Holding;
  /** Valeur actuelle moins somme versée. Négatif tant que la ligne est en moins-value. */
  readonly gain: Money;
  /** Rapport du gain à la somme versée. `null` si rien n'a été versé. */
  readonly gainRatio: number | null;
  /** Depuis combien de jours la valeur n'a pas été mise à jour. */
  readonly staleDays: number;
}

export interface AssetClassSlice {
  readonly assetClass: AssetClassId;
  readonly label: string;
  readonly value: Money;
  readonly share: number | null;
}

export interface PortfolioSummary {
  readonly currency: Currency;
  readonly invested: Money;
  readonly currentValue: Money;
  readonly gain: Money;
  readonly gainRatio: number | null;
  readonly lines: readonly HoldingView[];
  readonly byAssetClass: readonly AssetClassSlice[];
  /** Part du revenu du mois consacrée au placement, d'après les mouvements enregistrés. */
  readonly investedThisMonth: Money;
  /** Lignes dont la valeur date de plus de 90 jours : le total est alors indicatif. */
  readonly staleCount: number;
}

/** Au-delà, une valeur saisie ne dit plus grand-chose du portefeuille d'aujourd'hui. */
const STALE_AFTER_DAYS = 90;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

export function summarizePortfolio(
  profile: FinancialProfile,
  investedThisMonth: Money,
  reference: Date = new Date(),
): PortfolioSummary {
  const currency = profile.currency;
  const invested = Money.sum(
    profile.holdings.map((holding) => holding.invested),
    currency,
  );
  const currentValue = Money.sum(
    profile.holdings.map((holding) => holding.currentValue),
    currency,
  );

  const lines = profile.holdings.map((holding): HoldingView => {
    const gain = holding.currentValue.minus(holding.invested);
    return {
      holding,
      gain,
      gainRatio: gain.ratioTo(holding.invested),
      staleDays: daysBetween(new Date(holding.valuedOn), reference),
    };
  });

  const totals = new Map<AssetClassId, Money>();
  for (const holding of profile.holdings) {
    const previous = totals.get(holding.assetClass) ?? Money.zero(currency);
    totals.set(holding.assetClass, previous.plus(holding.currentValue));
  }

  const byAssetClass = [...totals.entries()]
    .map(([assetClass, value]): AssetClassSlice => ({
      assetClass,
      label: ASSET_CLASS_LABELS[assetClass],
      value,
      share: value.ratioTo(currentValue),
    }))
    .sort((a, b) => Money.compareDescending(a.value, b.value));

  const gain = currentValue.minus(invested);

  return {
    currency,
    invested,
    currentValue,
    gain,
    gainRatio: gain.ratioTo(invested),
    lines: [...lines].sort((a, b) => Money.compareDescending(a.holding.currentValue, b.holding.currentValue)),
    byAssetClass,
    investedThisMonth,
    staleCount: lines.filter((line) => line.staleDays > STALE_AFTER_DAYS).length,
  };
}

export { STALE_AFTER_DAYS };
