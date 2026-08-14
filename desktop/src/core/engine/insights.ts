import { Money, Percent } from '../money';
import { categoryLabel } from '../categories';
import { DEBT_TO_INCOME_ALERT } from './debt';
import type { MonthlySummary } from './budget';
import type { EmergencyFundStatus } from './emergencyFund';
import type { CashFlowForecast } from './cashflow';
import type { GoalPlan } from './goals';

export type InsightKind =
  | 'negativeDisposable'
  | 'projectedOverdraft'
  | 'fixedExpenseLoad'
  | 'debtLoad'
  | 'subscriptionLoad'
  | 'emergencyFundThin'
  | 'emergencyFundComplete'
  | 'categoryDrift'
  | 'savingsRateLow'
  | 'savingsRateGood'
  | 'goalBehindSchedule'
  | 'goalAhead'
  | 'surplus'
  | 'volatileIncome'
  | 'envelopeExceeded'
  | 'envelopeAtRisk'
  | 'noEnvelopes';

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface Insight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly message: string;
  readonly amount?: Money;
}

/**
 * Seuils explicites.
 *
 * Ils sont réunis ici plutôt que dispersés dans le code : ce sont des choix de produit,
 * discutables et ajustables, pas des constantes techniques.
 */
export const THRESHOLDS = {
  /** Au-delà, les charges fixes laissent trop peu de marge de manœuvre. */
  fixedExpenseRatio: 0.5,
  /** 2 % du revenu : à 4 000 € nets, 80 €/mois d'abonnements. */
  subscriptionRatio: 0.02,
  /** En deçà, l'épargne ne construit rien de significatif. */
  lowSavingsRate: 0.05,
  goodSavingsRate: 0.15,
  /** Dérive d'une catégorie par rapport à son budget. */
  categoryOverrun: 1.0,
  /** Surplus inutilisé qui mérite d'être orienté. */
  surplusRatio: 0.15,
  goalDeviation: 0.05,
} as const;

/**
 * Analyse proactive.
 *
 * Chaque constat est produit par une règle déterministe et cite le chiffre qui l'a
 * déclenché : l'utilisateur peut vérifier, et donc faire confiance.
 */
export function buildInsights(input: {
  summary: MonthlySummary;
  smoothingBuffer?: Money;
  emergencyFund: EmergencyFundStatus;
  cashFlow: CashFlowForecast;
  goalPlans: readonly GoalPlan[];
  categoryBudgets: readonly { category: import('../categories').ExpenseCategoryId; limit: Money }[];
}): Insight[] {
  const { summary, emergencyFund, cashFlow, goalPlans, categoryBudgets, smoothingBuffer } = input;
  const insights: Insight[] = [];

  // --- Irrégularité du revenu ---
  const detail = summary.incomeDetail;
  if (detail.hasVariableSource && detail.volatility !== null && detail.volatility > 0.3) {
    insights.push({
      id: 'volatileIncome',
      kind: 'volatileIncome',
      severity: 'info',
      title: `Revenu irrégulier : de ${detail.low.roundedToUnit.format()} à ${detail.high.roundedToUnit.format()}`,
      message:
        `Soit un écart de ${Percent.format(detail.volatility, 'fr-FR', 0)} autour de votre mois typique ` +
        `(${detail.typical.roundedToUnit.format()}). Le plan se cale sur le mois faible : les bons mois ` +
        'dégagent alors un surplus, au lieu que les mauvais creusent un trou.' +
        (smoothingBuffer && smoothingBuffer.isPositive
          ? ` Un compte tampon d’environ ${smoothingBuffer.roundedToUnit.format()} absorberait trois mois creux.`
          : ''),
      amount: detail.high.minus(detail.low),
    });
  }

  // --- Enveloppes ---
  for (const envelope of summary.envelopes.envelopes) {
    if (envelope.state === 'exceeded') {
      insights.push({
        id: `envelopeExceeded.${envelope.category}`,
        kind: 'envelopeExceeded',
        severity: 'warning',
        title: `${envelope.label} : enveloppe dépassée de ${envelope.remaining.absolute.roundedToUnit.format()}`,
        message:
          `${envelope.spent.roundedToUnit.format()} dépensés pour ${envelope.planned.roundedToUnit.format()} prévus. ` +
          'Le dépassement est repris dans le disponible : mieux vaut le voir maintenant qu’en fin de mois.',
        amount: envelope.remaining.absolute,
      });
    } else if (envelope.state === 'atRisk') {
      insights.push({
        id: `envelopeAtRisk.${envelope.category}`,
        kind: 'envelopeAtRisk',
        severity: 'info',
        title: `${envelope.label} : rythme trop rapide`,
        message:
          `${Math.round(envelope.consumed * 100)} % de l’enveloppe consommés alors que ` +
          `${Math.round(envelope.monthProgress * 100)} % du mois se sont écoulés. ` +
          `Il reste ${envelope.perRemainingDay.roundedToUnit.format()} par jour pour tenir.`,
        amount: envelope.remaining,
      });
    }
  }

  if (summary.envelopes.envelopes.length === 0 && summary.variableSpentToDate.isPositive) {
    insights.push({
      id: 'noEnvelopes',
      kind: 'noEnvelopes',
      severity: 'info',
      title: 'Aucun budget par catégorie',
      message:
        `${summary.variableSpentToDate.roundedToUnit.format()} de dépenses variables ce mois-ci, sans montant ` +
        'décidé à l’avance. Constater ses dépenses n’est pas les piloter : fixez une enveloppe par poste, ' +
        'même approximative, et l’application vous dira si vous tenez le rythme.',
      amount: summary.variableSpentToDate,
    });
  }

  if (summary.disposable.isNegative) {
    insights.push({
      id: 'negativeDisposable',
      kind: 'negativeDisposable',
      severity: 'critical',
      title: `Budget déficitaire de ${summary.disposable.absolute.roundedToUnit.format()}`,
      message:
        `Vos charges (${summary.totalExpenses.roundedToUnit.format()}) dépassent vos revenus ` +
        `(${summary.income.roundedToUnit.format()}). Sans correction, le déficit se creuse chaque mois.`,
      amount: summary.disposable.absolute,
    });
  }

  if (cashFlow.projectedOverdraft && cashFlow.lowestBalanceDate) {
    insights.push({
      id: 'projectedOverdraft',
      kind: 'projectedOverdraft',
      severity: 'critical',
      title: 'Découvert prévu ce mois-ci',
      message:
        `Le solde descendrait à ${cashFlow.lowestBalance.roundedToUnit.format()} le ` +
        `${cashFlow.lowestBalanceDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, ` +
        'avant la prochaine entrée d’argent.',
      amount: cashFlow.lowestBalance,
    });
  }

  if (summary.fixedRatio !== null && summary.fixedRatio > THRESHOLDS.fixedExpenseRatio) {
    insights.push({
      id: 'fixedExpenseLoad',
      kind: 'fixedExpenseLoad',
      severity: 'warning',
      title: `Charges fixes à ${Percent.format(summary.fixedRatio, 'fr-FR', 0)} du revenu`,
      message:
        `${summary.fixedExpenses.roundedToUnit.format()} par mois sont engagés avant toute décision. ` +
        'Au-delà de la moitié du revenu, la marge de manœuvre devient très faible.',
      amount: summary.fixedExpenses,
    });
  }

  const debtRatio = summary.debtPayments.ratioTo(summary.income);
  if (debtRatio !== null && debtRatio > DEBT_TO_INCOME_ALERT) {
    insights.push({
      id: 'debtLoad',
      kind: 'debtLoad',
      severity: 'critical',
      title: `Remboursements à ${Percent.format(debtRatio, 'fr-FR', 0)} du revenu`,
      message:
        `${summary.debtPayments.roundedToUnit.format()} partent chaque mois en remboursements. ` +
        'Au-delà d’un tiers du revenu, le budget devient très vulnérable au moindre imprévu.',
      amount: summary.debtPayments,
    });
  }

  const subscriptionShare = summary.subscriptions.ratioTo(summary.income);
  if (subscriptionShare !== null && subscriptionShare > THRESHOLDS.subscriptionRatio) {
    insights.push({
      id: 'subscriptionLoad',
      kind: 'subscriptionLoad',
      severity: 'info',
      title: `${summary.subscriptions.roundedToUnit.format()} d’abonnements par mois`,
      message:
        `Soit ${summary.subscriptions.times(12n).roundedToUnit.format()} par an, ` +
        `${Percent.format(subscriptionShare, 'fr-FR', 0)} de vos revenus. Un passage en revue vaut souvent quelques dizaines d’euros.`,
      amount: summary.subscriptions,
    });
  }

  if (emergencyFund.monthsCovered < 1 && emergencyFund.monthlyNeed.isPositive) {
    insights.push({
      id: 'emergencyFundThin',
      kind: 'emergencyFundThin',
      severity: 'warning',
      title: 'Fonds d’urgence à constituer',
      message:
        `Votre épargne couvre ${emergencyFund.monthsCovered.toFixed(1)} mois de dépenses essentielles ` +
        `(${emergencyFund.monthlyNeed.roundedToUnit.format()} par mois). Le premier objectif est d’en couvrir un.`,
      amount: emergencyFund.remaining,
    });
  } else if (emergencyFund.remaining.isZero && emergencyFund.target.isPositive) {
    insights.push({
      id: 'emergencyFundComplete',
      kind: 'emergencyFundComplete',
      severity: 'positive',
      title: 'Fonds d’urgence complet',
      message:
        `${emergencyFund.current.roundedToUnit.format()} de côté, soit ${emergencyFund.monthsCovered.toFixed(1)} mois ` +
        'de dépenses essentielles. Le surplus peut désormais servir vos objectifs de long terme.',
      amount: emergencyFund.current,
    });
  }

  for (const budget of categoryBudgets) {
    const spent = summary.categoryTotals.find((total) => total.category === budget.category);
    if (!spent || !budget.limit.isPositive) continue;
    const ratio = spent.amount.ratioTo(budget.limit);
    if (ratio !== null && ratio > THRESHOLDS.categoryOverrun) {
      insights.push({
        id: `categoryDrift.${budget.category}`,
        kind: 'categoryDrift',
        severity: 'warning',
        title: `${categoryLabel(budget.category)} : budget dépassé`,
        message:
          `${spent.amount.roundedToUnit.format()} dépensés pour un budget de ` +
          `${budget.limit.roundedToUnit.format()}, soit ${spent.amount.minus(budget.limit).roundedToUnit.format()} de plus.`,
        amount: spent.amount.minus(budget.limit),
      });
    }
  }

  if (summary.savingsRate !== null) {
    if (summary.savingsRate < THRESHOLDS.lowSavingsRate && summary.disposable.isPositive) {
      insights.push({
        id: 'savingsRateLow',
        kind: 'savingsRateLow',
        severity: 'info',
        title: `Taux d’épargne à ${Percent.format(summary.savingsRate, 'fr-FR', 0)}`,
        message:
          `${summary.disposable.roundedToUnit.format()} restent disponibles ce mois-ci. ` +
          'Un virement automatique le jour du salaire épargne sans y penser.',
        amount: summary.disposable,
      });
    } else if (summary.savingsRate >= THRESHOLDS.goodSavingsRate) {
      insights.push({
        id: 'savingsRateGood',
        kind: 'savingsRateGood',
        severity: 'positive',
        title: `Taux d’épargne à ${Percent.format(summary.savingsRate, 'fr-FR', 0)}`,
        message: `${summary.savingsContributions.roundedToUnit.format()} mis de côté ce mois-ci. Le rythme est bon.`,
        amount: summary.savingsContributions,
      });
    }
  }

  for (const plan of goalPlans) {
    if (plan.scheduleDeviation === null) continue;
    if (plan.scheduleDeviation < -THRESHOLDS.goalDeviation) {
      insights.push({
        id: `goalBehind.${plan.goal.id}`,
        kind: 'goalBehindSchedule',
        severity: 'warning',
        title: `${plan.goal.name} : en retard sur le calendrier`,
        message:
          `Progression de ${Percent.format(plan.progress, 'fr-FR', 0)} là où ` +
          `${Percent.format(plan.progress - plan.scheduleDeviation, 'fr-FR', 0)} étaient attendus à ce stade.` +
          (plan.requiredMonthly ? ` Il faudrait ${plan.requiredMonthly.roundedToUnit.format()} par mois.` : ''),
        amount: plan.remaining,
      });
    } else if (plan.scheduleDeviation > THRESHOLDS.goalDeviation) {
      insights.push({
        id: `goalAhead.${plan.goal.id}`,
        kind: 'goalAhead',
        severity: 'positive',
        title: `${plan.goal.name} : en avance`,
        message: `Progression de ${Percent.format(plan.progress, 'fr-FR', 0)}, au-dessus du rythme prévu.`,
        amount: plan.remaining,
      });
    }
  }

  const surplusShare = summary.disposable.ratioTo(summary.income);
  if (
    surplusShare !== null &&
    surplusShare > THRESHOLDS.surplusRatio &&
    summary.savingsContributions.lessThan(summary.disposable.times(0.5))
  ) {
    insights.push({
      id: 'surplus',
      kind: 'surplus',
      severity: 'info',
      title: `${summary.disposable.roundedToUnit.format()} non affectés`,
      message:
        `Soit ${Percent.format(surplusShare, 'fr-FR', 0)} de vos revenus qui restent sans destination. ` +
        'Un montant non affecté se dépense sans décision.',
      amount: summary.disposable,
    });
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
