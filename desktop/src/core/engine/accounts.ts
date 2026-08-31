import { Money } from '../money';
import {
  accountBalance,
  movementOn,
  transactionsIn,
  type Account,
  type FinancialProfile,
  type Transaction,
} from '../model';
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

/**
 * Sens d'un mouvement pour un compte donné, réexporté depuis le modèle.
 *
 * Ce fichier en portait une copie, mot pour mot. Deux exemplaires de la table de vérité
 * comptable, c'est un signe corrigé d'un côté et resté faux de l'autre — sans erreur de
 * compilation, sans test rouge, avec des soldes qui divergent d'un écran à l'autre.
 */
export { movementOn as movementFor } from '../model';

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

  /*
   * Même borne que le solde : ce qui précède la date de relevé y est **déjà compris**.
   *
   * Le relevé repartait du 1er du mois et rejouait tout, y compris les mouvements
   * antérieurs à la date de relevé. Quand celle-ci tombe en plein mois — le cas normal
   * après la mise en route, qui demande « le solde d'aujourd'hui » — la même carte
   * affichait deux soldes différents pour le même compte.
   */
  const statementDate = parseDate(account.balanceDate);

  const inPeriod = profile.transactions
    .map((transaction) => ({ transaction, date: parseDate(transaction.date) }))
    .filter((entry) => containsDate(period, entry.date) && entry.date > statementDate)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const movements: AccountMovement[] = [];
  for (const { transaction, date } of inPeriod) {
    const amount = movementOn(account.id, transaction);
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
  /*
   * Deux questions, deux réponses, et il faut les distinguer.
   *
   * `balance` est un **stock** : ce qu'il y a maintenant. Il part du montant saisi à la
   * date de relevé et n'ajoute que ce qui a suivi.
   *
   * `credited` / `debited` sont des **flux** : ce qui a bougé pendant le mois, tout le
   * mois. Les borner à la date de relevé faisait afficher « Sorti −0,00 € » sur un mois
   * où 1 780 € étaient manifestement partis — parce que le relevé avait été saisi après
   * eux. Un compte rendu du mois doit décrire le mois.
   *
   * Les deux ne se recomposent donc pas par une soustraction, et c'est normal :
   * `beforeStatement` dit exactement quelle part des flux du mois était déjà comprise
   * dans le solde saisi.
   */
  /** Ce qui est entré sur la période. */
  readonly credited: Money;
  /** Ce qui en est sorti, en valeur absolue. */
  readonly debited: Money;
  readonly net: Money;
  /** Part des mouvements du mois déjà comprise dans le solde de relevé, en valeur
   *  absolue. Zéro quand le relevé précède le mois — le cas courant à l'usage. */
  readonly beforeStatement: Money;
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

  // Les flux couvrent le mois entier, relevé ou pas : c'est ce que le mois a vu passer.
  const statementDate = parseDate(account.balanceDate);
  const monthly = transactionsIn(profile, period)
    .map((transaction) => ({ date: parseDate(transaction.date), amount: movementOn(account.id, transaction) }))
    .filter((entry): entry is { date: Date; amount: Money } => entry.amount !== null);

  const credited = Money.sum(
    monthly.filter((entry) => entry.amount.isPositive).map((entry) => entry.amount),
    currency,
  );
  const debited = Money.sum(
    monthly.filter((entry) => entry.amount.isNegative).map((entry) => Money.zero(currency).minus(entry.amount)),
    currency,
  );
  const beforeStatement = Money.sum(
    monthly.filter((entry) => entry.date <= statementDate).map((entry) => entry.amount.absolute),
    currency,
  );

  return {
    account,
    balance: value.balance,
    valuedByHoldings: value.valuedByHoldings,
    credited,
    debited,
    net: credited.minus(debited),
    beforeStatement,
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

  /*
   * Sans compte — ou pointant vers un compte qui n'existe plus. Le second cas naissait
   * d'une suppression de compte : l'écriture gardait un identifiant mort, n'entrait dans
   * aucun solde, et échappait à cette liste parce qu'elle n'y cherchait que l'absence
   * totale de compte. La détection vaut aussi pour les profils déjà dans cet état.
   */
  const known = new Set(profile.accounts.map((entry) => entry.id));
  const dangling = (id: string | undefined): boolean => id !== undefined && !known.has(id);

  const unassigned = profile.transactions.filter((transaction) => {
    if (!containsDate(period, parseDate(transaction.date))) return false;
    if (dangling(transaction.accountId) || dangling(transaction.toAccountId)) return true;
    return transaction.accountId === undefined && transaction.toAccountId === undefined;
  });

  return {
    accounts,
    total: Money.sum(accounts.map((entry) => entry.balance), currency),
    credited: Money.sum(accounts.map((entry) => entry.credited), currency),
    debited: Money.sum(accounts.map((entry) => entry.debited), currency),
    unassigned,
  };
}
