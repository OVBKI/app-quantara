import { Money } from '../money';
import { monthsToCover } from './goals';
import type { MonthlySummary } from './budget';

export interface EmergencyFundTier {
  readonly months: number;
  readonly target: Money;
  readonly reached: boolean;
}

export interface EmergencyFundStatus {
  /** Dépenses à couvrir chaque mois : les essentielles, pas le train de vie complet. */
  readonly monthlyNeed: Money;
  readonly current: Money;
  readonly target: Money;
  readonly remaining: Money;
  readonly progress: number;
  /** Nombre de mois de dépenses essentielles déjà couverts. */
  readonly monthsCovered: number;
  readonly tiers: readonly EmergencyFundTier[];
  readonly monthsToTarget: number | null;
}

export const EMERGENCY_FUND_TIERS = [3, 6, 9] as const;

/**
 * Fonds d'urgence.
 *
 * La base de calcul est la dépense **essentielle**, pas la dépense totale : en cas de
 * coup dur, les restaurants et les loisirs s'arrêtent — le loyer, l'énergie et les
 * courses, non. Dimensionner sur le train de vie complet donne un objectif décourageant
 * et, en pratique, jamais atteint.
 */
export function emergencyFundStatus(
  summary: MonthlySummary,
  savingsBalance: Money,
  targetMonths: number,
  monthlyCapacity: Money,
): EmergencyFundStatus {
  const monthlyNeed = summary.essentialExpenses.isPositive
    ? summary.essentialExpenses
    : summary.fixedExpenses;

  const target = monthlyNeed.times(BigInt(Math.max(targetMonths, 1)));
  const remaining = target.minus(savingsBalance).clampedToZero;
  const progress = savingsBalance.ratioTo(target) ?? 0;
  const monthsCovered = monthlyNeed.isZero ? 0 : savingsBalance.units / monthlyNeed.units;

  const tiers = EMERGENCY_FUND_TIERS.map((months) => {
    const tierTarget = monthlyNeed.times(BigInt(months));
    return {
      months,
      target: tierTarget,
      reached: savingsBalance.greaterThanOrEqual(tierTarget),
    };
  });

  return {
    monthlyNeed,
    current: savingsBalance,
    target,
    remaining,
    progress: Math.min(Math.max(progress, 0), 1),
    monthsCovered,
    tiers,
    monthsToTarget: remaining.isZero ? 0 : monthsToCover(remaining, monthlyCapacity),
  };
}

export function isEmergencyFundThin(status: EmergencyFundStatus): boolean {
  return status.monthsCovered < 1;
}

export function isEmergencyFundComplete(status: EmergencyFundStatus): boolean {
  return status.remaining.isZero && status.target.isPositive;
}

export { Money };
