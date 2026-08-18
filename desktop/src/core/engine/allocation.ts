import { Money } from '../money';
import { ALLOCATION_PART_LABELS, allocationTotal, type AllocationTargets, type RiskProfile } from '../model';
import type { MonthlySummary } from './budget';
import type { EmergencyFundStatus } from './emergencyFund';
import type { GoalPlan } from './goals';

export type AllocationBucket =
  | 'safetyBuffer'
  | 'highInterestDebt'
  | 'emergencyFund'
  | 'goals'
  | 'investment'
  | 'freeMoney';

export interface AllocationLine {
  readonly bucket: AllocationBucket;
  readonly label: string;
  readonly amount: Money;
  /** Pourquoi ce montant, et pas un autre. Affiché tel quel : une répartition qu'on ne
   *  peut pas expliquer n'est pas suivie. */
  readonly rationale: string;
  readonly goalId?: string;
}

export interface AllocationPlan {
  readonly disposable: Money;
  readonly lines: readonly AllocationLine[];
  readonly allocated: Money;
  readonly unallocated: Money;
  readonly skippedSteps: readonly string[];
}

export const BUCKET_LABELS: Record<AllocationBucket, string> = {
  safetyBuffer: 'Matelas de sécurité',
  highInterestDebt: 'Dettes coûteuses',
  emergencyFund: 'Fonds d’urgence',
  goals: 'Objectifs',
  investment: 'Investissement',
  freeMoney: 'Libre',
};

/** Part du disponible orientée vers l'investissement, une fois la sécurité assurée. */
const INVESTMENT_SHARE: Record<RiskProfile, number> = {
  cautious: 0.2,
  balanced: 0.35,
  dynamic: 0.5,
};

/**
 * Partage automatique de ce qui reste.
 *
 * Les charges sont paramétrées par l'utilisateur ; ce qui subsiste se découpe en quatre
 * parts fixées une fois pour toutes. Rien à refaire chaque mois : le partage se rejoue
 * sur le disponible réel, qui varie avec le revenu et les dépenses.
 *
 * Les parts portent sur le **reste**, pas sur le revenu brut. C'est la différence qui
 * compte : « 25 % à l'épargne » sur un revenu déjà engagé à 80 % promettrait une somme
 * qui n'existe pas.
 *
 * Les arrondis sont absorbés par la dernière part servie plutôt que répartis : quatre
 * arrondis indépendants ne retombent pas sur le total, et un centime manquant dans un
 * budget se remarque.
 */
function allocateByTargets(input: AllocationInput, targets: AllocationTargets): AllocationPlan {
  const { summary, emergencyFund, highInterestOutstanding } = input;
  const currency = summary.currency;
  const disposable = summary.disposable.clampedToZero;

  const parts = [
    {
      key: 'security' as const,
      bucket: 'emergencyFund' as const,
      label: ALLOCATION_PART_LABELS.security,
      share: targets.security,
      rationale: emergencyFund.remaining.isPositive
        ? `Il manque ${emergencyFund.remaining.roundedToUnit.format()} pour atteindre votre fonds d’urgence.`
        : 'Votre fonds d’urgence est constitué ; cette part continue de l’étoffer.',
    },
    {
      key: 'savings' as const,
      bucket: 'goals' as const,
      label: ALLOCATION_PART_LABELS.savings,
      share: targets.savings,
      rationale: 'Pour vos objectifs.',
    },
    {
      key: 'investment' as const,
      bucket: 'investment' as const,
      label: ALLOCATION_PART_LABELS.investment,
      share: targets.investment,
      rationale: 'Placement long terme. Un placement peut perdre de la valeur.',
    },
    {
      key: 'free' as const,
      bucket: 'freeMoney' as const,
      label: ALLOCATION_PART_LABELS.free,
      share: targets.free,
      rationale: 'Sans affectation : de quoi vivre le mois sans puiser ailleurs.',
    },
  ];

  const lines: AllocationLine[] = [];
  const skipped: string[] = [];
  let distributed = Money.zero(currency);

  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    const amount = last
      ? disposable.minus(distributed).clampedToZero
      : disposable.timesFraction(BigInt(Math.round(part.share * 10_000)), 10_000n);
    distributed = distributed.plus(amount);
    if (!amount.isPositive) return;

    lines.push({
      bucket: part.bucket,
      label: part.label,
      amount,
      rationale: `${Math.round(part.share * 100)}\u202f% de ce qui reste. ${part.rationale}`,
    });
  });

  if (!disposable.isPositive) {
    skipped.push(
      'Rien à partager ce mois-ci : vos charges absorbent la totalité du revenu. Les parts s’appliqueront dès qu’un reste apparaîtra.',
    );
  }

  // Une dette coûteuse ne suspend pas le partage — c'est votre choix — mais elle est
  // signalée : à ce taux, rembourser rapporte davantage, et sans risque.
  if (highInterestOutstanding.isPositive) {
    skipped.push(
      `Vous portez ${highInterestOutstanding.roundedToUnit.format()} de dettes au-delà de 8\u202f% l’an. ` +
        'Chaque euro remboursé rapporte le taux du crédit, ce qu’aucun placement ne garantit.',
    );
  }

  const allocated = Money.sum(lines.map((line) => line.amount), currency);
  return { disposable, lines, allocated, unallocated: disposable.minus(allocated).clampedToZero, skippedSteps: skipped };
}

export interface AllocationInput {
  readonly summary: MonthlySummary;
  readonly capacity: Money;
  readonly emergencyFund: EmergencyFundStatus;
  readonly goalPlans: readonly GoalPlan[];
  readonly highInterestOutstanding: Money;
  readonly riskProfile: RiskProfile;
  /** Parts choisies par l'utilisateur. Absentes ou incohérentes : la cascade s'applique. */
  readonly targets?: AllocationTargets;
}

/**
 * Répartition du disponible.
 *
 * Une cascade ordonnée par **risque décroissant**, pas par rendement : on sécurise
 * d'abord (de quoi encaisser un imprévu), on éteint ensuite ce qui coûte cher, puis on
 * construit, et seulement à la fin on investit. C'est l'inverse d'une règle fixe du type
 * 50/30/20, qui ignore la situation réelle du foyer.
 */
export function allocate(input: AllocationInput): AllocationPlan {
  if (input.targets?.enabled && Math.abs(allocationTotal(input.targets) - 1) < 0.005) {
    return allocateByTargets(input, input.targets);
  }

  const { summary, capacity, emergencyFund, goalPlans, highInterestOutstanding, riskProfile } = input;
  const currency = summary.currency;
  const disposable = summary.disposable.clampedToZero;

  const lines: AllocationLine[] = [];
  const skipped: string[] = [];
  let remaining = Money.min(capacity, disposable).clampedToZero;

  const take = (requested: Money): Money => {
    const amount = Money.min(requested, remaining).clampedToZero;
    remaining = remaining.minus(amount);
    return amount;
  };

  // 1. Matelas de sécurité — un mois de dépenses essentielles avant toute autre chose.
  if (emergencyFund.monthsCovered < 1 && emergencyFund.monthlyNeed.isPositive) {
    const missing = emergencyFund.monthlyNeed.minus(emergencyFund.current).clampedToZero;
    const amount = take(Money.min(missing, remaining.times(0.6)));
    if (amount.isPositive) {
      lines.push({
        bucket: 'safetyBuffer',
        label: BUCKET_LABELS.safetyBuffer,
        amount,
        rationale:
          `Votre épargne couvre ${emergencyFund.monthsCovered.toFixed(1)} mois de dépenses essentielles. ` +
          'Le premier mois se constitue en priorité : sans lui, le moindre imprévu passe par le découvert ou le crédit.',
      });
    }
  }

  // 2. Dettes coûteuses — au-delà de 8 %, rembourser rapporte plus qu'un placement, et
  //    sans aucun risque.
  if (highInterestOutstanding.isPositive) {
    const amount = take(remaining.times(0.5));
    if (amount.isPositive) {
      lines.push({
        bucket: 'highInterestDebt',
        label: BUCKET_LABELS.highInterestDebt,
        amount,
        rationale:
          `Il reste ${highInterestOutstanding.roundedToUnit.format()} de dettes à taux élevé. ` +
          'Chaque euro remboursé rapporte le taux du crédit, sans risque — aucun placement ne garantit cela.',
      });
    }
  }

  // 3. Fonds d'urgence — jusqu'à la cible choisie.
  if (emergencyFund.remaining.isPositive) {
    const amount = take(Money.min(emergencyFund.remaining, remaining.times(0.6)));
    if (amount.isPositive) {
      lines.push({
        bucket: 'emergencyFund',
        label: BUCKET_LABELS.emergencyFund,
        amount,
        rationale:
          `Cible : ${emergencyFund.target.roundedToUnit.format()}, atteinte à ${Math.round(emergencyFund.progress * 100)} %. ` +
          `Il manque ${emergencyFund.remaining.roundedToUnit.format()}.`,
      });
    }
  }

  // 4. Objectifs — par priorité, à hauteur de ce que chacun demande.
  for (const plan of goalPlans) {
    if (!remaining.isPositive) break;
    if (plan.remaining.isZero) continue;
    const requested = plan.plannedMonthly ?? plan.requiredMonthly ?? remaining.times(0.5);
    const amount = take(requested);
    if (!amount.isPositive) continue;
    lines.push({
      bucket: 'goals',
      label: plan.goal.name,
      amount,
      goalId: plan.goal.id,
      rationale:
        plan.requiredMonthly !== null
          ? `${plan.requiredMonthly.roundedToUnit.format()} par mois sont nécessaires pour tenir l'échéance.`
          : `À ce rythme, l'objectif est atteint en ${plan.projectedMonths ?? '—'} mois.`,
    });
  }

  // 5. Investissement — seulement une fois la sécurité assurée et les dettes coûteuses
  //    éteintes. L'ordre n'est pas négociable : investir en portant un crédit à 18 %
  //    revient à parier sur un rendement qu'aucun placement ne garantit.
  const emergencyReady = emergencyFund.remaining.isZero;
  const debtFree = !highInterestOutstanding.isPositive;
  if (remaining.isPositive) {
    if (!emergencyReady) {
      skipped.push(
        'Investissement en attente : le fonds d’urgence n’est pas complet. Un placement se liquide mal, et souvent à perte, quand on en a un besoin urgent.',
      );
    } else if (!debtFree) {
      skipped.push(
        'Investissement en attente : des dettes à taux élevé restent à rembourser. Leur taux dépasse le rendement attendu d’un placement.',
      );
    } else {
      const amount = take(remaining.times(INVESTMENT_SHARE[riskProfile]));
      if (amount.isPositive) {
        lines.push({
          bucket: 'investment',
          label: BUCKET_LABELS.investment,
          amount,
          rationale:
            'Fonds d’urgence complet et aucune dette coûteuse : une part du surplus peut être placée à long terme. ' +
            'Un placement peut perdre de la valeur — aucun rendement n’est garanti.',
        });
      }
    }
  }

  // 6. Le reste demeure libre. Ce n'est pas un résidu : c'est ce qui rend le plan tenable.
  const free = disposable.minus(Money.sum(lines.map((line) => line.amount), currency)).clampedToZero;
  if (free.isPositive) {
    lines.push({
      bucket: 'freeMoney',
      label: BUCKET_LABELS.freeMoney,
      amount: free,
      rationale:
        'Part volontairement laissée libre. Un plan qui affecte tout se rompt au premier imprévu et cesse d’être suivi.',
    });
  }

  const allocated = Money.sum(lines.map((line) => line.amount), currency);

  return {
    disposable,
    lines,
    allocated,
    unallocated: disposable.minus(allocated).clampedToZero,
    skippedSteps: skipped,
  };
}

export function allocatedTo(plan: AllocationPlan, bucket: AllocationBucket): Money {
  const lines = plan.lines.filter((line) => line.bucket === bucket);
  if (lines.length === 0) return plan.disposable.minus(plan.disposable); // zéro dans la bonne devise
  return Money.sum(lines.map((line) => line.amount), lines[0]!.amount.currency);
}
