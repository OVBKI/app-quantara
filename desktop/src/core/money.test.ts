import { describe, expect, it } from 'vitest';
import { Money, Percent, divRound } from './money';

describe('Money — précision', () => {
  it('additionne sans dérive binaire', () => {
    // En `number`, 0.1 + 0.2 vaut 0.30000000000000004.
    const total = Money.parse('0.1').plus(Money.parse('0.2'));
    expect(total.equals(Money.parse('0.3'))).toBe(true);
  });

  it('reste exact sur mille additions d’un centime', () => {
    let total = Money.zero('EUR');
    for (let index = 0; index < 1000; index += 1) total = total.plus(Money.parse('0.01'));
    expect(total.equals(Money.of(10))).toBe(true);
  });

  it('lit indifféremment la virgule et le point', () => {
    expect(Money.parse('1234,56').equals(Money.parse('1234.56'))).toBe(true);
  });

  it('refuse une saisie illisible', () => {
    expect(() => Money.parse('douze euros')).toThrow();
  });
});

describe('Money — arrondis', () => {
  it('arrondit au voisin pair, sans dériver vers le haut', () => {
    expect(Money.parse('2.5').roundedTo(0).units).toBe(2);
    expect(Money.parse('3.5').roundedTo(0).units).toBe(4);
  });

  it('arrondit à l’unité vers le haut pour un montant conseillé', () => {
    expect(Money.parse('187.43').roundedToUnit.units).toBe(187);
    expect(Money.parse('187.63').roundedToUnit.units).toBe(188);
  });

  it('divise en arrondissant, sans perdre les centimes', () => {
    expect(divRound(10n, 4n)).toBe(2n); // 2,5 → voisin pair
    expect(divRound(14n, 4n)).toBe(4n); // 3,5 → voisin pair
    expect(divRound(-10n, 4n)).toBe(-2n);
  });
});

describe('Money — opérations', () => {
  it('refuse une opération entre devises différentes', () => {
    expect(() => Money.of(10, 'EUR').plus(Money.of(10, 'USD'))).toThrow(/mono-devise/);
  });

  it('renvoie null — et non zéro — pour un ratio sur dénominateur nul', () => {
    // Zéro se confondrait avec un ratio réellement nul : l'appelant doit trancher.
    expect(Money.of(100).ratioTo(Money.zero())).toBeNull();
    expect(Money.zero().ratioTo(Money.of(100))).toBe(0);
  });

  it('ramène un montant négatif à zéro', () => {
    expect(Money.of(-50).clampedToZero.isZero).toBe(true);
    expect(Money.of(50).clampedToZero.units).toBe(50);
  });

  it('multiplie par une fraction exacte', () => {
    expect(Money.of(1200).timesFraction(1, 12).equals(Money.of(100))).toBe(true);
    expect(Money.of(100).timesFraction(52, 12).roundedTo(2).units).toBeCloseTo(433.33, 2);
  });
});

describe('Percent', () => {
  it('affiche un tiret quand le ratio est inconnu', () => {
    expect(Percent.format(null)).toBe('—');
  });

  it('calcule une variation relative', () => {
    expect(Percent.change(Money.of(100), Money.of(150))).toBeCloseTo(0.5, 6);
    expect(Percent.change(Money.zero(), Money.of(150))).toBeNull();
  });
});
