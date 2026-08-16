import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile, type Holding } from '../model';
import { MARCH_2026, fixedExpense, income, referenceDate, standardProfile, savingsAccount } from '../testing/fixtures';
import { analyse } from './analysis';
import { assessHealth } from './health';
import { summarizePortfolio } from './portfolio';
import { summarizeSubscriptions } from './subscriptions';

function holding(entry: Partial<Holding> & Pick<Holding, 'invested' | 'currentValue'>): Holding {
  return {
    id: crypto.randomUUID(),
    name: 'Ligne',
    assetClass: 'etf',
    valuedOn: '2026-03-01',
    ...entry,
  };
}

describe('Portefeuille', () => {
  it('mesure le gain par rapport aux sommes versées', () => {
    const profile = {
      ...emptyProfile(),
      holdings: [holding({ invested: Money.of(10000), currentValue: Money.of(11500) })],
    };
    const summary = summarizePortfolio(profile, Money.zero(), referenceDate(15));

    expect(summary.gain.equals(Money.of(1500))).toBe(true);
    expect(summary.gainRatio).toBeCloseTo(0.15, 4);
  });

  it('affiche une moins-value telle quelle', () => {
    // Aucun arrondi vers le haut, aucun euphémisme : une perte s'affiche négative.
    const profile = {
      ...emptyProfile(),
      holdings: [holding({ invested: Money.of(5000), currentValue: Money.of(4200) })],
    };
    const summary = summarizePortfolio(profile, Money.zero(), referenceDate(15));

    expect(summary.gain.isNegative).toBe(true);
    expect(summary.gain.equals(Money.of(-800))).toBe(true);
  });

  it('ne calcule aucun rapport quand rien n’a été versé', () => {
    const profile = {
      ...emptyProfile(),
      holdings: [holding({ invested: Money.zero(), currentValue: Money.of(300) })],
    };
    expect(summarizePortfolio(profile, Money.zero(), referenceDate(15)).gainRatio).toBeNull();
  });

  it('répartit par classe d’actifs', () => {
    const profile = {
      ...emptyProfile(),
      holdings: [
        holding({ invested: Money.of(6000), currentValue: Money.of(6000), assetClass: 'etf' }),
        holding({ invested: Money.of(2000), currentValue: Money.of(2000), assetClass: 'bonds' }),
      ],
    };
    const summary = summarizePortfolio(profile, Money.zero(), referenceDate(15));

    expect(summary.byAssetClass[0]?.assetClass).toBe('etf');
    expect(summary.byAssetClass[0]?.share).toBeCloseTo(0.75, 4);
  });

  it('signale une valeur qui date', () => {
    // Une valorisation vieille de six mois ne dit plus rien du portefeuille d'aujourd'hui.
    const profile = {
      ...emptyProfile(),
      holdings: [holding({ invested: Money.of(1000), currentValue: Money.of(1000), valuedOn: '2025-09-01' })],
    };
    expect(summarizePortfolio(profile, Money.zero(), referenceDate(15)).staleCount).toBe(1);
  });
});

describe('Abonnements', () => {
  const profile = standardProfile({
    recurringExpenses: [
      fixedExpense('Netflix', 15, 'fixed.subscriptions', { subscription: true }),
      fixedExpense('Spotify', 11, 'fixed.subscriptions', { subscription: true }),
      fixedExpense('Loyer', 1200, 'fixed.rent'),
    ],
  });

  it('ne retient que les abonnements', () => {
    const summary = summarizeSubscriptions(profile, Money.of(4000), referenceDate(15));
    expect(summary.lines).toHaveLength(2);
  });

  it('donne le coût annuel, pas seulement le mensuel', () => {
    // 26 € par mois n'alarme personne ; 312 € par an, si.
    const summary = summarizeSubscriptions(profile, Money.of(4000), referenceDate(15));
    expect(summary.monthlyTotal.equals(Money.of(26))).toBe(true);
    expect(summary.annualTotal.equals(Money.of(312))).toBe(true);
  });

  it('mensualise un abonnement annuel', () => {
    const annual = standardProfile({
      recurringExpenses: [
        fixedExpense('Antivirus', 60, 'fixed.subscriptions', { subscription: true, frequency: 'annual' }),
      ],
    });
    const summary = summarizeSubscriptions(annual, Money.of(4000), referenceDate(15));
    expect(summary.monthlyTotal.equals(Money.of(5))).toBe(true);
  });

  it('repère un doublon probable', () => {
    const doubled = standardProfile({
      recurringExpenses: [
        fixedExpense('Netflix', 15, 'fixed.subscriptions', { subscription: true }),
        fixedExpense('NETFLIX', 8, 'fixed.subscriptions', { subscription: true }),
      ],
    });
    const summary = summarizeSubscriptions(doubled, Money.of(4000), referenceDate(15));
    expect(summary.possibleDuplicates.length).toBeGreaterThan(0);
  });
});

describe('Santé financière', () => {
  it('passe au rouge dès que le mois est déficitaire', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 1000)],
      recurringExpenses: [fixedExpense('Loyer', 1500, 'fixed.rent')],
    };
    const report = assessHealth(analyse(profile, MARCH_2026, referenceDate(15)));

    expect(report.level).toBe('alert');
    expect(report.criteria.find((criterion) => criterion.id === 'disposable')?.level).toBe('alert');
  });

  it('retient le pire critère, pas une moyenne', () => {
    // Une moyenne masquerait un fonds d'urgence vide derrière de bons résultats ailleurs.
    const profile = standardProfile({ accounts: [] });
    const report = assessHealth(analyse(profile, MARCH_2026, referenceDate(15)));

    expect(report.criteria.some((criterion) => criterion.level === 'good')).toBe(true);
    expect(report.level).toBe('alert');
  });

  it('donne une action pour chaque critère qui n’est pas au vert', () => {
    const report = assessHealth(analyse(standardProfile(), MARCH_2026, referenceDate(15)));
    for (const criterion of report.criteria) {
      if (criterion.level === 'good') continue;
      expect(criterion.action).not.toBeNull();
      expect(criterion.action?.length).toBeGreaterThan(20);
    }
  });

  it('reconnaît une situation saine', () => {
    const profile = standardProfile({ accounts: [savingsAccount(30000)] });
    const report = assessHealth(analyse(profile, MARCH_2026, referenceDate(15)));

    expect(report.criteria.find((criterion) => criterion.id === 'emergencyFund')?.level).toBe('good');
  });
});
