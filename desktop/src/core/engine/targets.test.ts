import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import {
  ALLOCATION_PARTS,
  DEFAULT_ALLOCATION_TARGETS,
  allocationTotal,
  rebalanceAllocation,
  type AllocationTargets,
} from '../model';
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

describe('Partage automatique de ce qui reste', () => {
  it('applique les parts au reste, pas au revenu brut', () => {
    // 20 % de l'épargne portent sur le disponible : promettre 20 % d'un revenu déjà
    // engagé aux trois quarts annoncerait une somme qui n'existe pas.
    const plan = planWith({ enabled: true, security: 0.4, savings: 0.2, investment: 0.2, free: 0.2 });

    expect(allocatedTo(plan, 'goals').equals(plan.disposable.timesFraction(20n, 100n))).toBe(true);
    expect(allocatedTo(plan, 'investment').equals(plan.disposable.timesFraction(20n, 100n))).toBe(true);
    expect(plan.disposable.lessThan(planWith({ enabled: false }).disposable.plus(Money.of(1)))).toBe(true);
  });

  it('partage la totalité du reste, au centime près', () => {
    // Des parts qui ne retombent pas rondes : l'arrondi est absorbé par la dernière
    // servie, jamais laissé de côté. Un centime manquant dans un budget se remarque.
    const plan = planWith({ enabled: true, security: 0.33, savings: 0.33, investment: 0.17, free: 0.17 });

    expect(plan.allocated.equals(plan.disposable)).toBe(true);
    expect(plan.unallocated.isZero).toBe(true);
  });

  it('n’attribue jamais plus que le disponible', () => {
    const plan = planWith({ enabled: true, security: 0.05, savings: 0.9, investment: 0.03, free: 0.02 });

    expect(plan.allocated.greaterThan(plan.disposable)).toBe(false);
  });

  it('nomme les quatre parts', () => {
    const plan = planWith({ enabled: true });

    expect(plan.lines.map((line) => line.label)).toEqual([
      'Argent de sécurité',
      'Épargne',
      'Investir',
      'Argent libre',
    ]);
  });

  it('revient à la cascade quand le total dépasse 100 %', () => {
    // Une répartition incohérente ne doit pas produire un plan faux en silence.
    const plan = planWith({ enabled: true, security: 0.6, savings: 0.3, investment: 0.3, free: 0.1 });
    const cascade = planWith({ enabled: false });

    expect(plan.lines.map((line) => line.bucket)).toEqual(cascade.lines.map((line) => line.bucket));
  });

  it('revient à la cascade quand une part du reste n’est pas attribuée', () => {
    const plan = planWith({ enabled: true, security: 0.5, savings: 0.2, investment: 0.1, free: 0.1 });
    const cascade = planWith({ enabled: false });

    expect(plan.lines.map((line) => line.bucket)).toEqual(cascade.lines.map((line) => line.bucket));
  });

  it('reste ignoré tant qu’il n’est pas activé', () => {
    const plan = planWith({ enabled: false, security: 0.25, savings: 0.25, investment: 0.25, free: 0.25 });

    // La cascade sécurise avant d'investir : la part fixe n'apparaît donc pas telle quelle.
    expect(allocatedTo(plan, 'investment').equals(plan.disposable.timesFraction(25n, 100n))).toBe(false);
  });
});

describe('Réglage des parts', () => {
  it('additionne les valeurs conseillées à 100 %', () => {
    expect(allocationTotal(DEFAULT_ALLOCATION_TARGETS)).toBeCloseTo(1, 5);
  });

  it('réajuste les autres parts pour conserver le total', () => {
    const moved = rebalanceAllocation(DEFAULT_ALLOCATION_TARGETS, 'investment', 0.5);

    expect(moved.investment).toBeCloseTo(0.5, 5);
    expect(allocationTotal(moved)).toBeCloseTo(1, 5);
  });

  it('conserve le total quel que soit le curseur déplacé', () => {
    for (const part of ALLOCATION_PARTS) {
      for (const share of [0, 0.05, 0.35, 0.7, 1]) {
        const moved = rebalanceAllocation(DEFAULT_ALLOCATION_TARGETS, part, share);
        expect(allocationTotal(moved)).toBeCloseTo(1, 5);
        expect(moved[part]).toBeCloseTo(share, 5);
      }
    }
  });

  it('repart d’un partage égal quand tout est concentré sur une part', () => {
    // Toutes les autres à zéro : il n'y a plus de proportion à respecter, et le reste
    // doit malgré tout être attribué plutôt que de disparaître.
    const concentrated = rebalanceAllocation(DEFAULT_ALLOCATION_TARGETS, 'free', 1);
    const relaxed = rebalanceAllocation(concentrated, 'free', 0.4);

    expect(allocationTotal(relaxed)).toBeCloseTo(1, 5);
    expect(relaxed.security).toBeGreaterThan(0);
    expect(relaxed.savings).toBeGreaterThan(0);
    expect(relaxed.investment).toBeGreaterThan(0);
  });

  it('ne produit jamais de part négative', () => {
    const moved = rebalanceAllocation(DEFAULT_ALLOCATION_TARGETS, 'security', 1);

    for (const part of ALLOCATION_PARTS) {
      expect(moved[part]).toBeGreaterThanOrEqual(0);
    }
  });
});
