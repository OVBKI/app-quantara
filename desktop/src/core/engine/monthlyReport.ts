import { Money, Percent } from '../money';
import { categoryLabel, type ExpenseCategoryId } from '../categories';
import type { FinancialProfile } from '../model';
import { addMonths, formatYearMonth, type YearMonth } from '../yearMonth';
import { monthlySummary, type MonthlySummary } from './budget';

export interface CategoryDelta {
  readonly category: ExpenseCategoryId;
  readonly current: Money;
  readonly previous: Money;
  readonly delta: Money;
  readonly change: number | null;
}

export interface MonthlyReport {
  readonly period: YearMonth;
  readonly title: string;
  readonly current: MonthlySummary;
  readonly previous: MonthlySummary;

  readonly incomeChange: number | null;
  readonly expenseChange: number | null;
  readonly savingsChange: number | null;

  readonly increases: readonly CategoryDelta[];
  readonly decreases: readonly CategoryDelta[];

  /** Écart entre la projection faite en cours de mois et le réalisé. */
  readonly forecastError: number | null;
  readonly highlights: readonly string[];
  readonly verdict: 'better' | 'stable' | 'worse';
}

/**
 * Rapport de fin de mois.
 *
 * Il compare le mois écoulé au précédent, et se juge lui-même : l'erreur de prévision
 * est affichée, parce qu'un outil qui annonce un chiffre et ne revient jamais dessus
 * n'apprend rien à personne — ni à l'utilisateur, ni à nous.
 */
export function buildMonthlyReport(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date = new Date(),
): MonthlyReport {
  const currency = profile.currency;
  const current = monthlySummary(profile, period, reference);
  const previous = monthlySummary(profile, addMonths(period, -1), reference);

  const previousByCategory = new Map(previous.categoryTotals.map((total) => [total.category, total.amount]));

  const deltas: CategoryDelta[] = current.categoryTotals.map((total) => {
    const before = previousByCategory.get(total.category) ?? Money.zero(currency);
    const delta = total.amount.minus(before);
    return {
      category: total.category,
      current: total.amount,
      previous: before,
      delta,
      change: before.isZero ? null : delta.units / before.units,
    };
  });

  const increases = deltas
    .filter((entry) => entry.delta.isPositive)
    .sort((a, b) => Number(b.delta.micros - a.delta.micros))
    .slice(0, 3);

  const decreases = deltas
    .filter((entry) => entry.delta.isNegative)
    .sort((a, b) => Number(a.delta.micros - b.delta.micros))
    .slice(0, 3);

  const incomeChange = previous.income.isZero ? null : current.income.minus(previous.income).units / previous.income.units;
  const expenseChange = previous.totalExpenses.isZero
    ? null
    : current.totalExpenses.minus(previous.totalExpenses).units / previous.totalExpenses.units;
  const savingsChange = previous.savingsContributions.isZero
    ? null
    : current.savingsContributions.minus(previous.savingsContributions).units / previous.savingsContributions.units;

  const forecastError =
    current.variableProjected.isZero || current.variableSpentToDate.isZero
      ? null
      : current.variableSpentToDate.minus(current.variableProjected).units / current.variableProjected.units;

  const highlights: string[] = [];

  highlights.push(
    `${current.income.roundedToUnit.format()} de revenus, ${current.totalExpenses.roundedToUnit.format()} de dépenses, ` +
      `${current.disposable.roundedToUnit.format()} de disponible.`,
  );

  if (current.savingsContributions.isPositive) {
    highlights.push(
      `${current.savingsContributions.roundedToUnit.format()} mis de côté, soit un taux d’épargne de ` +
        `${Percent.format(current.savingsRate, 'fr-FR', 0)}.`,
    );
  } else {
    highlights.push('Aucune épargne enregistrée ce mois-ci.');
  }

  const biggest = increases[0];
  if (biggest) {
    highlights.push(
      `Plus forte hausse : ${categoryLabel(biggest.category)}, ` +
        `+${biggest.delta.roundedToUnit.format()} par rapport au mois précédent.`,
    );
  }

  const bestDrop = decreases[0];
  if (bestDrop) {
    highlights.push(
      `Plus forte baisse : ${categoryLabel(bestDrop.category)}, ` +
        `${bestDrop.delta.roundedToUnit.format()} par rapport au mois précédent.`,
    );
  }

  if (forecastError !== null && Math.abs(forecastError) > 0.1) {
    highlights.push(
      forecastError > 0
        ? `Vos dépenses variables ont dépassé ma projection de ${Percent.format(forecastError, 'fr-FR', 0)}. ` +
          'La projection du mois prochain en tiendra compte.'
        : `Vos dépenses variables sont restées ${Percent.format(Math.abs(forecastError), 'fr-FR', 0)} sous ma projection.`,
    );
  }

  const verdict: MonthlyReport['verdict'] =
    current.disposable.greaterThan(previous.disposable.plus(Money.of(20, currency)))
      ? 'better'
      : current.disposable.lessThan(previous.disposable.minus(Money.of(20, currency)))
        ? 'worse'
        : 'stable';

  return {
    period,
    title: `Bilan de ${formatYearMonth(period)}`,
    current,
    previous,
    incomeChange,
    expenseChange,
    savingsChange,
    increases,
    decreases,
    forecastError,
    highlights,
    verdict,
  };
}
