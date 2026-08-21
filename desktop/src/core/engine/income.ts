import { Money } from '../money';
import type { Currency } from '../money';
import { monthlyEquivalent, occurrencesPerYear, type Frequency } from '../frequency';
import { incomesFor, transactionsIn, type FinancialProfile, type IncomeSource } from '../model';
import { addMonths, lastMonths, yearMonthEquals, yearMonthOf, type YearMonth } from '../yearMonth';
import { Statistics } from './statistics';

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
  /** La source attend une saisie mensuelle exacte. */
  readonly declaredMonthly: boolean;
  /**
   * Le montant du mois n'est pas connu et ne peut pas être estimé honnêtement.
   *
   * Vrai pour une source déclarée mensuellement dont ni le mois courant ni assez de mois
   * passés ne sont renseignés. Le plan doit alors le dire, pas combler le vide.
   */
  readonly unknown: boolean;
  /** Estimation tirée des mois déjà déclarés, en attendant la saisie du mois. */
  readonly provisional: boolean;
}

export interface IncomeBreakdown {
  readonly sources: readonly IncomeSourceEstimate[];
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
  /** Au moins une source attend une déclaration pour ce mois. */
  readonly awaitingDeclaration: boolean;
}

const HISTORY_MONTHS = 6;
const MINIMUM_MONTHS_FOR_HISTORY = 3;

/** En deçà, la médiane des mois passés ne dit rien : deux points ne font pas une
 *  tendance, et présenter leur moyenne comme une prévision serait mentir. */
const MINIMUM_MONTHS_FOR_PROVISIONAL = 2;

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
      declaredMonthly: false,
      unknown: false,
      provisional: false,
    };
  }

  const history = historyFor(profile, period, source.id);

  /*
   * Revenu déclaré chaque mois.
   *
   * Aucune fourchette n'est inventée : soit le mois est saisi et le montant est certain,
   * soit il ne l'est pas et l'application le dit. Entre les deux, dès deux mois déjà
   * déclarés, une estimation provisoire est proposée — annoncée comme telle, jamais
   * confondue avec un montant reçu.
   */
  if (source.declaredMonthly) {
    if (actual) {
      return {
        source,
        low: actual,
        typical: actual,
        high: actual,
        actual,
        historyMonths: history.length,
        variable: true,
        declaredMonthly: true,
        unknown: false,
        provisional: false,
      };
    }

    if (history.length >= MINIMUM_MONTHS_FOR_PROVISIONAL) {
      const median = Statistics.median(history, currency);
      return {
        source,
        // Avec deux mois seulement, les percentiles n'ont pas de sens : on prend les
        // bornes observées telles quelles.
        low: history.length >= MINIMUM_MONTHS_FOR_HISTORY
          ? Statistics.percentile(history, 0.2, currency)
          : Statistics.percentile(history, 0, currency),
        typical: median,
        high: history.length >= MINIMUM_MONTHS_FOR_HISTORY
          ? Statistics.percentile(history, 0.8, currency)
          : Statistics.percentile(history, 1, currency),
        actual: null,
        historyMonths: history.length,
        variable: true,
        declaredMonthly: true,
        unknown: false,
        provisional: true,
      };
    }

    const nothing = Money.zero(currency);
    return {
      source,
      low: nothing,
      typical: nothing,
      high: nothing,
      actual: null,
      historyMonths: history.length,
      variable: true,
      declaredMonthly: true,
      unknown: true,
      provisional: false,
    };
  }

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
      declaredMonthly: false,
      unknown: false,
      provisional: false,
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
    declaredMonthly: false,
    unknown: false,
    provisional: false,
  };
}

function pick(estimate: IncomeSourceEstimate, mode: IncomePlanningMode): Money {
  switch (mode) {
    case 'prudent':
      return estimate.low;
    case 'typical':
      return estimate.typical;
    case 'optimistic':
      return estimate.high;
  }
}

/** Un flux dont deux versements sont séparés de plus d'un mois. */
function spansMoreThanAMonth(frequency: Frequency): boolean {
  const occurrences = occurrencesPerYear(frequency);
  return occurrences !== null && occurrences < 12;
}

/**
 * Ce que le plan retient pour une source, une fois l'encaissement connu.
 *
 * Un encaissement **complète** l'attente, il ne la remplace pas. Un acompte de 1 500 € sur
 * un salaire de 3 000 € ne ramène pas le revenu du mois à 1 500 € : il annonce que 1 500 €
 * restent à venir. La règle qui en découle est une garantie simple à énoncer — noter une
 * rentrée d'argent ne fait jamais baisser le revenu du mois.
 *
 * Deux exceptions, chacune pour une raison précise :
 *
 * - Une source **déclarée chaque mois** n'a pas d'attente à compléter : la déclaration
 *   *est* le montant du mois, à la hausse comme à la baisse.
 * - Un revenu **non mensuel** est déjà lissé par son équivalent mensuel. Un trimestre de
 *   3 000 € vaut 1 000 €/mois ; laisser l'encaissement porter son mois à 3 000 € sans rien
 *   retirer aux deux autres faisait compter 5 000 € pour le trimestre.
 */
function retained(estimate: IncomeSourceEstimate, expectation: Money): Money {
  if (estimate.declaredMonthly) return estimate.actual ?? expectation;
  if (estimate.actual === null) return expectation;
  if (spansMoreThanAMonth(estimate.source.frequency)) return expectation;
  return Money.max(expectation, estimate.actual);
}

export function incomeBreakdown(
  profile: FinancialProfile,
  period: YearMonth,
  /** Conservé par symétrie avec les autres moteurs : les sources retenues dépendent
   *  désormais du mois affiché, pas de la date du jour. */
  _reference: Date,
  mode: IncomePlanningMode,
): IncomeBreakdown {
  const currency: Currency = profile.currency;
  const sources = incomesFor(profile, period).map((source) => estimateSource(profile, source, period));

  // Les entrées ponctuelles non rattachées à une source déclarée : prime, remboursement,
  // vente. Elles sont certaines puisque déjà encaissées, donc comptées à l'identique
  // dans les trois hypothèses.
  const oneOff = Money.sum(
    transactionsIn(profile, period)
      .filter((transaction) => transaction.kind === 'income' && transaction.incomeSourceId === undefined)
      .map((transaction) => transaction.amount),
    currency,
  );

  const low = Money.sum([...sources.map((entry) => retained(entry, entry.low)), oneOff], currency);
  const typical = Money.sum([...sources.map((entry) => retained(entry, entry.typical)), oneOff], currency);
  const high = Money.sum([...sources.map((entry) => retained(entry, entry.high)), oneOff], currency);
  const planned = Money.sum([...sources.map((entry) => retained(entry, pick(entry, mode))), oneOff], currency);

  const received = Money.sum(
    [...sources.map((entry) => entry.actual ?? Money.zero(currency)), oneOff],
    currency,
  );

  const volatility = typical.isZero ? null : high.minus(low).units / typical.units;

  return {
    sources,
    low,
    typical,
    high,
    planned,
    received,
    hasVariableSource: sources.some((entry) => entry.variable),
    volatility,
    awaitingDeclaration: sources.some((entry) => entry.declaredMonthly && entry.actual === null),
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
