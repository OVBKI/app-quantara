import { Money } from '../money';
import type { Currency } from '../money';
import { isHighInterest, type Debt } from '../model';

export type DebtStrategy = 'avalanche' | 'snowball';

export interface DebtStep {
  readonly debt: Debt;
  readonly order: number;
  readonly monthsToPayoff: number | null;
  readonly totalInterest: Money;
}

export interface DebtPlan {
  readonly strategy: DebtStrategy;
  readonly steps: readonly DebtStep[];
  readonly totalMonths: number | null;
  readonly totalInterest: Money;
  /** Intérêts épargnés par rapport au paiement minimum sans réaffectation. */
  readonly interestSaved: Money;
  readonly debtFreeDate: Date | null;
}

/** Au-delà de ce ratio, le poids des remboursements devient un signal d'alerte. */
export const DEBT_TO_INCOME_ALERT = 0.33;

/**
 * Ordre de remboursement.
 *
 * - **Avalanche** : taux décroissant. Mathématiquement optimal, c'est ce qui coûte le
 *   moins cher au total.
 * - **Boule de neige** : solde croissant. Sous-optimal en euros, mais la première dette
 *   soldée arrive plus tôt — et un plan tenu bat un plan optimal abandonné.
 */
export function orderDebts(debts: readonly Debt[], strategy: DebtStrategy): Debt[] {
  const sorted = [...debts];
  if (strategy === 'avalanche') {
    sorted.sort((a, b) => b.annualRate - a.annualRate || Number(a.outstanding.micros - b.outstanding.micros));
  } else {
    sorted.sort((a, b) => Number(a.outstanding.micros - b.outstanding.micros) || b.annualRate - a.annualRate);
  }
  return sorted;
}

const MAX_SIMULATED_MONTHS = 600; // 50 ans : au-delà, le plan ne rembourse pas.

interface SimulationResult {
  months: number | null;
  interest: Money;
  perDebtMonths: Map<string, number | null>;
  perDebtInterest: Map<string, Money>;
}

/**
 * Simulation mois par mois.
 *
 * On n'utilise pas de formule fermée : la mensualité libérée par une dette soldée est
 * réaffectée à la suivante, ce qui rend le calendrier dépendant de l'ordre. Seule la
 * simulation le reflète fidèlement.
 */
function simulate(
  debts: readonly Debt[],
  strategy: DebtStrategy,
  extraMonthly: Money,
  currency: Currency,
  rollOver: boolean,
): SimulationResult {
  const ordered = orderDebts(debts, strategy);
  const balances = new Map(ordered.map((debt) => [debt.id, debt.outstanding]));
  const interests = new Map(ordered.map((debt) => [debt.id, Money.zero(currency)]));
  const payoffMonth = new Map<string, number | null>(ordered.map((debt) => [debt.id, null]));

  let totalInterest = Money.zero(currency);
  let month = 0;

  while (month < MAX_SIMULATED_MONTHS) {
    const outstanding = ordered.filter((debt) => (balances.get(debt.id) ?? Money.zero(currency)).isPositive);
    if (outstanding.length === 0) return finish(month);

    month += 1;

    // Budget du mois : les mensualités dues, plus l'effort supplémentaire, plus — si la
    // réaffectation est activée — les mensualités des dettes déjà soldées.
    const freed = rollOver
      ? Money.sum(
          ordered
            .filter((debt) => !(balances.get(debt.id) ?? Money.zero(currency)).isPositive)
            .map((debt) => debt.monthlyPayment),
          currency,
        )
      : Money.zero(currency);
    let budget = extraMonthly.plus(freed);

    let progressed = false;

    for (const debt of outstanding) {
      const balance = balances.get(debt.id)!;
      const monthlyInterest = balance.times(debt.annualRate / 12);
      const accrued = interests.get(debt.id)!.plus(monthlyInterest);
      interests.set(debt.id, accrued);
      totalInterest = totalInterest.plus(monthlyInterest);

      let payment = debt.monthlyPayment;
      // L'effort supplémentaire va en priorité à la première dette de la liste.
      if (budget.isPositive && debt.id === outstanding[0]!.id) {
        payment = payment.plus(budget);
        budget = Money.zero(currency);
      }

      const newBalance = balance.plus(monthlyInterest).minus(payment);
      if (newBalance.lessThan(balance)) progressed = true;

      if (newBalance.isPositive) {
        balances.set(debt.id, newBalance);
      } else {
        balances.set(debt.id, Money.zero(currency));
        payoffMonth.set(debt.id, month);
      }
    }

    // Aucune dette n'a reculé : la mensualité ne couvre même pas les intérêts.
    if (!progressed) return finish(null);
  }

  return finish(null);

  function finish(months: number | null): SimulationResult {
    return { months, interest: totalInterest, perDebtMonths: payoffMonth, perDebtInterest: interests };
  }
}

export function debtPayoffPlan(
  debts: readonly Debt[],
  strategy: DebtStrategy,
  extraMonthly: Money,
  currency: Currency,
  reference: Date = new Date(),
): DebtPlan {
  const active = debts.filter((debt) => debt.outstanding.isPositive);
  if (active.length === 0) {
    return {
      strategy,
      steps: [],
      totalMonths: 0,
      totalInterest: Money.zero(currency),
      interestSaved: Money.zero(currency),
      debtFreeDate: null,
    };
  }

  const optimised = simulate(active, strategy, extraMonthly, currency, true);
  const baseline = simulate(active, strategy, Money.zero(currency), currency, false);

  const ordered = orderDebts(active, strategy);
  const steps = ordered.map((debt, index) => ({
    debt,
    order: index + 1,
    monthsToPayoff: optimised.perDebtMonths.get(debt.id) ?? null,
    totalInterest: optimised.perDebtInterest.get(debt.id) ?? Money.zero(currency),
  }));

  const debtFreeDate =
    optimised.months === null
      ? null
      : new Date(reference.getFullYear(), reference.getMonth() + optimised.months, 1);

  return {
    strategy,
    steps,
    totalMonths: optimised.months,
    totalInterest: optimised.interest,
    interestSaved: baseline.interest.minus(optimised.interest).clampedToZero,
    debtFreeDate,
  };
}

export function highInterestDebts(debts: readonly Debt[]): Debt[] {
  return debts.filter(isHighInterest);
}
