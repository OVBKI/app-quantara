import { Money } from '../money';
import type { Currency } from '../money';
import { monthlyEquivalent } from '../frequency';
import { activeIncomes, transactionsIn, type FinancialProfile, type IncomeSource } from '../model';
import { addMonths, lastMonths, yearMonthEquals, yearMonthOf, type YearMonth } from '../yearMonth';
import { Statistics } from './statistics';
import { tradingIncomeEstimate } from './trading';

/**
 * Mode de planification d'un revenu irrégulier.
 *
 * `prudent` par défaut, et ce n'est pas de la timidité : un budget bâti sur le meilleur
 * mois casse onze mois sur douze. En planifiant sur le mois faible, les bons mois
 * dégagent un surplus — qui est une bonne nouvelle, pas un rattrapage.
 */
export type IncomePlanningMode = 'prudent' | 'typical' | 'optimistic';

export const INCOME_PLANNING_LABELS: Record<IncomePlanningMode, string> = {
  prudent: 'Prudent — sur le mois faible',
  typical: 'Typique — sur le mois médian',
  optimistic: 'Optimiste — sur le mois fort',
};

export interface IncomeSourceEstimate {
  readonly source: IncomeSource;
  readonly low: Money;
  readonly typical: Money;
  readonly high: Money;
  /** Montant réellement encaissé ce mois-ci, s'il a été saisi. */
  readonly actual: Money | null;
  /** Nombre de mois d'historique ayant servi à l'estimation. */
  readonly historyMonths: number;
  readonly variable: boolean;
}

export interface IncomeBreakdown {
  readonly sources: readonly IncomeSourceEstimate[];
  /** Versements de sociétés de financement, isolés du reste : ils ne se planifient pas
   *  comme un salaire, et le plan doit pouvoir les afficher à part. */
  readonly trading: {
    readonly planned: Money;
    readonly typical: Money;
    readonly high: Money;
    readonly plannable: boolean;
    readonly monthsObserved: number;
  } | null;
  readonly low: Money;
  readonly typical: Money;
  readonly high: Money;
  /** Ce que retient le plan, selon le mode choisi et les montants déjà encaissés. */
  readonly planned: Money;
  /** Somme des revenus effectivement saisis pour le mois. */
  readonly received: Money;
  readonly hasVariableSource: boolean;
  /** Écart entre le mois fort et le mois faible, rapporté au typique. `null` si pas de revenu. */
  readonly volatility: number | null;
}

const HISTORY_MONTHS = 6;
const MINIMUM_MONTHS_FOR_HISTORY = 3;

/** Fourchette par défaut d'un revenu irrégulier non documenté : ±20 % autour du typique. */
const DEFAULT_SPREAD = 0.2;

function receivedFor(profile: FinancialProfile, period: YearMonth, sourceId: string): Money | null {
  const entries = transactionsIn(profile, period).filter(
    (transaction) => transaction.kind === 'income' && transaction.incomeSourceId === sourceId,
  );
  if (entries.length === 0) return null;
  return Money.sum(
    entries.map((entry) => entry.amount),
    profile.currency,
  );
}

/** Historique des montants réellement encaissés pour une source, mois par mois. */
function historyFor(profile: FinancialProfile, period: YearMonth, sourceId: string): Money[] {
  return lastMonths(addMonths(period, -1), HISTORY_MONTHS)
    .map((month) => receivedFor(profile, month, sourceId))
    .filter((amount): amount is Money => amount !== null && amount.isPositive);
}

/**
 * Estimation d'une source de revenu pour un mois donné.
 *
 * Trois niveaux de fiabilité, du meilleur au moins bon :
 * 1. le montant réellement encaissé, quand il a été saisi ;
 * 2. la distribution des mois passés, dès trois mois d'historique ;
 * 3. la fourchette déclarée par l'utilisateur, à défaut le typique ± 20 %.
 */
export function estimateSource(
  profile: FinancialProfile,
  source: IncomeSource,
  period: YearMonth,
): IncomeSourceEstimate {
  const currency = profile.currency;
  const typical = monthlyEquivalent(source.amount, source.frequency);
  const actual = receivedFor(profile, period, source.id);

  if (!source.variable) {
    return {
      source,
      low: typical,
      typical,
      high: typical,
      actual,
      historyMonths: 0,
      variable: false,
    };
  }

  const history = historyFor(profile, period, source.id);

  if (history.length >= MINIMUM_MONTHS_FOR_HISTORY) {
    return {
      source,
      // Le premier quintile plutôt que le minimum absolu : un mois catastrophique isolé
      // ne doit pas devenir la référence de tous les mois suivants.
      low: Statistics.percentile(history, 0.2, currency),
      typical: Statistics.median(history, currency),
      high: Statistics.percentile(history, 0.8, currency),
      actual,
      historyMonths: history.length,
      variable: true,
    };
  }

  return {
    source,
    low: source.minAmount ? monthlyEquivalent(source.minAmount, source.frequency) : typical.times(1 - DEFAULT_SPREAD),
    typical,
    high: source.maxAmount ? monthlyEquivalent(source.maxAmount, source.frequency) : typical.times(1 + DEFAULT_SPREAD),
    actual,
    historyMonths: history.length,
    variable: true,
  };
}

function pick(estimate: IncomeSourceEstimate, mode: IncomePlanningMode): Money {
  // Un montant encaissé n'est plus une hypothèse : il remplace l'estimation.
  if (estimate.actual) return estimate.actual;
  switch (mode) {
    case 'prudent':
      return estimate.low;
    case 'typical':
      return estimate.typical;
    case 'optimistic':
      return estimate.high;
  }
}

export function incomeBreakdown(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date,
  mode: IncomePlanningMode,
): IncomeBreakdown {
  const currency: Currency = profile.currency;
  const sources = activeIncomes(profile, reference).map((source) => estimateSource(profile, source, period));

  // Les entrées ponctuelles non rattachées à une source déclarée : prime, remboursement,
  // vente. Elles sont certaines puisque déjà encaissées, donc comptées à l'identique
  // dans les trois hypothèses. Les versements de trading en sont exclus : ils suivent
  // une règle propre, bien plus prudente.
  const oneOff = Money.sum(
    transactionsIn(profile, period)
      .filter(
        (transaction) =>
          transaction.kind === 'income' &&
          transaction.incomeSourceId === undefined &&
          transaction.tradingAccountId === undefined,
      )
      .map((transaction) => transaction.amount),
    currency,
  );

  const trading = profile.tradingAccounts.length > 0 ? tradingIncomeEstimate(profile, period) : null;
  // Un versement déjà encaissé est acquis ; sinon on retient le bas de fourchette, qui
  // vaut zéro tant que l'activité n'a pas six mois de recul.
  const tradingPlanned = trading ? (trading.actual ?? trading.low) : Money.zero(currency);
  const tradingTypical = trading ? (trading.actual ?? trading.typical) : Money.zero(currency);
  const tradingHigh = trading ? (trading.actual ?? trading.high) : Money.zero(currency);

  const low = Money.sum([...sources.map((entry) => entry.actual ?? entry.low), oneOff, tradingPlanned], currency);
  const typical = Money.sum([...sources.map((entry) => entry.actual ?? entry.typical), oneOff, tradingTypical], currency);
  const high = Money.sum([...sources.map((entry) => entry.actual ?? entry.high), oneOff, tradingHigh], currency);
  const planned = Money.sum([...sources.map((entry) => pick(entry, mode)), oneOff, tradingPlanned], currency);

  const received = Money.sum(
    [
      ...sources.map((entry) => entry.actual ?? Money.zero(currency)),
      oneOff,
      trading?.actual ?? Money.zero(currency),
    ],
    currency,
  );

  const volatility = typical.isZero ? null : high.minus(low).units / typical.units;

  return {
    sources,
    trading: trading
      ? {
          planned: tradingPlanned,
          typical: tradingTypical,
          high: tradingHigh,
          plannable: trading.plannable,
          monthsObserved: trading.monthsObserved,
        }
      : null,
    low,
    typical,
    high,
    planned,
    received,
    hasVariableSource: sources.some((entry) => entry.variable) || trading !== null,
    volatility,
  };
}

/** Un revenu dont l'amplitude dépasse ce seuil demande une gestion différente : coussin
 *  de lissage, planification prudente, et pas d'engagement fixe sur les bons mois. */
export const HIGH_VOLATILITY_THRESHOLD = 0.3;

/**
 * Coussin de lissage recommandé.
 *
 * Pour un revenu irrégulier, l'outil classique n'est pas l'épargne de précaution mais un
 * compte tampon : les bons mois y déposent l'excédent, les mauvais mois y puisent. Sa
 * taille se déduit de l'écart entre le mois typique et le mois faible.
 */
export function smoothingBuffer(breakdown: IncomeBreakdown, monthsOfCover = 3): Money {
  const gap = breakdown.typical.minus(breakdown.low).clampedToZero;
  return gap.times(BigInt(Math.max(monthsOfCover, 1)));
}

export function isCurrentMonth(period: YearMonth, reference: Date): boolean {
  return yearMonthEquals(period, yearMonthOf(reference));
}
