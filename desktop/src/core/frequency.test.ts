import { describe, expect, it } from 'vitest';
import { Money } from './money';
import { annualEquivalent, monthlyEquivalent, occurrencesPerYear } from './frequency';

/** Les exemples chiffrés du cahier des charges, transcrits tels quels. */
describe('Conversion vers l’équivalent mensuel', () => {
  it('assurance annuelle de 1 200 € → 100 € par mois, au centime près', () => {
    expect(monthlyEquivalent(Money.of(1200), 'annual').equals(Money.of(100))).toBe(true);
  });

  it('salaire mensuel de 3 000 € → 3 000 € par mois', () => {
    expect(monthlyEquivalent(Money.of(3000), 'monthly').equals(Money.of(3000))).toBe(true);
  });

  it('trimestriel et semestriel', () => {
    expect(monthlyEquivalent(Money.of(300), 'quarterly').equals(Money.of(100))).toBe(true);
    expect(monthlyEquivalent(Money.of(600), 'semiannual').equals(Money.of(100))).toBe(true);
  });

  it('hebdomadaire : 52 semaines par an, pas 4 par mois', () => {
    // 100 × 52 ÷ 12 = 433,33 — et non 400, qui sous-estimerait de 400 € par an.
    expect(monthlyEquivalent(Money.of(100), 'weekly').roundedTo(2).units).toBeCloseTo(433.33, 2);
  });

  it('toutes les deux semaines : 26 occurrences, pas 24', () => {
    expect(occurrencesPerYear('biweekly')).toBe(26);
    expect(monthlyEquivalent(Money.of(100), 'biweekly').roundedTo(2).units).toBeCloseTo(216.67, 2);
  });

  it('un flux ponctuel n’est jamais lissé', () => {
    expect(occurrencesPerYear('oneOff')).toBeNull();
    expect(monthlyEquivalent(Money.of(500), 'oneOff').isZero).toBe(true);
  });
});

describe('Conversion vers l’équivalent annuel', () => {
  it('30 € par mois font 360 € par an', () => {
    expect(annualEquivalent(Money.of(30), 'monthly').equals(Money.of(360))).toBe(true);
  });

  it('un abonnement hebdomadaire de 5 € coûte 260 € par an', () => {
    expect(annualEquivalent(Money.of(5), 'weekly').equals(Money.of(260))).toBe(true);
  });
});
