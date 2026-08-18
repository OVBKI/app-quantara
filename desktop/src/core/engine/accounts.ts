import { Money } from '../money';
import { accountBalance, type Account, type FinancialProfile, type Transaction } from '../model';
import { containsDate, daysInMonth, dateOf, parseDate, type YearMonth } from '../yearMonth';

/**
 * Suivi de compte.
 *
 * Le reste de l'application raisonne en budget : ce qui est prévu, ce qui reste, où cela
 * devrait aller. Ici on raisonne en **relevé** : ce qui est réellement passé sur un
 * compte, dans l'ordre, avec le solde après chaque ligne.
 *
 * Les deux ne se remplacent pas. Un budget dit ce qu'on avait décidé ; un relevé dit ce
 * qui s'est produit. C'est en les mettant côte à côte qu'on voit où l'un s'écarte de
 * l'autre.
 *
 * Aucun solde n'est stocké : tout se déduit du solde de départ daté et des mouvements
 * postérieurs. Un solde tenu à la main dérive dès qu'une écriture est corrigée.
 */

/** Sens d'un mouvement pour un compte donné. `null` : la transaction ne le concerne pas. */
export function movementFor(accountId: string, transaction: Transaction): Money | null {
  const currency = transaction.amount.currency;
  const leaves = transaction.accountId === accountId;
  const arrives = transaction.toAccountId === accountId;
  switch (transaction.kind) {
    case 'income':
      return leaves ? transaction.amount : null;
    case 'expense':
    case 'debtPayment':
      return leaves ? Money.zero(currency).minus(transaction.amount) : null;
    case 'savings':
    case 'transfer':
      if (leaves) return Money.zero(currency).minus(transaction.amount);
      if (arrives) return transaction.amount;
      return null;
  }
}

export interface AccountMovement {
  readonly transaction: Transaction;
  readonly date: Date;
  /** Signé : négatif s'il sort du compte. */
  readonly amount: Money;
  /** Solde du compte juste après ce mouvement. */
  readonly balanceAfter: Money;
}

/**
 * Les mouvements d'un compte sur une période, dans l'ordre, avec le solde courant.
 *
 * Le solde de départ est celui du dernier jour précédant la période — pas le solde de
 * relevé du compte, qui peut être bien antérieur. Sans quoi la première ligne afficherait
 * un solde faux de tous les mois écoulés depuis.
 */
export function accountMovements(
  profile: FinancialProfile,
  account: Account,
  period: YearMonth,
): readonly AccountMovement[] {
  const dayBefore = new Date(dateOf(period, 1));
  dayBefore.setDate(dayBefore.getDate() - 1);
  let balance = accountBalance(profile, account, dayBefore);

  const inPeriod = profile.transactions
    .map((transaction) => ({ transaction, date: parseDate(transaction.date) }))
    .filter((entry) => containsDate(period, entry.date))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const movements: AccountMovement[] = [];
  for (const { transaction, date } of inPeriod) {
    const amount = movementFor(account.id, transaction);
    if (amount === null) continue;
    balance = balance.plus(amount);
    movements.push({ transaction, date, amount, balanceAfter: balance });
  }
  return movements;
}

export interface AccountDay {
  readonly day: number;
  readonly balance: Money;
}

/** Solde du compte à la fin de chaque jour de la période — de quoi tracer sa courbe. */
export function accountDailyBalances(
  profile: FinancialProfile,
  account: Account,
  period: YearMonth,
): readonly AccountDay[] {
  const movements = accountMovements(profile, account, period);
  const dayBefore = new Date(dateOf(period, 1));
  dayBefore.setDate(dayBefore.getDate() - 1);

  let balance = accountBalance(profile, account, dayBefore);
  let index = 0;
  const days: AccountDay[] = [];
  for (let day = 1; day <= daysInMonth(period); day += 1) {
    while (index < movements.length && movements[index]!.date.getDate() <= day) {
      balance = movements[index]!.balanceAfter;
      index += 1;
    }
    days.push({ day, balance });
  }
  return days;
}

export interface AccountSummary {
  readonly account: Account;
  /** Solde à la date de référence. Pour un compte de placement détaillé ligne à ligne,
   *  c'est la valeur des lignes qui fait foi (voir `valuedByHoldings`). */
  readonly balance: Money;
  /** Le solde vient des lignes de portefeuille, pas des mouvements du compte. */
  readonly valuedByHoldings: boolean;
  /** Ce qui est entré sur la période. */
  readonly credited: Money;
  /** Ce qui en est sorti, en valeur absolue. */
  readonly debited: Money;
  readonly net: Money;
  readonly movementCount: number;
  readonly daily: readonly AccountDay[];
}

/**
 * Valeur d'un compte.
 *
 * Un compte de placement dont les lignes sont détaillées vaut la somme de ses lignes, pas
 * le cumul de ses versements : c'est la règle appliquée partout ailleurs dans
 * l'application (`totalInvestmentsBalance`). Compter les versements ici et les lignes
 * là-bas ferait afficher deux totaux différents pour le même compte, sur deux écrans
 * voisins.
 */
function accountValue(
  profile: FinancialProfile,
  account: Account,
  reference: Date,
): { readonly balance: Money; readonly valuedByHoldings: boolean } {
  const holdings = profile.holdings.filter((holding) => holding.accountId === account.id);
  if (account.kind === 'investment' && holdings.length > 0) {
    return {
      balance: Money.sum(holdings.map((holding) => holding.currentValue), profile.currency),
      valuedByHoldings: true,
    };
  }
  return { balance: accountBalance(profile, account, reference), valuedByHoldings: false };
}

export function summariseAccount(
  profile: FinancialProfile,
  account: Account,
  period: YearMonth,
  reference: Date = new Date(),
): AccountSummary {
  const currency = profile.currency;
  const movements = accountMovements(profile, account, period);
  const value = accountValue(profile, account, reference);

  const credited = Money.sum(
    movements.filter((entry) => entry.amount.isPositive).map((entry) => entry.amount),
    currency,
  );
  const debited = Money.sum(
    movements.filter((entry) => entry.amount.isNegative).map((entry) => Money.zero(currency).minus(entry.amount)),
    currency,
  );

  return {
    account,
    balance: value.balance,
    valuedByHoldings: value.valuedByHoldings,
    credited,
    debited,
    net: credited.minus(debited),
    movementCount: movements.length,
    daily: accountDailyBalances(profile, account, period),
  };
}

export interface AccountsOverview {
  readonly accounts: readonly AccountSummary[];
  /** Somme de tous les comptes, placements compris. */
  readonly total: Money;
  readonly credited: Money;
  readonly debited: Money;
  /** Écritures de la période ne portant aucun compte : elles échappent au suivi. */
  readonly unassigned: readonly Transaction[];
}

/**
 * Vue d'ensemble des comptes.
 *
 * Les écritures sans compte sont comptées à part et affichées comme telles. Les répartir
 * d'office sur un compte au hasard rendrait tous les soldes faux ; les taire les ferait
 * disparaître du suivi sans que personne ne s'en aperçoive.
 */
export function overviewAccounts(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date = new Date(),
): AccountsOverview {
  const currency = profile.currency;
  const accounts = profile.accounts
    .filter((account) => !account.archived)
    .map((account) => summariseAccount(profile, account, period, reference));

  const unassigned = profile.transactions.filter(
    (transaction) =>
      containsDate(period, parseDate(transaction.date)) &&
      transaction.accountId === undefined &&
      transaction.toAccountId === undefined,
  );

  return {
    accounts,
    total: Money.sum(accounts.map((entry) => entry.balance), currency),
    credited: Money.sum(accounts.map((entry) => entry.credited), currency),
    debited: Money.sum(accounts.map((entry) => entry.debited), currency),
    unassigned,
  };
}
