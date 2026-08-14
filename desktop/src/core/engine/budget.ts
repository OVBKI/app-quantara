import { Money } from '../money';
import type { Currency } from '../money';
import { monthlyEquivalent } from '../frequency';
import { categoryInfo, type ExpenseCategoryId } from '../categories';
import {
  activeDebts,
  activeRecurringExpenses,
  isEssential,
  isRecurringInstance,
  transactionsIn,
  type FinancialProfile,
  type Transaction,
} from '../model';
import {
  addMonths,
  containsDate,
  daysInMonth,
  lastMonths,
  startOfDay,
  yearMonthEquals,
  yearMonthOf,
  type YearMonth,
} from '../yearMonth';
import { Statistics } from './statistics';
import { incomeBreakdown, type IncomeBreakdown } from './income';
import { buildEnvelopes, type EnvelopeSummary } from './envelopes';

export interface CategoryTotal {
  readonly category: ExpenseCategoryId;
  readonly amount: Money;
  /** Part des dépenses totales du mois. `null` si le mois n'a aucune dépense. */
  readonly share: number | null;
  readonly essential: boolean;
}

export type VariableProjectionMethod = 'actual' | 'runRate' | 'history';

export interface MonthlySummary {
  readonly period: YearMonth;
  readonly currency: Currency;

  /** Revenu retenu par le plan : le montant encaissé s'il est saisi, sinon l'hypothèse
   *  choisie (prudente par défaut pour un revenu irrégulier). */
  readonly income: Money;
  /** Revenu de référence, lissé si le profil le demande et si l'historique le permet. */
  readonly incomeBaseline: Money;
  /** Détail par source, avec fourchette basse / typique / haute. */
  readonly incomeDetail: IncomeBreakdown;

  readonly fixedExpenses: Money;
  readonly subscriptions: Money;
  readonly variableSpentToDate: Money;
  readonly variableProjected: Money;
  readonly variableProjectionMethod: VariableProjectionMethod;
  /** Somme des enveloppes déclarées par catégorie. Zéro si aucune n'est définie. */
  readonly variablePlanned: Money;
  /** Ce que le plan réserve réellement pour le variable. */
  readonly variableReserved: Money;
  readonly envelopes: EnvelopeSummary;
  readonly debtPayments: Money;
  readonly savingsContributions: Money;

  readonly totalExpenses: Money;
  /** Ce qui reste une fois toutes les charges du mois honorées. */
  readonly disposable: Money;
  readonly essentialExpenses: Money;

  readonly fixedRatio: number | null;
  readonly savingsRate: number | null;
  readonly essentialRatio: number | null;

  readonly categoryTotals: readonly CategoryTotal[];
  readonly daysElapsed: number;
  readonly daysRemaining: number;
  /** Ce qu'il reste à dépenser librement, par jour restant. */
  readonly safeToSpendPerDay: Money;
}

/** En deçà, un rythme de dépense n'a pas de sens statistique : deux jours de courses
 *  ne disent rien du mois. */
const MINIMUM_DAYS_FOR_RUN_RATE = 5;

/** Nombre de mois d'historique consultés pour lisser un revenu ou projeter le variable. */
const HISTORY_MONTHS = 6;
const MINIMUM_MONTHS_FOR_SMOOTHING = 3;

function isExpenseTransaction(transaction: Transaction): boolean {
  return transaction.kind === 'expense';
}

/** Revenus du mois : sources déclarées ramenées au mois, plus les entrées ponctuelles
 *  non rattachées à une source — sans quoi un salaire compterait deux fois. */
export function monthlyIncome(profile: FinancialProfile, period: YearMonth, reference: Date): Money {
  return incomeBreakdown(profile, period, reference, profile.preferences.incomePlanning).planned;
}

/** Dépenses variables réellement constatées sur un mois. */
export function realizedVariableSpending(profile: FinancialProfile, period: YearMonth): Money {
  const spent = transactionsIn(profile, period)
    .filter((transaction) => isExpenseTransaction(transaction) && !isRecurringInstance(transaction))
    .map((transaction) => transaction.amount);
  return Money.sum(spent, profile.currency);
}

/**
 * Projection des dépenses variables sur le mois complet.
 *
 * Trois régimes, du plus fiable au moins fiable :
 * 1. mois terminé → le montant constaté, sans projection ;
 * 2. mois en cours avec assez de jours écoulés → extrapolation du rythme observé ;
 * 3. mois à peine commencé → médiane des mois précédents, à défaut le constaté.
 */
/**
 * Facteur d'extrapolation du mois en cours, `null` hors du régime de rythme observé.
 *
 * Exposé séparément pour pouvoir n'extrapoler qu'une partie des dépenses : celles qui
 * ne sont couvertes par aucune enveloppe.
 */
export function runRateFactor(period: YearMonth, reference: Date): { total: number; elapsed: number } | null {
  if (!yearMonthEquals(period, yearMonthOf(reference))) return null;
  const total = daysInMonth(period);
  const elapsed = Math.min(reference.getDate(), total);
  return elapsed >= MINIMUM_DAYS_FOR_RUN_RATE ? { total, elapsed } : null;
}

export function projectedVariableSpending(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date,
): { amount: Money; method: VariableProjectionMethod } {
  const spent = realizedVariableSpending(profile, period);
  const currentPeriod = yearMonthOf(reference);

  if (!yearMonthEquals(period, currentPeriod)) {
    return { amount: spent, method: 'actual' };
  }

  const total = daysInMonth(period);
  const elapsed = Math.min(reference.getDate(), total);

  if (elapsed >= MINIMUM_DAYS_FOR_RUN_RATE) {
    return { amount: spent.timesFraction(total, elapsed), method: 'runRate' };
  }

  const history = lastMonths(addMonths(period, -1), HISTORY_MONTHS)
    .map((month) => realizedVariableSpending(profile, month))
    .filter((amount) => amount.isPositive);

  if (history.length === 0) return { amount: spent, method: 'actual' };

  const median = Statistics.median(history, profile.currency);
  return { amount: Money.max(median, spent), method: 'history' };
}

/**
 * Revenu de référence.
 *
 * Un revenu irrégulier ne se planifie pas sur son dernier mois : on prend la médiane des
 * mois passés, qui absorbe un mois exceptionnel dans les deux sens. Sans historique
 * suffisant, on s'en tient au déclaré — mieux vaut une référence assumée qu'une moyenne
 * calculée sur deux points.
 */
export function smoothedIncomeBaseline(
  profile: FinancialProfile,
  period: YearMonth,
  declared: Money,
): Money {
  if (!profile.preferences.smoothIncome) return declared;

  const history = lastMonths(addMonths(period, -1), HISTORY_MONTHS)
    .map((month) =>
      Money.sum(
        transactionsIn(profile, month)
          .filter((transaction) => transaction.kind === 'income')
          .map((transaction) => transaction.amount),
        profile.currency,
      ),
    )
    .filter((amount) => amount.isPositive);

  if (history.length < MINIMUM_MONTHS_FOR_SMOOTHING) return declared;
  return Statistics.median(history, profile.currency);
}

function categoryTotals(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date,
  totalExpenses: Money,
): CategoryTotal[] {
  const amounts = new Map<ExpenseCategoryId, Money>();
  const add = (category: ExpenseCategoryId, amount: Money): void => {
    const previous = amounts.get(category) ?? Money.zero(profile.currency);
    amounts.set(category, previous.plus(amount));
  };

  for (const expense of activeRecurringExpenses(profile, reference)) {
    add(expense.category, monthlyEquivalent(expense.amount, expense.frequency));
  }

  for (const transaction of transactionsIn(profile, period)) {
    if (!isExpenseTransaction(transaction) || isRecurringInstance(transaction)) continue;
    if (transaction.category) add(transaction.category, transaction.amount);
  }

  return [...amounts.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      share: amount.ratioTo(totalExpenses),
      essential: categoryInfo(category).essential,
    }))
    .sort((a, b) => (b.amount.micros > a.amount.micros ? 1 : -1));
}

export function monthlySummary(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date = new Date(),
): MonthlySummary {
  const currency = profile.currency;
  const monthTransactions = transactionsIn(profile, period);

  const detail = incomeBreakdown(profile, period, reference, profile.preferences.incomePlanning);
  const income = detail.planned;
  const incomeBaseline = smoothedIncomeBaseline(profile, period, detail.typical);

  const recurring = activeRecurringExpenses(profile, reference);
  const fixedExpenses = Money.sum(
    recurring.map((expense) => monthlyEquivalent(expense.amount, expense.frequency)),
    currency,
  );
  const subscriptions = Money.sum(
    recurring
      .filter((expense) => expense.subscription)
      .map((expense) => monthlyEquivalent(expense.amount, expense.frequency)),
    currency,
  );

  const variableSpentToDate = realizedVariableSpending(profile, period);
  const projection = projectedVariableSpending(profile, period, reference);

  const debtPayments = Money.sum(
    activeDebts(profile).map((debt) => debt.monthlyPayment),
    currency,
  );

  const savingsContributions = Money.sum(
    monthTransactions.filter((transaction) => transaction.kind === 'savings').map((transaction) => transaction.amount),
    currency,
  );

  const envelopes = buildEnvelopes(profile, period, reference);

  // Ce que le plan met de côté pour le variable, calculé poste par poste plutôt que
  // globalement — mélanger un budget décidé et une extrapolation statistique produirait
  // un chiffre que personne ne saurait expliquer.
  //
  // - Poste doté d'une enveloppe : on réserve l'enveloppe, même si le mois est calme,
  //   parce que c'est un engagement. Si elle est déjà dépassée, c'est le réel qui prime :
  //   un budget qui ignore un dépassement affiche un disponible qui n'existe pas.
  // - Poste sans enveloppe : aucune décision à tenir, donc on extrapole le rythme observé.
  const factor = runRateFactor(period, reference);
  const unbudgetedProjected = factor
    ? envelopes.unbudgeted.timesFraction(factor.total, factor.elapsed)
    : envelopes.unbudgeted;

  const variableReserved =
    envelopes.envelopes.length === 0
      ? projection.amount
      : Money.sum(
          [
            ...envelopes.envelopes.map((envelope) => Money.max(envelope.planned, envelope.spent)),
            unbudgetedProjected,
          ],
          currency,
        );

  const totalExpenses = Money.sum([fixedExpenses, variableReserved, debtPayments], currency);
  const disposable = income.minus(totalExpenses);

  const essentialFixed = Money.sum(
    recurring.filter(isEssential).map((expense) => monthlyEquivalent(expense.amount, expense.frequency)),
    currency,
  );
  const essentialVariable = Money.sum(
    monthTransactions
      .filter(
        (transaction) =>
          isExpenseTransaction(transaction) &&
          !isRecurringInstance(transaction) &&
          transaction.category !== undefined &&
          categoryInfo(transaction.category).essential,
      )
      .map((transaction) => transaction.amount),
    currency,
  );
  const essentialExpenses = essentialFixed.plus(essentialVariable);

  const total = daysInMonth(period);
  const isCurrentMonth = containsDate(period, reference);
  const daysElapsed = isCurrentMonth ? Math.min(reference.getDate(), total) : total;
  const daysRemaining = Math.max(total - daysElapsed, 0);

  // Ce qui reste réellement disponible d'ici la fin du mois : le revenu, moins tout ce
  // qui est déjà engagé, moins ce qui a déjà été dépensé.
  const remaining = income
    .minus(fixedExpenses)
    .minus(debtPayments)
    .minus(savingsContributions)
    .minus(Money.max(variableSpentToDate, envelopes.totalSpent))
    .clampedToZero;
  const safeToSpendPerDay = daysRemaining > 0 ? remaining.dividedBy(BigInt(daysRemaining)) : remaining;

  return {
    period,
    currency,
    income,
    incomeBaseline,
    incomeDetail: detail,
    fixedExpenses,
    subscriptions,
    variableSpentToDate,
    variableProjected: projection.amount,
    variableProjectionMethod: projection.method,
    variablePlanned: envelopes.totalPlanned,
    variableReserved,
    envelopes,
    debtPayments,
    savingsContributions,
    totalExpenses,
    disposable,
    essentialExpenses,
    fixedRatio: fixedExpenses.ratioTo(income),
    savingsRate: savingsContributions.ratioTo(income),
    essentialRatio: essentialExpenses.ratioTo(income),
    categoryTotals: categoryTotals(profile, period, reference, totalExpenses),
    daysElapsed,
    daysRemaining,
    safeToSpendPerDay,
  };
}

/**
 * Capacité d'épargne mensuelle.
 *
 * On ne propose jamais d'épargner la totalité du disponible : une part reste libre,
 * sans quoi le plan se brise au premier imprévu et l'utilisateur cesse de le suivre.
 */
export function savingsCapacity(summary: MonthlySummary, minimumFreeShare: number): Money {
  const disposable = summary.disposable.clampedToZero;
  if (disposable.isZero) return disposable;
  const free = disposable.times(Math.min(Math.max(minimumFreeShare, 0), 1));
  return disposable.minus(free).clampedToZero;
}

export interface MonthlyComparison {
  readonly incomeChange: number | null;
  readonly expenseChange: number | null;
  readonly savingsChange: number | null;
  readonly biggestIncreases: readonly { category: ExpenseCategoryId; delta: Money }[];
}

export function compareMonths(previous: MonthlySummary, current: MonthlySummary): MonthlyComparison {
  const previousByCategory = new Map(previous.categoryTotals.map((total) => [total.category, total.amount]));

  const deltas = current.categoryTotals
    .map((total) => ({
      category: total.category,
      delta: total.amount.minus(previousByCategory.get(total.category) ?? Money.zero(current.currency)),
    }))
    .filter((entry) => entry.delta.isPositive)
    .sort((a, b) => (b.delta.micros > a.delta.micros ? 1 : -1))
    .slice(0, 3);

  return {
    incomeChange: previous.income.isZero ? null : (current.income.units - previous.income.units) / previous.income.units,
    expenseChange: previous.totalExpenses.isZero
      ? null
      : (current.totalExpenses.units - previous.totalExpenses.units) / previous.totalExpenses.units,
    savingsChange: previous.savingsContributions.isZero
      ? null
      : (current.savingsContributions.units - previous.savingsContributions.units) /
        previous.savingsContributions.units,
    biggestIncreases: deltas,
  };
}

/** Historique mensuel prêt pour les graphiques. */
export function monthlyHistory(
  profile: FinancialProfile,
  period: YearMonth,
  count: number,
  reference: Date = new Date(),
): MonthlySummary[] {
  return lastMonths(period, count).map((month) => monthlySummary(profile, month, reference));
}

export { startOfDay };
