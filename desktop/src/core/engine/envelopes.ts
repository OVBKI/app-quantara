import { Money } from '../money';
import { categoryInfo, categoryLabel, type ExpenseCategoryId } from '../categories';
import { isRecurringInstance, transactionsIn, type FinancialProfile } from '../model';
import { daysInMonth, type YearMonth } from '../yearMonth';

export type EnvelopeState = 'onTrack' | 'ahead' | 'atRisk' | 'exceeded';

export interface Envelope {
  readonly category: ExpenseCategoryId;
  readonly label: string;
  readonly planned: Money;
  readonly spent: Money;
  readonly remaining: Money;
  /** Part de l'enveloppe consommée, de 0 à 1 et au-delà en cas de dépassement. */
  readonly consumed: number;
  /** Part du mois écoulée, pour comparer le rythme au calendrier. */
  readonly monthProgress: number;
  readonly state: EnvelopeState;
  /** Ce qui reste dépensable par jour d'ici la fin du mois. */
  readonly perRemainingDay: Money;
  readonly essential: boolean;
}

export interface EnvelopeSummary {
  readonly envelopes: readonly Envelope[];
  readonly totalPlanned: Money;
  readonly totalSpent: Money;
  readonly totalRemaining: Money;
  /** Dépenses variables constatées hors de toute enveloppe déclarée. */
  readonly unbudgeted: Money;
  readonly exceededCount: number;
  readonly atRiskCount: number;
}

/** Au-delà de cette avance sur le calendrier, l'enveloppe part pour être dépassée. */
const AT_RISK_MARGIN = 0.1;

/**
 * Budgets par catégorie, dits « enveloppes ».
 *
 * Constater ses dépenses ne suffit pas à tenir un budget : il faut décider à l'avance
 * combien on y consacre. C'est la différence entre un relevé et un plan.
 *
 * L'état de chaque enveloppe compare la part consommée à la part du mois écoulée : avoir
 * dépensé 60 % de son budget courses n'a pas le même sens le 5 et le 25 du mois.
 */
export function buildEnvelopes(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date,
): EnvelopeSummary {
  const currency = profile.currency;

  const spentByCategory = new Map<ExpenseCategoryId, Money>();
  for (const transaction of transactionsIn(profile, period)) {
    if (transaction.kind !== 'expense' || isRecurringInstance(transaction) || !transaction.category) continue;
    const previous = spentByCategory.get(transaction.category) ?? Money.zero(currency);
    spentByCategory.set(transaction.category, previous.plus(transaction.amount));
  }

  const total = daysInMonth(period);
  const isCurrent = reference.getFullYear() === period.year && reference.getMonth() + 1 === period.month;
  const elapsed = isCurrent ? Math.min(reference.getDate(), total) : total;
  const monthProgress = elapsed / total;
  const daysRemaining = Math.max(total - elapsed, 0);

  const envelopes: Envelope[] = profile.categoryBudgets
    .filter((budget) => budget.limit.isPositive)
    .map((budget) => {
      const spent = spentByCategory.get(budget.category) ?? Money.zero(currency);
      const remaining = budget.limit.minus(spent);
      const consumed = spent.ratioTo(budget.limit) ?? 0;

      let state: EnvelopeState;
      if (remaining.isNegative) {
        state = 'exceeded';
      } else if (consumed > monthProgress + AT_RISK_MARGIN) {
        state = 'atRisk';
      } else if (consumed < monthProgress - AT_RISK_MARGIN) {
        state = 'ahead';
      } else {
        state = 'onTrack';
      }

      return {
        category: budget.category,
        label: categoryLabel(budget.category),
        planned: budget.limit,
        spent,
        remaining,
        consumed,
        monthProgress,
        state,
        perRemainingDay:
          daysRemaining > 0 ? remaining.clampedToZero.dividedBy(BigInt(daysRemaining)) : remaining.clampedToZero,
        essential: categoryInfo(budget.category).essential,
      };
    })
    .sort((a, b) => Number(b.planned.micros - a.planned.micros));

  const budgeted = new Set(envelopes.map((envelope) => envelope.category));
  const unbudgeted = Money.sum(
    [...spentByCategory.entries()]
      .filter(([category]) => !budgeted.has(category))
      .map(([, amount]) => amount),
    currency,
  );

  return {
    envelopes,
    totalPlanned: Money.sum(envelopes.map((envelope) => envelope.planned), currency),
    totalSpent: Money.sum(envelopes.map((envelope) => envelope.spent), currency),
    totalRemaining: Money.sum(envelopes.map((envelope) => envelope.remaining), currency),
    unbudgeted,
    exceededCount: envelopes.filter((envelope) => envelope.state === 'exceeded').length,
    atRiskCount: envelopes.filter((envelope) => envelope.state === 'atRisk').length,
  };
}

export const ENVELOPE_STATE_LABELS: Record<EnvelopeState, string> = {
  onTrack: 'Dans les clous',
  ahead: 'En avance',
  atRisk: 'Rythme trop rapide',
  exceeded: 'Dépassée',
};

export const ENVELOPE_STATE_TONE: Record<EnvelopeState, string> = {
  onTrack: 'var(--accent)',
  ahead: 'var(--positive)',
  atRisk: 'var(--warning)',
  exceeded: 'var(--critical)',
};

/**
 * Enveloppes proposées à partir des mois passés.
 *
 * Demander à quelqu'un « combien voulez-vous consacrer aux courses ? » sans point de
 * repère produit un chiffre inventé, vite abandonné. Partir de sa médiane réelle donne
 * un budget qu'il tient déjà.
 */
export function suggestEnvelopes(
  profile: FinancialProfile,
  months: readonly YearMonth[],
): { category: ExpenseCategoryId; suggested: Money; basis: number }[] {
  const currency = profile.currency;
  const byCategory = new Map<ExpenseCategoryId, Money[]>();

  for (const month of months) {
    const totals = new Map<ExpenseCategoryId, Money>();
    for (const transaction of transactionsIn(profile, month)) {
      if (transaction.kind !== 'expense' || isRecurringInstance(transaction) || !transaction.category) continue;
      if (!transaction.category.startsWith('variable.')) continue;
      const previous = totals.get(transaction.category) ?? Money.zero(currency);
      totals.set(transaction.category, previous.plus(transaction.amount));
    }
    for (const [category, amount] of totals) {
      byCategory.set(category, [...(byCategory.get(category) ?? []), amount]);
    }
  }

  return [...byCategory.entries()]
    .filter(([, amounts]) => amounts.length >= 2)
    .map(([category, amounts]) => {
      const sorted = [...amounts].sort((a, b) => Number(a.micros - b.micros));
      const middle = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 1
          ? sorted[middle]!
          : sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2n);
      return { category, suggested: median.roundedToUnit, basis: amounts.length };
    })
    .sort((a, b) => Number(b.suggested.micros - a.suggested.micros));
}
