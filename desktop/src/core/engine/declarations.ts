import { Money } from '../money';
import { activeIncomes, transactionsIn, type FinancialProfile, type IncomeSource } from '../model';
import {
  addMonths,
  containsDate,
  daysInMonth,
  formatYearMonth,
  parseDate,
  yearMonthOf,
  type YearMonth,
} from '../yearMonth';

/**
 * Déclaration mensuelle des revenus irréguliers.
 *
 * Certains revenus varient trop pour qu'une fourchette veuille dire quoi que ce soit.
 * Plutôt que d'inventer une amplitude, l'application demande : combien avez-vous touché
 * ce mois-ci ? Le montant saisi devient une certitude, et remplace toute estimation.
 *
 * Deux règles gouvernent le moment où l'on demande :
 *
 * - **Un mois clos se déclare.** Dès qu'un mois est terminé, son montant est connu de
 *   l'utilisateur ; il n'y a plus de raison d'attendre.
 * - **Le mois courant ne se déclare qu'à son dernier jour.** Demander le 12 obtiendrait
 *   une réponse partielle, qui serait ensuite traitée comme un total — et fausserait
 *   tout le mois.
 *
 * On ne remonte pas au-delà de quelques mois : réclamer un an d'arriérés à quelqu'un qui
 * ouvre l'application est le meilleur moyen de lui faire fermer la fenêtre.
 */

/** Profondeur maximale des rappels. Au-delà, le mois est considéré comme perdu. */
export const MAX_PENDING_MONTHS = 3;

export interface PendingDeclaration {
  readonly source: IncomeSource;
  readonly period: YearMonth;
  readonly label: string;
  /** Le mois est terminé : le montant est connu, il ne reste qu'à le saisir. */
  readonly closed: boolean;
  /** Montant déjà déclaré, s'il s'agit d'une correction plutôt que d'une première saisie. */
  readonly current: Money | null;
  /** Médiane des mois déjà déclarés, proposée comme point de départ. `null` sans historique. */
  readonly suggestion: Money | null;
}

function declaredAmount(profile: FinancialProfile, period: YearMonth, sourceId: string): Money | null {
  const entries = transactionsIn(profile, period).filter(
    (transaction) => transaction.kind === 'income' && transaction.incomeSourceId === sourceId,
  );
  if (entries.length === 0) return null;
  return Money.sum(
    entries.map((entry) => entry.amount),
    profile.currency,
  );
}

/** Le mois est-il entièrement écoulé à la date de référence ? */
function isClosed(period: YearMonth, reference: Date): boolean {
  const current = yearMonthOf(reference);
  if (period.year !== current.year) return period.year < current.year;
  return period.month < current.month;
}

function isLastDayOfMonth(reference: Date): boolean {
  return reference.getDate() === daysInMonth(yearMonthOf(reference));
}

function startedBefore(source: IncomeSource, period: YearMonth): boolean {
  if (!source.startDate) return true;
  const start = parseDate(source.startDate);
  // Le mois compte dès lors que la source était active à un moment donné dedans.
  return start.getFullYear() < period.year || (start.getFullYear() === period.year && start.getMonth() + 1 <= period.month);
}

function endedAfter(source: IncomeSource, period: YearMonth): boolean {
  if (!source.endDate) return true;
  const end = parseDate(source.endDate);
  return containsDate(period, end) || end > new Date(period.year, period.month, 0);
}

/**
 * Les déclarations attendues, de la plus ancienne à la plus récente.
 *
 * Vide quand tout est à jour — c'est le cas courant, et l'interface ne doit alors rien
 * afficher du tout.
 */
export function pendingDeclarations(
  profile: FinancialProfile,
  reference: Date = new Date(),
): PendingDeclaration[] {
  const sources = activeIncomes(profile, reference).filter((source) => source.declaredMonthly);
  if (sources.length === 0) return [];

  const current = yearMonthOf(reference);
  const pending: PendingDeclaration[] = [];

  for (const source of sources) {
    const history = [1, 2, 3, 4, 5, 6]
      .map((back) => declaredAmount(profile, addMonths(current, -back), source.id))
      .filter((amount): amount is Money => amount !== null && amount.isPositive);

    const suggestion =
      history.length === 0
        ? null
        : [...history].sort((a, b) => (a.greaterThan(b) ? 1 : -1))[Math.floor(history.length / 2)] ?? null;

    // Du plus ancien au plus récent : on rattrape l'arriéré dans l'ordre du calendrier.
    for (let back = MAX_PENDING_MONTHS; back >= 0; back -= 1) {
      const period = addMonths(current, -back);
      if (!startedBefore(source, period) || !endedAfter(source, period)) continue;

      const closed = isClosed(period, reference);
      // Le mois en cours n'est réclamé qu'à son dernier jour.
      if (!closed && !isLastDayOfMonth(reference)) continue;
      if (declaredAmount(profile, period, source.id) !== null) continue;

      pending.push({
        source,
        period,
        label: formatYearMonth(period),
        closed,
        current: null,
        suggestion,
      });
    }
  }

  return pending;
}

/** Toutes les déclarations déjà faites pour une source, du mois le plus récent au plus
 *  ancien. Sert à corriger une saisie passée. */
export function declarationHistory(
  profile: FinancialProfile,
  source: IncomeSource,
  reference: Date = new Date(),
  months = 12,
): { period: YearMonth; label: string; amount: Money }[] {
  const current = yearMonthOf(reference);
  const entries: { period: YearMonth; label: string; amount: Money }[] = [];

  for (let back = 0; back < months; back += 1) {
    const period = addMonths(current, -back);
    const amount = declaredAmount(profile, period, source.id);
    if (amount) entries.push({ period, label: formatYearMonth(period), amount });
  }
  return entries;
}
