import { Money } from '../money';
import { monthlyEquivalent } from '../frequency';
import { activeIncomes, type FinancialProfile, type IncomeSource, type Transaction } from '../model';
import { containsDate, daysInMonth, dateOf, parseDate, type YearMonth } from '../yearMonth';

/**
 * Encaissements.
 *
 * Un revenu déclaré dans le budget n'est qu'une **attente** : il dit ce qui devrait
 * arriver, pas ce qui est arrivé. Tant que personne ne confirme la réception, aucun euro
 * n'entre sur un compte, et le solde suivi reste celui d'avant la paie.
 *
 * C'est le chaînon qui manquait au suivi de comptes : les dépenses étaient enregistrées,
 * les revenus non. Un compte qui ne voit que des sorties finit fatalement à découvert
 * dans l'application alors qu'il ne l'est pas dans la vraie vie.
 */

export interface ExpectedIncome {
  readonly source: IncomeSource;
  /** Montant attendu, ramené au mois. */
  readonly expected: Money;
  /** Date à laquelle il est attendu. */
  readonly date: Date;
  /** L'écriture déjà enregistrée pour ce revenu et ce mois, s'il y en a une. */
  readonly received: Transaction | null;
  /** Montant réellement reçu, quand il est enregistré. */
  readonly amount: Money | null;
  /** Reçu mais sans compte crédité : le solde ne bouge pas, il faut le dire. */
  readonly unassigned: boolean;
}

function expectedDay(source: IncomeSource, period: YearMonth): number {
  const total = daysInMonth(period);
  return Math.min(Math.max(source.dayOfMonth ?? total, 1), total);
}

/**
 * Ce qui est attendu ce mois-ci, et ce qui est déjà tombé.
 *
 * Un revenu est considéré comme encaissé dès qu'une écriture de revenu porte son
 * identifiant sur le mois — quel que soit son montant, y compris zéro. « Rien reçu » est
 * une réponse, pas une absence de réponse.
 */
export function expectedIncomes(
  profile: FinancialProfile,
  period: YearMonth,
  reference: Date = new Date(),
): readonly ExpectedIncome[] {
  return activeIncomes(profile, reference).map((source) => {
    const received =
      profile.transactions.find(
        (transaction) =>
          transaction.kind === 'income' &&
          transaction.incomeSourceId === source.id &&
          containsDate(period, parseDate(transaction.date)),
      ) ?? null;

    return {
      source,
      expected: monthlyEquivalent(source.amount, source.frequency),
      date: dateOf(period, expectedDay(source, period)),
      received,
      amount: received?.amount ?? null,
      unassigned: received !== null && received.accountId === undefined,
    };
  });
}

/**
 * Date d'un encaissement confirmé.
 *
 * Le jour de réception habituel, mais jamais dans le futur : confirmer avoir reçu de
 * l'argent le 20 alors que la paie est attendue le 31 daterait l'écriture d'une semaine
 * plus tard, et le solde d'aujourd'hui n'en verrait rien. On date au plus tôt des deux —
 * l'argent est là, il doit compter aujourd'hui.
 *
 * Pour un mois révolu, la question ne se pose pas : c'est le jour de réception.
 */
function receiptDay(entry: ExpectedIncome, period: YearMonth, reference: Date): number {
  const usual = expectedDay(entry.source, period);
  if (!containsDate(period, reference)) return usual;
  return Math.min(usual, reference.getDate());
}

/**
 * L'écriture à créer quand on confirme un encaissement.
 *
 * Le compte crédité est celui du revenu s'il en porte un ; à défaut, celui que l'appelant
 * propose. Sans compte, l'écriture existe quand même — elle compte dans le budget — mais
 * elle est signalée comme non affectée plutôt que posée au hasard sur un compte.
 */
export function receiptTransaction(
  entry: ExpectedIncome,
  period: YearMonth,
  amount: Money,
  fallbackAccountId?: string,
  reference: Date = new Date(),
): Omit<Transaction, 'id'> {
  const accountId = entry.source.accountId ?? fallbackAccountId;
  const day = receiptDay(entry, period, reference);
  return {
    amount,
    date: `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    kind: 'income',
    label: entry.source.name,
    incomeCategory: entry.source.category,
    incomeSourceId: entry.source.id,
    note: 'Encaissement confirmé',
    ...(accountId ? { accountId } : {}),
  };
}

/** Total attendu et total déjà encaissé, pour l'en-tête d'un écran. */
export function receiptTotals(
  entries: readonly ExpectedIncome[],
  currency: FinancialProfile['currency'],
): { readonly expected: Money; readonly received: Money; readonly pending: number } {
  return {
    expected: Money.sum(entries.map((entry) => entry.expected), currency),
    received: Money.sum(
      entries.filter((entry) => entry.amount !== null).map((entry) => entry.amount!),
      currency,
    ),
    pending: entries.filter((entry) => entry.received === null).length,
  };
}
