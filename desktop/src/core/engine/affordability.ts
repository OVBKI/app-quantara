import { Money } from '../money';
import { monthsToCover } from './goals';
import type { MonthlySummary } from './budget';
import type { EmergencyFundStatus } from './emergencyFund';
import type { CashFlowForecast } from './cashflow';

export type Verdict = 'yes' | 'yesButTight' | 'notNow' | 'no';

export interface AffordabilityAnswer {
  readonly amount: Money;
  readonly verdict: Verdict;
  readonly headline: string;
  readonly reasons: readonly string[];
  /** Ce qui reste disponible après l'achat, ce mois-ci. */
  readonly remainingAfter: Money;
  /** Nombre de mois d'épargne nécessaires pour l'acheter sans toucher au disponible. */
  readonly monthsToSaveFor: number | null;
  readonly wouldCauseOverdraft: boolean;
  readonly wouldBreakEmergencyFund: boolean;
}

/**
 * « Puis-je me le permettre ? »
 *
 * La question que les applications de budget laissent sans réponse. Un solde positif ne
 * suffit pas à répondre : il faut regarder ce qui est déjà engagé d'ici la fin du mois,
 * le point bas de trésorerie, et ce que l'achat ferait au fonds d'urgence.
 */
export function canIAfford(
  amount: Money,
  summary: MonthlySummary,
  emergencyFund: EmergencyFundStatus,
  cashFlow: CashFlowForecast,
  capacity: Money,
): AffordabilityAnswer {
  const reasons: string[] = [];

  // Ce qui reste vraiment disponible d'ici la fin du mois.
  const available = summary.income
    .minus(summary.fixedExpenses)
    .minus(summary.debtPayments)
    .minus(summary.variableProjected)
    .minus(summary.savingsContributions)
    .clampedToZero;

  const remainingAfter = available.minus(amount);
  const lowestAfter = cashFlow.lowestBalance.minus(amount);
  const wouldCauseOverdraft = lowestAfter.isNegative;
  const wouldBreakEmergencyFund = amount.greaterThan(available) && emergencyFund.monthsCovered < 3;

  const monthsToSaveFor = capacity.isPositive ? monthsToCover(amount, capacity) : null;

  let verdict: Verdict;
  let headline: string;

  if (amount.lessThanOrEqual(available) && !wouldCauseOverdraft) {
    const share = amount.ratioTo(available);
    if (share !== null && share > 0.6) {
      verdict = 'yesButTight';
      headline = 'Oui, mais il ne restera pas grand-chose';
      reasons.push(
        `Cet achat représente ${Math.round(share * 100)} % de ce qu’il vous reste pour le mois. ` +
          `Après, il resterait ${remainingAfter.roundedToUnit.format()} jusqu’à la fin du mois.`,
      );
    } else {
      verdict = 'yes';
      headline = 'Oui, sans conséquence sur votre mois';
      reasons.push(
        `Il vous reste ${available.roundedToUnit.format()} disponibles ce mois-ci ; ` +
          `après cet achat, ${remainingAfter.roundedToUnit.format()}.`,
      );
    }
  } else if (wouldCauseOverdraft) {
    verdict = 'no';
    headline = 'Non — cet achat vous mettrait à découvert';
    reasons.push(
      `Votre solde doit descendre à ${cashFlow.lowestBalance.roundedToUnit.format()} ce mois-ci avant la ` +
        `prochaine entrée d’argent. Après cet achat, il passerait à ${lowestAfter.roundedToUnit.format()}.`,
    );
  } else {
    verdict = 'notNow';
    headline = 'Pas ce mois-ci';
    reasons.push(
      `Il vous reste ${available.roundedToUnit.format()} disponibles, soit ` +
        `${amount.minus(available).roundedToUnit.format()} de moins que le prix.`,
    );
  }

  if (wouldBreakEmergencyFund) {
    reasons.push(
      `Financer cet achat entamerait votre épargne, qui ne couvre que ${emergencyFund.monthsCovered.toFixed(1)} ` +
        'mois de dépenses essentielles. C’est précisément la réserve qui évite le crédit en cas de coup dur.',
    );
  }

  if (monthsToSaveFor !== null && verdict !== 'yes') {
    reasons.push(
      `À votre capacité d’épargne actuelle (${capacity.roundedToUnit.format()} par mois), ` +
        `${monthsToSaveFor} mois suffiraient à le financer sans toucher à votre budget courant.`,
    );
  }

  return {
    amount,
    verdict,
    headline,
    reasons,
    remainingAfter,
    monthsToSaveFor,
    wouldCauseOverdraft,
    wouldBreakEmergencyFund,
  };
}

export const VERDICT_TONE: Record<Verdict, 'positive' | 'warning' | 'critical'> = {
  yes: 'positive',
  yesButTight: 'warning',
  notNow: 'warning',
  no: 'critical',
};
