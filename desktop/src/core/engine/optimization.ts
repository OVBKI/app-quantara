import { Money } from '../money';
import { categoryInfo, categoryLabel, type ExpenseCategoryId } from '../categories';
import { monthlyEquivalent, annualEquivalent } from '../frequency';
import { activeDebts, activeRecurringExpenses, isRecurringInstance, transactionsIn, type FinancialProfile } from '../model';
import { addMonths, lastMonths, type YearMonth } from '../yearMonth';
import { Statistics } from './statistics';
import type { MonthlySummary } from './budget';

export type OptimizationKind =
  | 'categoryAboveHabit'
  | 'subscriptionReview'
  | 'discretionarySpending'
  | 'expensiveDebt'
  | 'unusualExpense'
  | 'idleSurplus';

/** Ce que l'effort coûte réellement à l'utilisateur, pour qu'il puisse choisir. */
export type Effort = 'immediate' | 'moderate' | 'demanding';

export interface OptimizationSuggestion {
  readonly id: string;
  readonly kind: OptimizationKind;
  readonly title: string;
  readonly detail: string;
  readonly monthlySaving: Money;
  readonly annualSaving: Money;
  readonly effort: Effort;
  readonly category?: ExpenseCategoryId;
}

export interface OptimizationResult {
  readonly suggestions: readonly OptimizationSuggestion[];
  readonly totalMonthly: Money;
  readonly totalAnnual: Money;
  /** Taux d'épargne atteignable si toutes les pistes étaient suivies. `null` sans revenu. */
  readonly newSavingsRate: number | null;
  readonly historyMonths: number;
}

const HISTORY_MONTHS = 6;
/** Dérive à partir de laquelle une catégorie mérite d'être signalée. */
const DRIFT_THRESHOLD = 0.25;
/** Part d'un poste discrétionnaire qu'on suggère de réduire, jamais la totalité. */
const DISCRETIONARY_CUT = 0.3;

/**
 * « Optimiser mon budget ».
 *
 * Le point de comparaison est l'utilisateur lui-même, sur ses propres mois passés, et
 * non une moyenne nationale : dire « vous dépensez plus que la moyenne des Français en
 * courses » n'apprend rien à quelqu'un qui a quatre enfants. Dire « vous dépensez 25 %
 * de plus que vos six derniers mois » est vérifiable et actionnable.
 */
export function optimize(
  profile: FinancialProfile,
  summary: MonthlySummary,
  period: YearMonth,
  reference: Date = new Date(),
): OptimizationResult {
  const currency = profile.currency;
  const suggestions: OptimizationSuggestion[] = [];

  const history = lastMonths(addMonths(period, -1), HISTORY_MONTHS);
  const historyByCategory = new Map<ExpenseCategoryId, Money[]>();

  for (const month of history) {
    const totals = new Map<ExpenseCategoryId, Money>();
    for (const transaction of transactionsIn(profile, month)) {
      if (transaction.kind !== 'expense' || isRecurringInstance(transaction) || !transaction.category) continue;
      const previous = totals.get(transaction.category) ?? Money.zero(currency);
      totals.set(transaction.category, previous.plus(transaction.amount));
    }
    for (const [category, amount] of totals) {
      historyByCategory.set(category, [...(historyByCategory.get(category) ?? []), amount]);
    }
  }

  // 1. Catégories au-dessus de l'habitude de l'utilisateur.
  for (const total of summary.categoryTotals) {
    const past = historyByCategory.get(total.category);
    if (!past || past.length < 3) continue;
    const median = Statistics.median(past, currency);
    if (!median.isPositive) continue;
    const drift = total.amount.minus(median);
    const ratio = drift.ratioTo(median);
    if (ratio === null || ratio < DRIFT_THRESHOLD) continue;

    suggestions.push({
      id: `drift.${total.category}`,
      kind: 'categoryAboveHabit',
      title: `${categoryLabel(total.category)} : ${Math.round(ratio * 100)} % au-dessus de votre habitude`,
      detail:
        `${total.amount.roundedToUnit.format()} ce mois-ci contre ${median.roundedToUnit.format()} en médiane ` +
        `sur vos ${past.length} derniers mois. Revenir à votre propre rythme libérerait ` +
        `${drift.roundedToUnit.format()}.`,
      monthlySaving: drift,
      annualSaving: drift.times(12n),
      effort: 'moderate',
      category: total.category,
    });
  }

  // 2. Abonnements — leur coût annuel est ce qui frappe, pas leur prix mensuel.
  const subscriptions = activeRecurringExpenses(profile, reference).filter((expense) => expense.subscription);
  if (subscriptions.length >= 2) {
    const monthly = Money.sum(
      subscriptions.map((expense) => monthlyEquivalent(expense.amount, expense.frequency)),
      currency,
    );
    const annual = Money.sum(
      subscriptions.map((expense) => annualEquivalent(expense.amount, expense.frequency)),
      currency,
    );
    // On ne suppose pas que tout est résiliable : un tiers est un ordre de grandeur
    // atteignable sans changer de vie.
    const saving = monthly.timesFraction(1, 3);
    suggestions.push({
      id: 'subscriptions',
      kind: 'subscriptionReview',
      title: `${subscriptions.length} abonnements, ${annual.roundedToUnit.format()} par an`,
      detail:
        `${subscriptions.map((expense) => expense.name).join(', ')}. Résilier ceux qui ne servent plus ` +
        `— disons un tiers — représenterait ${saving.roundedToUnit.format()} par mois.`,
      monthlySaving: saving,
      annualSaving: saving.times(12n),
      effort: 'immediate',
    });
  }

  // 3. Postes discrétionnaires : on cible la part réellement compressible.
  for (const total of summary.categoryTotals) {
    const info = categoryInfo(total.category);
    if (info.essential || info.compressibility < 0.5 || !total.amount.isPositive) continue;
    const saving = total.amount.times(Math.min(DISCRETIONARY_CUT, info.compressibility));
    if (saving.roundedToUnit.units < 10) continue;
    suggestions.push({
      id: `discretionary.${total.category}`,
      kind: 'discretionarySpending',
      title: `${categoryLabel(total.category)} : ${saving.roundedToUnit.format()} récupérables`,
      detail:
        `${total.amount.roundedToUnit.format()} ce mois-ci. Réduire d'environ ${Math.round(DISCRETIONARY_CUT * 100)} % ` +
        `est un objectif tenable sur un poste de ce type — c'est vous qui décidez s'il en vaut la peine.`,
      monthlySaving: saving,
      annualSaving: saving.times(12n),
      effort: 'demanding',
      category: total.category,
    });
  }

  // 4. Dettes coûteuses : l'intérêt payé est une dépense invisible.
  for (const debt of activeDebts(profile)) {
    if (debt.annualRate < 0.08) continue;
    const monthlyInterest = debt.outstanding.times(debt.annualRate / 12);
    if (monthlyInterest.roundedToUnit.units < 5) continue;
    suggestions.push({
      id: `debt.${debt.id}`,
      kind: 'expensiveDebt',
      title: `${debt.name} : ${monthlyInterest.roundedToUnit.format()} d'intérêts par mois`,
      detail:
        `${debt.outstanding.roundedToUnit.format()} à ${(debt.annualRate * 100).toFixed(1)} %. ` +
        'Chaque euro remboursé par anticipation rapporte ce taux, sans risque — aucun placement ne l’égale à coup sûr.',
      monthlySaving: monthlyInterest,
      annualSaving: monthlyInterest.times(12n),
      effort: 'demanding',
    });
  }

  // 5. Dépenses hors norme du mois : souvent un oubli ou un doublon.
  const monthExpenses = transactionsIn(profile, period).filter(
    (transaction) => transaction.kind === 'expense' && !isRecurringInstance(transaction),
  );
  if (monthExpenses.length >= 5) {
    const amounts = monthExpenses.map((transaction) => transaction.amount);
    const threshold = Statistics.percentile(amounts, 0.9, currency).times(1.5);
    for (const transaction of monthExpenses) {
      if (!transaction.amount.greaterThan(threshold)) continue;
      suggestions.push({
        id: `outlier.${transaction.id}`,
        kind: 'unusualExpense',
        title: `Dépense inhabituelle : ${transaction.label}`,
        detail:
          `${transaction.amount.roundedToUnit.format()}, bien au-dessus de vos autres dépenses du mois. ` +
          'À vérifier s’il s’agit d’un doublon ou d’un prélèvement inattendu.',
        monthlySaving: Money.zero(currency),
        annualSaving: Money.zero(currency),
        effort: 'immediate',
        category: transaction.category,
      });
    }
  }

  // 6. Surplus dormant : ne pas décider, c'est déjà décider de dépenser.
  const unallocated = summary.disposable.minus(summary.savingsContributions).clampedToZero;
  const surplusShare = unallocated.ratioTo(summary.income);
  if (surplusShare !== null && surplusShare > 0.15) {
    suggestions.push({
      id: 'idleSurplus',
      kind: 'idleSurplus',
      title: `${unallocated.roundedToUnit.format()} sans destination`,
      detail:
        'Un montant qui reste sur le compte courant se dépense sans décision. Un virement automatique ' +
        'le jour du salaire le met à l’abri avant qu’il ne s’évapore.',
      monthlySaving: Money.zero(currency),
      annualSaving: Money.zero(currency),
      effort: 'immediate',
    });
  }

  const ranked = [...suggestions].sort((a, b) => Number(b.monthlySaving.micros - a.monthlySaving.micros));
  const totalMonthly = Money.sum(ranked.map((entry) => entry.monthlySaving), currency);

  const newSavings = summary.savingsContributions.plus(totalMonthly);

  return {
    suggestions: ranked,
    totalMonthly,
    totalAnnual: totalMonthly.times(12n),
    newSavingsRate: newSavings.ratioTo(summary.income),
    historyMonths: history.length,
  };
}

export const EFFORT_LABELS: Record<Effort, string> = {
  immediate: 'Immédiat',
  moderate: 'Modéré',
  demanding: 'Exigeant',
};
