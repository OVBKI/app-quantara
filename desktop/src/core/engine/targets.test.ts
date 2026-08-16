import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { DEFAULT_ALLOCATION_TARGETS, allocationTotal, type AllocationTargets } from '../model';
import { MARCH_2026, referenceDate, standardProfile } from '../testing/fixtures';
import { analyse } from './analysis';
import { allocatedTo } from './allocation';

function planWith(targets: Partial<AllocationTargets>) {
  const profile = standardProfile({
    preferences: {
      ...standardProfile().preferences,
      allocationTargets: { ...DEFAULT_ALLOCATION_TARGETS, ...targets },
    },
  });
  return analyse(profile, MARCH_2026, referenceDate(28)).allocation;
}

describe('Répartition choisie par l’utilisateur', () => {
  it('applique les parts au revenu', () => {
    // 4 000 € de revenus, 20 % à l'épargne : 800 € — pas 20 % du seul disponible, qui
    // voudrait dire tout autre chose que ce que l'utilisateur croit avoir demandé.
    const plan = planWith({ enabled: true, needs: 0.5, savings: 0.2, investment: 0.2, free: 0.1 });

    expect(allocatedTo(plan, 'emergencyFund').equals(Money.of(800))).toBe(true);
    expect(allocatedTo(plan, 'investment').equals(Money.of(800))).toBe(true);
  });

  it('revient à la cascade quand le total dépasse 100 %', () => {
    // Une répartition incohérente ne doit pas produire un plan faux en silence.
    const plan = planWith({ enabled: true, needs: 0.6, savings: 0.3, investment: 0.3, free: 0.1 });
    const cascade = planWith({ enabled: false });

    expect(plan.lines.map((line) => line.bucket)).toEqual(cascade.lines.map((line) => line.bucket));
  });

  it('revient à la cascade quand une part du revenu n’est pas attribuée', () => {
    const plan = planWith({ enabled: true, needs: 0.5, savings: 0.2, investment: 0.1, free: 0.1 });
    const cascade = planWith({ enabled: false });

    expect(plan.lines.map((line) => line.bucket)).toEqual(cascade.lines.map((line) => line.bucket));
  });

  it('n’attribue jamais plus que le disponible', () => {
    // 90 % du revenu demandés en épargne alors que les charges en consomment déjà une
    // large part : le plan se limite à ce qui existe réellement.
    const plan = planWith({ enabled: true, needs: 0.05, savings: 0.9, investment: 0.03, free: 0.02 });

    expect(plan.allocated.greaterThan(plan.disposable)).toBe(false);
  });

  it('signale des charges supérieures à la part prévue pour les besoins', () => {
    const plan = planWith({ enabled: true, needs: 0.1, savings: 0.5, investment: 0.3, free: 0.1 });

    expect(plan.skippedSteps.some((step) => step.includes('charges'))).toBe(true);
  });

  it('reste ignorée tant qu’elle n’est pas activée', () => {
    const plan = planWith({ enabled: false, needs: 0.5, savings: 0.2, investment: 0.2, free: 0.1 });

    // La cascade place le fonds d'urgence avant l'investissement : la part fixe de 20 %
    // n'apparaît donc pas telle quelle.
    expect(allocatedTo(plan, 'investment').equals(Money.of(800))).toBe(false);
  });
});

describe('Contrôle de cohérence', () => {
  it('additionne les parts', () => {
    expect(allocationTotal(DEFAULT_ALLOCATION_TARGETS)).toBeCloseTo(1, 5);
  });
});
