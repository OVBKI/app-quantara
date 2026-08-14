import { Money } from '../money';
import type { Currency } from '../money';
import { transactionsIn, type FinancialProfile, type TradingAccount } from '../model';
import { addMonths, lastMonths, parseDate, yearMonthOf, type YearMonth } from '../yearMonth';
import { Statistics } from './statistics';

/**
 * Comptes de société de financement (« prop firm »).
 *
 * Trois faits structurent tout ce module, et aucun n'est intuitif :
 *
 * 1. **Le capital alloué ne vous appartient pas.** Un compte financé de 100 000 € n'est
 *    pas 100 000 € de patrimoine : c'est un mandat de gestion révocable. Le compter dans
 *    son patrimoine net est l'erreur la plus courante — et la plus coûteuse, parce
 *    qu'elle donne le sentiment d'une aisance qui n'existe pas.
 *
 * 2. **Votre exposition financière réelle, c'est le prix des épreuves.** Vous ne pouvez
 *    pas perdre plus que ce que vous avez payé. C'est donc ce montant, et lui seul, qui
 *    entre dans le budget — au même titre qu'une dépense.
 *
 * 3. **Un versement reçu n'annonce pas le suivant.** Un compte se perd du jour au
 *    lendemain sur une règle de perte maximale. C'est pourquoi ce revenu se planifie à
 *    zéro tant qu'il n'existe pas d'historique suffisant.
 *
 * Ce module compte, il ne juge pas et ne conseille aucune stratégie.
 */

export interface PayoutStats {
  /** Versements reçus, mois par mois, sur la fenêtre observée. */
  readonly monthly: readonly { period: YearMonth; amount: Money }[];
  readonly total: Money;
  readonly median: Money;
  readonly best: Money;
  /** Nombre de mois observés ayant donné lieu à un versement. */
  readonly monthsWithPayout: number;
  readonly monthsObserved: number;
  /** Plus longue série de mois consécutifs sans versement. */
  readonly longestDrySpell: number;
}

export interface TradingSummary {
  readonly currency: Currency;

  // --- Sur la période ---
  readonly feesThisMonth: Money;
  readonly payoutsThisMonth: Money;
  readonly netThisMonth: Money;

  // --- Depuis le début ---
  readonly lifetimeFees: Money;
  readonly lifetimePayouts: Money;
  /** Versements encaissés moins épreuves payées. C'est le seul chiffre qui dit si
   *  l'activité rapporte. */
  readonly lifetimeNet: Money;

  // --- Comptes ---
  readonly accounts: readonly TradingAccount[];
  readonly activeAccounts: number;
  readonly fundedAccounts: number;
  readonly failedAccounts: number;
  readonly attemptsStarted: number;
  /** Part des épreuves menées jusqu'au financement. `null` si aucune n'est terminée. */
  readonly passRate: number | null;
  /** Coût moyen d'un compte financé, échecs compris. `null` si aucun compte financé. */
  readonly costPerFundedAccount: Money | null;

  /** Capital géré, toutes sociétés confondues. Ne vous appartient pas. */
  readonly allocatedCapital: Money;

  readonly payouts: PayoutStats;
  /** Part des revenus du foyer provenant du trading, sur la période. `null` sans revenu. */
  readonly shareOfIncome: number | null;
}

/** Fenêtre d'observation des versements. */
const PAYOUT_HISTORY_MONTHS = 12;

/**
 * Nombre de mois de recul exigé avant d'oser planifier quoi que ce soit sur cette
 * activité. En deçà, la part prudente reste à zéro : trois bons mois ne font pas un
 * revenu, ils font trois bons mois.
 */
export const MINIMUM_MONTHS_BEFORE_PLANNING = 6;

export function activeTradingAccounts(profile: FinancialProfile): TradingAccount[] {
  return profile.tradingAccounts.filter((account) => account.phase !== 'failed' && account.phase !== 'closed');
}

function payoutsIn(profile: FinancialProfile, period: YearMonth): Money {
  return Money.sum(
    transactionsIn(profile, period)
      .filter((transaction) => transaction.kind === 'income' && transaction.tradingAccountId !== undefined)
      .map((transaction) => transaction.amount),
    profile.currency,
  );
}

/** Épreuves payées sur un mois : le coût est imputé au mois où le compte a été ouvert. */
function feesIn(profile: FinancialProfile, period: YearMonth): Money {
  return Money.sum(
    profile.tradingAccounts
      .filter((account) => {
        const started = yearMonthOf(parseDate(account.startedAt));
        return started.year === period.year && started.month === period.month;
      })
      .map((account) => account.fee),
    profile.currency,
  );
}

export function payoutStats(profile: FinancialProfile, period: YearMonth): PayoutStats {
  const currency = profile.currency;
  const months = lastMonths(period, PAYOUT_HISTORY_MONTHS);
  const monthly = months.map((month) => ({ period: month, amount: payoutsIn(profile, month) }));

  const positives = monthly.map((entry) => entry.amount).filter((amount) => amount.isPositive);

  let longestDrySpell = 0;
  let current = 0;
  for (const entry of monthly) {
    if (entry.amount.isPositive) {
      current = 0;
    } else {
      current += 1;
      longestDrySpell = Math.max(longestDrySpell, current);
    }
  }

  return {
    monthly,
    total: Money.sum(positives, currency),
    median: positives.length > 0 ? Statistics.median(positives, currency) : Money.zero(currency),
    best: positives.reduce((best, amount) => Money.max(best, amount), Money.zero(currency)),
    monthsWithPayout: positives.length,
    monthsObserved: monthly.length,
    longestDrySpell,
  };
}

export function tradingSummary(
  profile: FinancialProfile,
  period: YearMonth,
  householdIncome: Money,
): TradingSummary {
  const currency = profile.currency;
  const accounts = profile.tradingAccounts;

  const lifetimeFees = Money.sum(accounts.map((account) => account.fee), currency);
  const lifetimePayouts = Money.sum(
    profile.transactions
      .filter((transaction) => transaction.kind === 'income' && transaction.tradingAccountId !== undefined)
      .map((transaction) => transaction.amount),
    currency,
  );

  const funded = accounts.filter((account) => account.phase === 'funded');
  const failed = accounts.filter((account) => account.phase === 'failed');
  const settled = funded.length + failed.length;

  const feesThisMonth = feesIn(profile, period);
  const payoutsThisMonth = payoutsIn(profile, period);

  return {
    currency,
    feesThisMonth,
    payoutsThisMonth,
    netThisMonth: payoutsThisMonth.minus(feesThisMonth),

    lifetimeFees,
    lifetimePayouts,
    lifetimeNet: lifetimePayouts.minus(lifetimeFees),

    accounts,
    activeAccounts: activeTradingAccounts(profile).length,
    fundedAccounts: funded.length,
    failedAccounts: failed.length,
    attemptsStarted: accounts.length,
    passRate: settled > 0 ? funded.length / settled : null,
    costPerFundedAccount: funded.length > 0 ? lifetimeFees.dividedBy(BigInt(funded.length)) : null,

    allocatedCapital: Money.sum(
      activeTradingAccounts(profile)
        .filter((account) => account.phase === 'funded')
        .map((account) => account.accountSize),
      currency,
    ),

    payouts: payoutStats(profile, addMonths(period, -1)),
    shareOfIncome: householdIncome.isZero ? null : payoutsThisMonth.units / householdIncome.units,
  };
}

export interface TradingIncomeEstimate {
  readonly low: Money;
  readonly typical: Money;
  readonly high: Money;
  readonly actual: Money | null;
  readonly monthsObserved: number;
  readonly plannable: boolean;
}

/**
 * Estimation du revenu de trading pour un mois.
 *
 * Règle volontairement sévère : **la part prudente reste nulle tant qu'on n'a pas six
 * mois d'observation**. Un compte financé se perd sur une seule séance en dépassant la
 * perte maximale autorisée ; adosser un loyer à ce revenu, c'est prendre le risque de
 * devoir le payer un mois où le compte n'existe plus.
 *
 * Passé six mois, le bas de fourchette devient le premier quintile des versements — et
 * non leur moyenne, qui serait tirée vers le haut par les bons mois.
 */
export function tradingIncomeEstimate(profile: FinancialProfile, period: YearMonth): TradingIncomeEstimate {
  const currency = profile.currency;
  const actual = payoutsIn(profile, period);
  const stats = payoutStats(profile, addMonths(period, -1));

  const observed = stats.monthly.map((entry) => entry.amount);
  const plannable = stats.monthsWithPayout >= MINIMUM_MONTHS_BEFORE_PLANNING;

  if (!plannable) {
    return {
      low: Money.zero(currency),
      typical: stats.median,
      high: stats.best,
      actual: actual.isPositive ? actual : null,
      monthsObserved: stats.monthsWithPayout,
      plannable: false,
    };
  }

  return {
    // Le premier quintile inclut les mois sans versement : ils font partie de la réalité
    // de l'activité, les exclure produirait une fourchette flatteuse et fausse.
    low: Statistics.percentile(observed, 0.2, currency),
    typical: Statistics.median(observed, currency),
    high: Statistics.percentile(observed, 0.8, currency),
    actual: actual.isPositive ? actual : null,
    monthsObserved: stats.monthsWithPayout,
    plannable: true,
  };
}

export const PHASE_LABELS = {
  challenge: 'Épreuve',
  verification: 'Vérification',
  funded: 'Financé',
  failed: 'Perdu',
  closed: 'Clôturé',
} as const;

/** Seuil au-delà duquel dépendre du trading pour vivre mérite d'être signalé. */
export const TRADING_DEPENDENCY_THRESHOLD = 0.3;
