import { Money } from '../money';
import { monthsBetween, parseDate, yearMonthOf } from '../yearMonth';
import type { Goal } from '../model';

export type AlternativeKind = 'extendDeadline' | 'reduceTarget' | 'increaseEffort';

export interface GoalAlternative {
  readonly kind: AlternativeKind;
  readonly monthlyContribution: Money;
  readonly months: number;
  readonly target: Money;
  readonly additionalEffort: Money;
  readonly explanation: string;
}

export interface GoalPlan {
  readonly goal: Goal;
  readonly remaining: Money;
  readonly progress: number;
  readonly monthsUntilTarget: number | null;
  readonly requiredMonthly: Money | null;
  readonly plannedMonthly: Money | null;
  readonly projectedMonths: number | null;
  readonly projectedDate: Date | null;
  readonly feasible: boolean;
  readonly shortfall: Money | null;
  readonly alternatives: readonly GoalAlternative[];
  /** Écart entre la progression réelle et la progression théorique à ce jour.
   *  Positif = en avance. `null` si l'objectif n'a pas d'échéance. */
  readonly scheduleDeviation: number | null;
}

/**
 * Nombre de mois nécessaires pour couvrir un montant à une cadence donnée.
 *
 * Arrondi au supérieur : un mois entamé ne finance pas l'objectif.
 *
 * Le calcul se fait sur les micro-unités entières, jamais sur les euros en virgule
 * flottante. `Math.ceil(1666.65 / 333.33)` rend 6 : la division approchée dépasse 5 d'un
 * milliardième, et l'arrondi supérieur ajoute un mois entier à la prévision. Le même
 * calcul en entiers rend 5, qui est la bonne réponse.
 */
export function monthsToCover(amount: Money, monthlyRate: Money): number | null {
  if (!monthlyRate.isPositive) return null;
  if (!amount.isPositive) return 0;
  const rate = monthlyRate.micros;
  return Number((amount.micros + rate - 1n) / rate);
}

function goalProgress(goal: Goal): number {
  const ratio = goal.current.ratioTo(goal.target);
  return ratio === null ? 0 : Math.min(Math.max(ratio, 0), 1);
}

export function planGoal(goal: Goal, capacity: Money, reference: Date = new Date()): GoalPlan {
  const currency = goal.target.currency;
  const remaining = goal.target.minus(goal.current).clampedToZero;
  const progress = goalProgress(goal);

  const monthsUntilTarget = goal.targetDate
    ? Math.max(monthsBetween(yearMonthOf(reference), yearMonthOf(parseDate(goal.targetDate))), 0)
    : null;

  const requiredMonthly =
    monthsUntilTarget !== null && monthsUntilTarget > 0 ? remaining.dividedBy(BigInt(monthsUntilTarget)) : null;

  const plannedMonthly = goal.monthlyContribution ?? requiredMonthly;

  // Sans mensualité choisie ni échéance, la projection se fait au rythme réellement
  // disponible — la capacité d'épargne. « À ce rythme, 30 mois » est une information ;
  // « aucune date » n'en est pas une.
  const rate = plannedMonthly ?? capacity;
  const projectedMonths = remaining.isZero ? 0 : monthsToCover(remaining, rate);

  const projectedDate =
    projectedMonths === null
      ? null
      : new Date(reference.getFullYear(), reference.getMonth() + projectedMonths, reference.getDate());

  const feasible = requiredMonthly === null || requiredMonthly.lessThanOrEqual(capacity);
  const shortfall = requiredMonthly !== null && requiredMonthly.greaterThan(capacity)
    ? requiredMonthly.minus(capacity)
    : null;

  const alternatives = feasible
    ? []
    : buildAlternatives(remaining, goal.target, goal.current, capacity, monthsUntilTarget, requiredMonthly, currency);

  const scheduleDeviation = computeDeviation(goal, reference, progress);

  return {
    goal,
    remaining,
    progress,
    monthsUntilTarget,
    requiredMonthly,
    plannedMonthly,
    projectedMonths,
    projectedDate,
    feasible,
    shortfall,
    alternatives,
    scheduleDeviation,
  };
}

/**
 * Trois issues chiffrées quand la mensualité requise dépasse la capacité.
 *
 * Annoncer « objectif hors de portée » sans proposer de sortie n'aide personne :
 * l'utilisateur doit pouvoir choisir ce qu'il sacrifie — le délai, le montant, ou son
 * confort mensuel.
 */
function buildAlternatives(
  remaining: Money,
  target: Money,
  current: Money,
  capacity: Money,
  monthsUntilTarget: number | null,
  requiredMonthly: Money | null,
  currency: import('../money').Currency,
): GoalAlternative[] {
  const zero = Money.zero(currency);
  const results: GoalAlternative[] = [];

  // 1. Allonger l'échéance : même cible, même capacité, plus de temps.
  const monthsAtCapacity = monthsToCover(remaining, capacity);
  if (monthsAtCapacity !== null) {
    results.push({
      kind: 'extendDeadline',
      monthlyContribution: capacity,
      months: monthsAtCapacity,
      target,
      additionalEffort: zero,
      explanation: `En gardant ${capacity.roundedToUnit.format()} par mois, l'objectif est atteint en ${monthsAtCapacity} mois.`,
    });
  }

  // 2. Réduire la cible : même échéance, même capacité, objectif ajusté.
  if (monthsUntilTarget !== null && monthsUntilTarget > 0 && capacity.isPositive) {
    const reachable = current.plus(capacity.times(BigInt(monthsUntilTarget)));
    results.push({
      kind: 'reduceTarget',
      monthlyContribution: capacity,
      months: monthsUntilTarget,
      target: reachable.roundedToUnit,
      additionalEffort: zero,
      explanation: `À l'échéance prévue, ${reachable.roundedToUnit.format()} sont atteignables au rythme actuel.`,
    });
  }

  // 3. Augmenter l'effort : même cible, même échéance, mensualité plus élevée.
  if (requiredMonthly !== null) {
    const effort = requiredMonthly.minus(capacity).clampedToZero;
    results.push({
      kind: 'increaseEffort',
      monthlyContribution: requiredMonthly,
      months: monthsUntilTarget ?? 0,
      target,
      additionalEffort: effort,
      explanation: `Tenir l'échéance demande ${effort.roundedToUnit.format()} de plus par mois.`,
    });
  }

  return results;
}

function computeDeviation(goal: Goal, reference: Date, progress: number): number | null {
  if (!goal.targetDate) return null;
  const created = yearMonthOf(parseDate(goal.createdAt));
  const totalMonths = monthsBetween(created, yearMonthOf(parseDate(goal.targetDate)));
  if (totalMonths <= 0) return null;
  const elapsed = monthsBetween(created, yearMonthOf(reference));
  if (elapsed <= 0) return null;
  const expected = Math.min(elapsed / totalMonths, 1);
  return progress - expected;
}
