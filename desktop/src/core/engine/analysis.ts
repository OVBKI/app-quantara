import { Money } from '../money';
import { activeDebts, activeGoals, totalSavingsBalance, type FinancialProfile } from '../model';
import { yearMonthOf, type YearMonth } from '../yearMonth';
import { monthlySummary, savingsCapacity, type MonthlySummary } from './budget';
import { emergencyFundStatus, type EmergencyFundStatus } from './emergencyFund';
import { planGoal, type GoalPlan } from './goals';
import { debtPayoffPlan, highInterestDebts, type DebtPlan } from './debt';
import { allocate, type AllocationPlan } from './allocation';
import { forecastCashFlow, openingBalanceOf, type CashFlowForecast } from './cashflow';
import { buildInsights, type Insight } from './insights';

export interface FinancialAnalysis {
  readonly profile: FinancialProfile;
  readonly period: YearMonth;
  readonly reference: Date;
  readonly summary: MonthlySummary;
  readonly capacity: Money;
  readonly emergencyFund: EmergencyFundStatus;
  readonly goalPlans: readonly GoalPlan[];
  readonly debtPlan: DebtPlan;
  readonly allocation: AllocationPlan;
  readonly cashFlow: CashFlowForecast;
  readonly insights: readonly Insight[];
}

/**
 * Point d'entrée unique du moteur.
 *
 * Les moteurs sont enchaînés dans l'ordre de leurs dépendances : le résumé mensuel
 * alimente la capacité d'épargne, qui alimente le fonds d'urgence et les objectifs, qui
 * alimentent la répartition. Un seul appel produit tout ce que l'interface affiche —
 * elle ne calcule jamais rien elle-même.
 */
export function analyse(
  profile: FinancialProfile,
  period: YearMonth = yearMonthOf(new Date()),
  reference: Date = new Date(),
): FinancialAnalysis {
  const summary = monthlySummary(profile, period, reference);
  const capacity = savingsCapacity(summary, profile.preferences.minimumFreeShare);

  const savings = totalSavingsBalance(profile);
  const emergencyFund = emergencyFundStatus(
    summary,
    savings,
    profile.preferences.emergencyFundMonths,
    capacity,
  );

  const goalPlans = activeGoals(profile).map((goal) => planGoal(goal, capacity, reference));

  const debts = activeDebts(profile);
  const debtPlan = debtPayoffPlan(debts, 'avalanche', Money.zero(profile.currency), profile.currency, reference);
  const highInterestOutstanding = Money.sum(
    highInterestDebts(debts).map((debt) => debt.outstanding),
    profile.currency,
  );

  const allocation = allocate({
    summary,
    capacity,
    emergencyFund,
    goalPlans,
    highInterestOutstanding,
    riskProfile: profile.preferences.riskProfile,
  });

  const cashFlow = forecastCashFlow(profile, summary, period, openingBalanceOf(profile), reference);

  const insights = buildInsights({
    summary,
    emergencyFund,
    cashFlow,
    goalPlans,
    categoryBudgets: profile.categoryBudgets,
  });

  return {
    profile,
    period,
    reference,
    summary,
    capacity,
    emergencyFund,
    goalPlans,
    debtPlan,
    allocation,
    cashFlow,
    insights,
  };
}
