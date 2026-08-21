import { Money } from '../money';
import { monthlyEquivalent } from '../frequency';
import { incomesFor, type FinancialProfile, type IncomeSource, type Transaction } from '../model';
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
  /** Toutes les écritures enregistrées pour ce revenu et ce mois — un acompte puis le
   *  solde en font deux, et les deux comptent. */
  readonly receipts: readonly Transaction[];
  /** Montant réellement reçu, somme de toutes les écritures. `null` si rien n'est saisi. */
  readonly amount: Money | null;
  /**
   * Ce qui manque encore pour atteindre l'attente.
   *
   * Zéro dès qu'elle est couverte — et zéro également lorsqu'une écriture à 0 € a été
   * saisie : déclarer « rien reçu » est une réponse, pas un encaissement en attente.
   */
  readonly remaining: Money;
  /** Au moins une écriture sans compte crédité : le solde ne bouge pas, il faut le dire. */
  readonly unassigned: boolean;
}

function expectedDay(source: IncomeSource, period: YearMonth): number {
  const total = daysInMonth(period);
  return Math.min(Math.max(source.dayOfMonth ?? total, 1), total);
}

/**
 * Ce qui est attendu ce mois-ci, et ce qui est déjà tombé.
 *
 * Toutes les écritures du mois portant l'identifiant de la source sont additionnées, pas
 * seulement la première : un acompte suivi du solde forme un encaissement complet. Ne
 * retenir que la première écriture laissait le mois éternellement « partiellement reçu ».
 */
export function expectedIncomes(
  profile: FinancialProfile,
  period: YearMonth,
  /** Conservé par symétrie : les sources retenues dépendent du mois affiché. */
  _reference: Date = new Date(),
): readonly ExpectedIncome[] {
  return incomesFor(profile, period).map((source) => {
    const receipts = profile.transactions.filter(
      (transaction) =>
        transaction.kind === 'income' &&
        transaction.incomeSourceId === source.id &&
        containsDate(period, parseDate(transaction.date)),
    );
    const expected = monthlyEquivalent(source.amount, source.frequency);
    const amount = receipts.length === 0 ? null : Money.sum(receipts.map((entry) => entry.amount), profile.currency);
    const declaredNothing = receipts.some((entry) => entry.amount.isZero);

    return {
      source,
      expected,
      date: dateOf(period, expectedDay(source, period)),
      receipts,
      amount,
      remaining: declaredNothing
        ? Money.zero(profile.currency)
        : expected.minus(amount ?? Money.zero(profile.currency)).clampedToZero,
      unassigned: receipts.some((entry) => entry.accountId === undefined),
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
      entries.map((entry) => entry.amount ?? Money.zero(currency)),
      currency,
    ),
    // Un encaissement partiel reste en attente : il manque encore quelque chose.
    pending: entries.filter((entry) => entry.remaining.isPositive).length,
  };
}
