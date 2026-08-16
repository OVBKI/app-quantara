import { Money, type Currency } from '../money';
import { categoryInfo, type ExpenseCategoryId } from '../categories';
import { containsDate, parseDate, addMonths, type YearMonth } from '../yearMonth';
import type { FinancialProfile } from '../model';

/**
 * Comparaison des dépenses dans le temps.
 *
 * Un mois isolé ne dit rien : un mois de vacances n'est pas un dérapage, et un mois calme
 * n'est pas un progrès. La référence est donc une **moyenne** sur plusieurs mois, et le
 * nombre de mois réellement observés est renvoyé avec elle — comparer à une moyenne d'un
 * seul mois serait comparer à rien.
 */

export type ComparisonWindow = 'previousMonth' | 'threeMonths' | 'sixMonths' | 'year';

export const COMPARISON_LABELS: Record<ComparisonWindow, string> = {
  previousMonth: 'Mois précédent',
  threeMonths: 'Moyenne 3 mois',
  sixMonths: 'Moyenne 6 mois',
  year: 'Moyenne 12 mois',
};

const WINDOW_MONTHS: Record<ComparisonWindow, number> = {
  previousMonth: 1,
  threeMonths: 3,
  sixMonths: 6,
  year: 12,
};

export interface CategoryComparison {
  readonly category: ExpenseCategoryId;
  readonly label: string;
  readonly color: string;
  readonly current: Money;
  /** Moyenne mensuelle sur la fenêtre, hors mois courant. */
  readonly reference: Money;
  readonly delta: Money;
  /** Variation relative. `null` si la référence est nulle : « +∞ % » n'aide personne. */
  readonly change: number | null;
  readonly share: number | null;
}

export interface SpendingComparison {
  readonly window: ComparisonWindow;
  readonly label: string;
  /** Mois effectivement observés. Zéro : aucune comparaison possible. */
  readonly monthsObserved: number;
  readonly currentTotal: Money;
  readonly referenceTotal: Money;
  readonly delta: Money;
  readonly change: number | null;
  readonly categories: readonly CategoryComparison[];
}

function monthTotals(profile: FinancialProfile, period: YearMonth): Map<ExpenseCategoryId, Money> {
  const totals = new Map<ExpenseCategoryId, Money>();
  for (const transaction of profile.transactions) {
    if (transaction.kind !== 'expense') continue;
    if (!containsDate(period, parseDate(transaction.date))) continue;
    const category = transaction.category ?? 'variable.otherVariable';
    const previous = totals.get(category) ?? Money.zero(profile.currency);
    totals.set(category, previous.plus(transaction.amount));
  }
  return totals;
}

function hasActivity(profile: FinancialProfile, period: YearMonth): boolean {
  return profile.transactions.some(
    (transaction) => transaction.kind === 'expense' && containsDate(period, parseDate(transaction.date)),
  );
}

export function compareSpending(
  profile: FinancialProfile,
  period: YearMonth,
  window: ComparisonWindow,
): SpendingComparison {
  const currency: Currency = profile.currency;
  const current = monthTotals(profile, period);

  // Mois de référence : ceux qui précèdent, et qui portent au moins une dépense. Un mois
  // vide n'est pas un mois sobre, c'est un mois non saisi — l'inclure fausserait la
  // moyenne vers le bas.
  const months = WINDOW_MONTHS[window];
  const observed: YearMonth[] = [];
  for (let back = 1; back <= months; back += 1) {
    const candidate = addMonths(period, -back);
    if (hasActivity(profile, candidate)) observed.push(candidate);
  }

  const sums = new Map<ExpenseCategoryId, Money>();
  for (const month of observed) {
    for (const [category, amount] of monthTotals(profile, month)) {
      sums.set(category, (sums.get(category) ?? Money.zero(currency)).plus(amount));
    }
  }

  const divisor = BigInt(Math.max(observed.length, 1));
  const categories = [...new Set([...current.keys(), ...sums.keys()])]
    .map((category): CategoryComparison => {
      const spent = current.get(category) ?? Money.zero(currency);
      const reference = observed.length === 0
        ? Money.zero(currency)
        : (sums.get(category) ?? Money.zero(currency)).dividedBy(divisor);
      const delta = spent.minus(reference);
      const info = categoryInfo(category);
      return {
        category,
        label: info.label,
        color: info.color,
        current: spent,
        reference,
        delta,
        change: reference.isZero ? null : delta.ratioTo(reference),
        share: null,
      };
    })
    .sort((a, b) => (b.current.greaterThan(a.current) ? 1 : -1));

  const currentTotal = Money.sum(
    categories.map((entry) => entry.current),
    currency,
  );
  const referenceTotal = Money.sum(
    categories.map((entry) => entry.reference),
    currency,
  );
  const delta = currentTotal.minus(referenceTotal);

  return {
    window,
    label: COMPARISON_LABELS[window],
    monthsObserved: observed.length,
    currentTotal,
    referenceTotal,
    delta,
    change: referenceTotal.isZero ? null : delta.ratioTo(referenceTotal),
    categories: categories.map((entry) => ({ ...entry, share: entry.current.ratioTo(currentTotal) })),
  };
}
