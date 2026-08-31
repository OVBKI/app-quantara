import { Money } from '../money';
import { monthlyEquivalent, occurrencesPerYear } from '../frequency';
import { recurringExpensesFor, transactionsIn, type FinancialProfile, type RecurringExpense, type Transaction } from '../model';
import { addMonths, containsDate, dateOf, daysInMonth, startOfDay, type YearMonth } from '../yearMonth';

/**
 * Pointage des charges fixes.
 *
 * Une charge déclarée dans le budget dit ce qui **devrait** partir. Elle ne dit pas que
 * c'est parti. Tant que personne ne le confirme, aucun euro ne quitte le compte suivi —
 * et un compte qui ne voit que des entrées finit par afficher un solde qui n'existe pas.
 *
 * Le pendant exact des encaissements : là « j'ai reçu », ici « c'est parti ». Les deux
 * créent la même chose — une écriture ordinaire, celle que tous les moteurs lisent déjà.
 * Rien de spécifique au pointage n'est stocké nulle part.
 *
 * **C'est aussi ce qui règle la remise à zéro.** La liste n'est pas un état qu'il faudrait
 * penser à vider le 1er du mois : elle se déduit des écritures du mois affiché. Un mois
 * sans écriture est un mois où rien n'est coché, et revenir sur un mois passé remontre
 * exactement ce qui avait été pointé à l'époque. Il n'y a pas de réinitialisation, parce
 * qu'il n'y a rien à réinitialiser.
 */

export interface DueCharge {
  readonly expense: RecurringExpense;
  /**
   * Montant à prélever ce mois-ci.
   *
   * Le montant **réel** du prélèvement, pas l'équivalent mensuel : une assurance annuelle
   * de 1 200 € retire 1 200 € le jour où elle tombe, pas 100 € chaque mois. Le budget la
   * lisse pour planifier, le compte non — et c'est le compte qu'on pointe ici.
   *
   * Les flux plus fréquents qu'un mois (hebdomadaire, quinzaine) font l'inverse : leur
   * total du mois, en une seule case, plutôt que quatre cases à cocher.
   */
  readonly due: Money;
  /** Jour où le prélèvement est attendu. */
  readonly date: Date;
  /** Les écritures déjà enregistrées pour cette charge et ce mois. */
  readonly payments: readonly Transaction[];
  /** Montant réellement sorti, somme des écritures. `null` si rien n'est pointé. */
  readonly amount: Money | null;
  /** Écart entre le réel et le prévu. Positif = plus cher que prévu. Zéro sans pointage. */
  readonly difference: Money;
  readonly paid: boolean;
  /** Pointé, mais sans compte débité : le solde ne bouge pas, il faut le dire. */
  readonly unassigned: boolean;
  /** L'échéance est passée et rien n'est pointé. */
  readonly overdue: boolean;
}

function dueDay(expense: RecurringExpense, period: YearMonth): number {
  const total = daysInMonth(period);
  return Math.min(Math.max(expense.dayOfMonth, 1), total);
}

/** Un flux dont deux échéances sont séparées de plus d'un mois. */
function spansMoreThanAMonth(expense: RecurringExpense): boolean {
  const occurrences = occurrencesPerYear(expense.frequency);
  return occurrences !== null && occurrences < 12;
}

/** Nombre de mois entre deux échéances : 3 pour un trimestriel, 12 pour un annuel. */
function monthsBetweenOccurrences(expense: RecurringExpense): number {
  const occurrences = occurrencesPerYear(expense.frequency);
  return occurrences === null || occurrences === 0 ? 1 : Math.round(12 / occurrences);
}

function paymentsFor(profile: FinancialProfile, period: YearMonth, expenseId: string): Transaction[] {
  return transactionsIn(profile, period).filter(
    (transaction) => transaction.kind === 'expense' && transaction.recurringExpenseId === expenseId,
  );
}

/**
 * Une charge non mensuelle est-elle encore à payer, ou déjà réglée pour sa période ?
 *
 * Sans champ « quel mois de l'année », l'application ne peut pas deviner qu'une assurance
 * tombe en mars. Elle la propose donc à chaque mois — jusqu'à ce qu'elle soit pointée, et
 * la retire alors pour toute la durée couverte. Le geste de l'utilisateur enseigne la date
 * à l'application, sans qu'il ait rien à paramétrer.
 */
function settledForItsPeriod(profile: FinancialProfile, expense: RecurringExpense, period: YearMonth): boolean {
  const span = monthsBetweenOccurrences(expense);
  for (let back = 1; back < span; back += 1) {
    if (paymentsFor(profile, addMonths(period, -back), expense.id).length > 0) return true;
  }
  return false;
}

export function dueCharges(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date = new Date(),
): readonly DueCharge[] {
  const today = startOfDay(reference);

  return recurringExpensesFor(profile, period)
    .filter((expense) => !settledForItsPeriod(profile, expense, period))
    .map((expense): DueCharge => {
      const payments = paymentsFor(profile, period, expense.id);
      const amount = payments.length === 0 ? null : Money.sum(payments.map((entry) => entry.amount), profile.currency);
      const due = spansMoreThanAMonth(expense)
        ? expense.amount
        : monthlyEquivalent(expense.amount, expense.frequency);
      const date = dateOf(period, dueDay(expense, period));

      return {
        expense,
        due,
        date,
        payments,
        amount,
        difference: amount === null ? Money.zero(profile.currency) : amount.minus(due),
        paid: payments.length > 0,
        unassigned: payments.some((entry) => entry.accountId === undefined),
        overdue: payments.length === 0 && date <= today,
      };
    });
}

/**
 * Date du pointage.
 *
 * Le jour de prélèvement habituel, mais jamais dans le futur : cocher le 10 une charge
 * attendue le 25 daterait l'écriture de deux semaines plus tard, et le solde d'aujourd'hui
 * n'en verrait rien. On retient le plus tôt des deux — l'argent est parti, il doit compter
 * maintenant. Sur un mois révolu la question ne se pose pas : c'est le jour d'échéance.
 */
function paymentDay(entry: DueCharge, period: YearMonth, reference: Date): number {
  const usual = dueDay(entry.expense, period);
  if (!containsDate(period, reference)) return usual;
  return Math.min(usual, reference.getDate());
}

/**
 * L'écriture à créer quand on coche une charge.
 *
 * Le compte débité est celui de la charge s'il en porte un ; à défaut, celui que l'appelant
 * propose. Sans compte, l'écriture existe quand même — elle compte dans le budget — mais
 * elle est signalée comme non affectée plutôt que posée au hasard sur un compte.
 *
 * `recurringExpenseId` est ce qui en fait une **matérialisation** : le budget l'exclut donc
 * des dépenses variables, et la trésorerie ne rejoue pas l'échéance. Sans lui, la charge
 * compterait deux fois.
 */
export function chargeTransaction(
  entry: DueCharge,
  period: YearMonth,
  amount: Money,
  fallbackAccountId?: string,
  reference: Date = new Date(),
): Omit<Transaction, 'id'> {
  const accountId = entry.expense.accountId ?? fallbackAccountId;
  const day = paymentDay(entry, period, reference);
  return {
    amount,
    date: `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    kind: 'expense',
    label: entry.expense.name,
    category: entry.expense.category,
    recurringExpenseId: entry.expense.id,
    note: 'Prélèvement pointé',
    ...(accountId ? { accountId } : {}),
  };
}

/** Ce qui est prévu, ce qui est parti, ce qu'il reste à pointer. */
export function chargeTotals(
  entries: readonly DueCharge[],
  currency: FinancialProfile['currency'],
): { readonly due: Money; readonly paid: Money; readonly remaining: Money; readonly pending: number } {
  const due = Money.sum(entries.map((entry) => entry.due), currency);
  const paid = Money.sum(
    entries.map((entry) => entry.amount ?? Money.zero(currency)),
    currency,
  );
  return {
    due,
    paid,
    remaining: Money.sum(
      entries.filter((entry) => !entry.paid).map((entry) => entry.due),
      currency,
    ),
    pending: entries.filter((entry) => !entry.paid).length,
  };
}
