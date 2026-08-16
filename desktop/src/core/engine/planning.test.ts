import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { totalSavingsBalance } from '../model';
import { emptyProfile } from '../model';
import {
  debt as makeDebt,
  fixedExpense,
  goal as makeGoal,
  income,
  MARCH_2026,
  referenceDate,
  savingsAccount,
  standardProfile,
} from '../testing/fixtures';
import { monthlySummary, savingsCapacity } from './budget';
import { monthsToCover, planGoal } from './goals';
import { emergencyFundStatus } from './emergencyFund';
import { debtPayoffPlan, orderDebts } from './debt';
import { allocate, allocatedTo } from './allocation';
import { analyse } from './analysis';

const TODAY = referenceDate(28);

describe('Objectifs', () => {
  it('15 000 € en 24 mois demandent 625 € par mois', () => {
    const goal = makeGoal('Apport', 15000, { targetDate: '2028-03-01' });
    const plan = planGoal(goal, Money.of(700), TODAY);
    expect(plan.monthsUntilTarget).toBe(24);
    expect(plan.requiredMonthly?.equals(Money.of(625))).toBe(true);
    expect(plan.feasible).toBe(true);
    expect(plan.alternatives).toHaveLength(0);
  });

  it('propose trois issues chiffrées quand l’objectif est hors de portée', () => {
    const goal = makeGoal('Apport', 15000, { targetDate: '2028-03-01' });
    const plan = planGoal(goal, Money.of(450), TODAY);

    expect(plan.feasible).toBe(false);
    expect(plan.shortfall?.equals(Money.of(175))).toBe(true);
    expect(plan.alternatives).toHaveLength(3);

    const extend = plan.alternatives.find((entry) => entry.kind === 'extendDeadline');
    const reduce = plan.alternatives.find((entry) => entry.kind === 'reduceTarget');
    const effort = plan.alternatives.find((entry) => entry.kind === 'increaseEffort');

    expect(extend?.months).toBe(34); // 15 000 ÷ 450 = 33,3 → 34 mois
    expect(reduce?.target.equals(Money.of(10800))).toBe(true); // 450 × 24
    expect(effort?.additionalEffort.equals(Money.of(175))).toBe(true);
  });

  it('tient compte de ce qui est déjà épargné', () => {
    const goal = makeGoal('Apport', 20000, { current: 5000 });
    const plan = planGoal(goal, Money.of(500), TODAY);
    expect(plan.remaining.equals(Money.of(15000))).toBe(true);
    expect(plan.progress).toBeCloseTo(0.25, 6);
    expect(plan.projectedMonths).toBe(30); // 15 000 ÷ 500
  });

  it('arrondit au mois supérieur : un mois entamé ne finance pas l’objectif', () => {
    expect(monthsToCover(Money.of(1000), Money.of(300))).toBe(4);
    expect(monthsToCover(Money.of(900), Money.of(300))).toBe(3);
    expect(monthsToCover(Money.of(1000), Money.zero())).toBeNull();
  });

  it('signale un retard sur le calendrier', () => {
    // Créé en janvier pour mars 2027 : 2 mois écoulés sur 14, soit 14 % attendus.
    const goal = makeGoal('Voyage', 10000, { current: 200, createdAt: '2026-01-01', targetDate: '2027-03-01' });
    const plan = planGoal(goal, Money.of(500), TODAY);
    expect(plan.scheduleDeviation).not.toBeNull();
    expect(plan.scheduleDeviation!).toBeLessThan(0);
  });
});

describe('Fonds d’urgence', () => {
  const profile = {
    ...emptyProfile(),
    incomes: [income('Salaire', 4000)],
    recurringExpenses: [fixedExpense('Loyer', 2000, 'fixed.rent')],
  };
  const summary = monthlySummary(profile, MARCH_2026, TODAY);

  it('dimensionne les paliers sur les dépenses essentielles', () => {
    const status = emergencyFundStatus(summary, Money.zero(), 6, Money.of(500));
    expect(status.monthlyNeed.equals(Money.of(2000))).toBe(true);
    expect(status.tiers.map((tier) => tier.target.units)).toEqual([6000, 12000, 18000]);
  });

  it('mesure la couverture en mois, pas seulement en euros', () => {
    const status = emergencyFundStatus(summary, Money.of(3000), 6, Money.of(500));
    expect(status.monthsCovered).toBeCloseTo(1.5, 6);
    expect(status.tiers[0]?.reached).toBe(false);
    expect(status.remaining.equals(Money.of(9000))).toBe(true);
    expect(status.monthsToTarget).toBe(18);
  });

  it('reconnaît un fonds complet', () => {
    const status = emergencyFundStatus(summary, Money.of(12000), 6, Money.of(500));
    expect(status.remaining.isZero).toBe(true);
    expect(status.progress).toBe(1);
  });
});

describe('Dettes', () => {
  const debts = [
    makeDebt('Carte', 2000, 0.18, 100, 'creditCard'),
    makeDebt('Conso', 12000, 0.05, 300),
    makeDebt('Auto', 8000, 0.03, 250, 'carLoan'),
  ];

  it('l’avalanche attaque le taux le plus élevé', () => {
    expect(orderDebts(debts, 'avalanche').map((debt) => debt.name)).toEqual(['Carte', 'Conso', 'Auto']);
  });

  it('la boule de neige attaque le plus petit solde', () => {
    // Ordre volontairement différent de l'avalanche : sinon le test ne prouve rien.
    expect(orderDebts(debts, 'snowball').map((debt) => debt.name)).toEqual(['Carte', 'Auto', 'Conso']);
  });

  it('la réaffectation des mensualités libérées fait gagner des intérêts', () => {
    const plan = debtPayoffPlan(debts, 'avalanche', Money.zero(), 'EUR', TODAY);
    expect(plan.totalMonths).not.toBeNull();
    expect(plan.interestSaved.isPositive).toBe(true);
    expect(plan.steps[0]?.debt.name).toBe('Carte');
  });

  it('détecte une mensualité qui ne couvre pas les intérêts', () => {
    // 10 € par mois sur 10 000 € à 20 % : le solde ne baissera jamais.
    const impossible = [makeDebt('Revolving', 10000, 0.2, 10, 'creditCard')];
    const plan = debtPayoffPlan(impossible, 'avalanche', Money.zero(), 'EUR', TODAY);
    expect(plan.totalMonths).toBeNull();
  });
});

describe('Répartition du disponible', () => {
  function planFor(profile = standardProfile()) {
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(31));
    const capacity = savingsCapacity(summary, profile.preferences.minimumFreeShare);
    const savings = totalSavingsBalance(profile);
    return allocate({
      summary,
      capacity,
      emergencyFund: emergencyFundStatus(summary, savings, profile.preferences.emergencyFundMonths, capacity),
      goalPlans: [],
      highInterestOutstanding: Money.sum(
        profile.debts.filter((debt) => debt.annualRate >= 0.08).map((debt) => debt.outstanding),
        'EUR',
      ),
      riskProfile: profile.preferences.riskProfile,
    });
  }

  it('affecte l’intégralité du disponible, sans reliquat', () => {
    const plan = planFor();
    expect(plan.allocated.equals(plan.disposable)).toBe(true);
    expect(plan.unallocated.isZero).toBe(true);
  });

  it('constitue le matelas de sécurité en premier quand l’épargne est vide', () => {
    const plan = planFor(standardProfile({ accounts: [] }));
    expect(plan.lines[0]?.bucket).toBe('safetyBuffer');
  });

  it('retient l’investissement tant que le fonds d’urgence est incomplet', () => {
    const plan = planFor(standardProfile({ accounts: [savingsAccount(500)] }));
    expect(allocatedTo(plan, 'investment').isZero).toBe(true);
    expect(plan.skippedSteps.some((step) => step.includes('fonds d’urgence'))).toBe(true);
  });

  it('retient l’investissement tant qu’une dette coûteuse subsiste', () => {
    const profile = standardProfile({
      accounts: [savingsAccount(30000)], // fonds d'urgence largement couvert
      debts: [makeDebt('Réserve d’argent', 3000, 0.18, 100, 'creditCard')],
    });
    const plan = planFor(profile);
    expect(allocatedTo(plan, 'investment').isZero).toBe(true);
    expect(plan.skippedSteps.some((step) => step.includes('taux élevé'))).toBe(true);
  });

  it('investit une fois la sécurité assurée', () => {
    const plan = planFor(standardProfile({ accounts: [savingsAccount(30000)] }));
    expect(allocatedTo(plan, 'investment').isPositive).toBe(true);
    expect(plan.skippedSteps).toHaveLength(0);
  });

  it('laisse toujours une part libre', () => {
    const plan = planFor();
    expect(allocatedTo(plan, 'freeMoney').isPositive).toBe(true);
  });

  it('chaque ligne porte son explication', () => {
    const plan = planFor();
    expect(plan.lines.every((line) => line.rationale.length > 20)).toBe(true);
  });
});

describe('Analyse complète', () => {
  it('enchaîne tous les moteurs sans se contredire', () => {
    const analysis = analyse(standardProfile(), MARCH_2026, referenceDate(31));
    expect(analysis.summary.income.equals(Money.of(4000))).toBe(true);
    expect(analysis.allocation.disposable.equals(analysis.summary.disposable.clampedToZero)).toBe(true);
    expect(analysis.emergencyFund.monthlyNeed.isPositive).toBe(true);
    expect(analysis.insights.length).toBeGreaterThan(0);
  });

  it('reste calculable sur un profil vide', () => {
    const analysis = analyse(emptyProfile(), MARCH_2026, TODAY);
    expect(analysis.summary.income.isZero).toBe(true);
    expect(analysis.summary.fixedRatio).toBeNull();
    expect(analysis.allocation.lines).toHaveLength(0);
  });
});
