import { Money } from '../money';
import {
  ALLOCATION_PART_LABELS,
  accountBalance,
  type Account,
  type AllocationPart,
  type FinancialProfile,
  type Transaction,
} from '../model';
import {
  containsDate,
  daysInMonth,
  dateOf,
  formatDate,
  formatYearMonth,
  yearMonthKey,
  type YearMonth,
} from '../yearMonth';
import type { AllocationBucket, AllocationPlan } from './allocation';

/**
 * Exécution du partage.
 *
 * Le partage calculé ne déplace rien tant que l'utilisateur n'a pas dit oui. Une fois
 * confirmé, il devient de vraies écritures : l'argent quitte le compte courant pour le
 * livret et le compte de placement, et le solde disponible baisse d'autant.
 *
 * C'est la différence entre un budget qu'on lit et un budget qui tient. Tant que les
 * 29 € de sécurité restent sur le compte courant, ils seront dépensés — non par
 * négligence, mais parce qu'ils étaient là.
 *
 * Rien n'est automatique : aucun virement ne part sans confirmation, et un partage
 * appliqué se défait entièrement. Déplacer de l'argent dans le dos de quelqu'un serait
 * la pire chose qu'une application de budget puisse faire.
 *
 * Note : ces écritures sont **internes**. Elles décrivent ce que vous faites de votre
 * argent ; elles ne commandent aucun virement à votre banque.
 */

/** Correspondance entre une part et le seau du plan qui la porte. */
const PART_BUCKET: Record<AllocationPart, AllocationBucket> = {
  security: 'emergencyFund',
  savings: 'goals',
  investment: 'investment',
  free: 'freeMoney',
};

/** Où va chaque part, et sous quelle forme. L'argent libre ne bouge pas : il est là
 *  précisément pour rester à portée. */
const PART_TARGET: Record<AllocationPart, { kind: Account['kind'] | null; transaction: 'savings' | 'transfer' }> = {
  security: { kind: 'savings', transaction: 'savings' },
  savings: { kind: 'savings', transaction: 'savings' },
  investment: { kind: 'investment', transaction: 'transfer' },
  free: { kind: null, transaction: 'transfer' },
};

export interface AllocationMove {
  readonly part: AllocationPart;
  readonly label: string;
  readonly amount: Money;
  readonly toAccountId: string;
  readonly kind: 'savings' | 'transfer';
}

export interface AllocationApplication {
  readonly period: YearMonth;
  /** Compte d'où part l'argent. `null` : aucun compte courant enregistré. */
  readonly fromAccountId: string | null;
  readonly moves: readonly AllocationMove[];
  /** Part qui reste sur le compte courant — l'argent libre. */
  readonly stays: Money;
  /** Total réellement déplacé. */
  readonly total: Money;
  /** Parts sans compte de destination : le montant est connu, l'endroit non. */
  readonly missingAccounts: readonly AllocationPart[];
  /** Ce qui empêche d'appliquer, formulé pour être affiché tel quel. */
  readonly blocked: string | null;
}

/** Comptes utilisables comme source : ceux où l'argent arrive et d'où il part. */
export function spendingAccounts(profile: FinancialProfile): readonly Account[] {
  return profile.accounts.filter((account) => !account.archived && (account.kind === 'checking' || account.kind === 'cash'));
}

export function destinationAccounts(profile: FinancialProfile, part: AllocationPart): readonly Account[] {
  const target = PART_TARGET[part].kind;
  if (target === null) return [];
  return profile.accounts.filter((account) => !account.archived && account.kind === target);
}

/**
 * Compte source proposé : celui qui porte le plus, parmi les comptes courants.
 *
 * Prendre le premier de la liste conduirait à vider un compte d'appoint pendant qu'un
 * autre est plein ; le mieux garni est le choix qui échoue le moins souvent.
 */
export function defaultSourceAccount(profile: FinancialProfile, reference = new Date()): Account | null {
  const candidates = spendingAccounts(profile);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, account) =>
    accountBalance(profile, account, reference).greaterThan(accountBalance(profile, best, reference)) ? account : best,
  );
}

function amountFor(plan: AllocationPlan, part: AllocationPart): Money {
  const bucket = PART_BUCKET[part];
  const lines = plan.lines.filter((line) => line.bucket === bucket);
  if (lines.length === 0) return plan.disposable.minus(plan.disposable);
  return Money.sum(lines.map((line) => line.amount), lines[0]!.amount.currency);
}

/**
 * Ce que « oui » déclenchera, avant de le déclencher.
 *
 * La fonction ne modifie rien : elle décrit. L'écran affiche cette description, et
 * l'utilisateur confirme ce qu'il a lu — pas un bouton dont il devine l'effet.
 */
export function planApplication(
  profile: FinancialProfile,
  plan: AllocationPlan,
  period: YearMonth,
  overrides: Partial<Record<AllocationPart | 'source', string>> = {},
  reference = new Date(),
): AllocationApplication {
  const currency = profile.currency;
  const source = overrides.source
    ? (profile.accounts.find((account) => account.id === overrides.source) ?? defaultSourceAccount(profile, reference))
    : defaultSourceAccount(profile, reference);

  const moves: AllocationMove[] = [];
  const missing: AllocationPart[] = [];

  for (const part of ['security', 'savings', 'investment'] as const) {
    const amount = amountFor(plan, part);
    if (!amount.isPositive) continue;
    const chosen = overrides[part];
    const candidates = destinationAccounts(profile, part);
    const account = candidates.find((entry) => entry.id === chosen) ?? candidates[0];
    if (!account) {
      missing.push(part);
      continue;
    }
    moves.push({
      part,
      label: ALLOCATION_PART_LABELS[part],
      amount,
      toAccountId: account.id,
      kind: PART_TARGET[part].transaction,
    });
  }

  const total = Money.sum(moves.map((move) => move.amount), currency);

  let blocked: string | null = null;
  if (source === null) {
    blocked = 'Aucun compte courant enregistré. Ajoutez-en un dans les Réglages : c’est de là que l’argent partira.';
  } else if (!plan.disposable.isPositive) {
    blocked = 'Rien à répartir ce mois-ci.';
  } else if (moves.length === 0) {
    blocked =
      missing.length > 0
        ? 'Aucun compte de destination. Ajoutez un livret ou un compte de placement dans les Réglages.'
        : 'Tout reste sur votre compte courant : aucune écriture n’est nécessaire.';
  }

  return {
    period,
    fromAccountId: source?.id ?? null,
    moves,
    stays: amountFor(plan, 'free'),
    total,
    missingAccounts: missing,
    blocked,
  };
}

/**
 * Date portée par les écritures.
 *
 * Le jour même si le mois est en cours — c'est bien aujourd'hui que l'argent bouge. Pour
 * un mois révolu, son dernier jour : dater d'aujourd'hui un partage de mars fausserait
 * le solde de tous les mois intermédiaires.
 */
function applicationDate(period: YearMonth, reference: Date): Date {
  return containsDate(period, reference) ? reference : dateOf(period, daysInMonth(period));
}

export function applicationTransactions(
  application: AllocationApplication,
  reference = new Date(),
): readonly Omit<Transaction, 'id'>[] {
  if (application.fromAccountId === null) return [];
  const date = formatDate(applicationDate(application.period, reference));
  const month = formatYearMonth(application.period);

  return application.moves.map((move) => ({
    amount: move.amount,
    date,
    kind: move.kind,
    label: `${move.label} — ${month}`,
    note: 'Partage automatique du budget.',
    accountId: application.fromAccountId ?? undefined,
    toAccountId: move.toAccountId,
    allocationMonth: yearMonthKey(application.period),
    allocationPart: move.part,
  }));
}

/** Les écritures déjà créées par le partage de ce mois. Vide : le partage n'a pas
 *  encore été appliqué. */
export function appliedAllocation(profile: FinancialProfile, period: YearMonth): readonly Transaction[] {
  const key = yearMonthKey(period);
  return profile.transactions.filter((transaction) => transaction.allocationMonth === key);
}

export function appliedTotal(profile: FinancialProfile, period: YearMonth): Money {
  return Money.sum(
    appliedAllocation(profile, period).map((transaction) => transaction.amount),
    profile.currency,
  );
}
