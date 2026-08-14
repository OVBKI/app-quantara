import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile, type FinancialProfile, type TradingAccount, type Transaction } from '../model';
import { MARCH_2026, income, referenceDate, fixedExpense } from '../testing/fixtures';
import { addMonths, dateOf, formatDate } from '../yearMonth';
import { monthlySummary } from './budget';
import { analyse } from './analysis';
import { incomeBreakdown } from './income';
import { payoutStats, tradingIncomeEstimate, tradingSummary } from './trading';
import { ask } from '../advisor/advisor';

const TODAY = referenceDate(15);

function account(overrides: Partial<TradingAccount> = {}): TradingAccount {
  return {
    id: `acc-${Math.abs(overrides.fee?.units ?? 0)}-${overrides.phase ?? 'challenge'}-${overrides.startedAt ?? 'x'}`,
    provider: 'PropFirm',
    label: 'Compte 100k',
    phase: 'funded',
    accountSize: Money.of(100000),
    fee: Money.of(500),
    profitSplit: 0.8,
    startedAt: '2025-10-01',
    ...overrides,
  };
}

function payout(amount: number, monthsAgo: number, accountId = 'acc-1'): Transaction {
  const month = addMonths(MARCH_2026, -monthsAgo);
  return {
    id: `payout-${monthsAgo}-${amount}`,
    amount: Money.of(amount),
    date: formatDate(dateOf(month, 10)),
    kind: 'income',
    label: 'Versement prop firm',
    tradingAccountId: accountId,
  };
}

describe('Comptes de société de financement', () => {
  it('le capital géré n’est jamais compté comme un avoir', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      tradingAccounts: [account({ accountSize: Money.of(200000) })],
    };
    const summary = tradingSummary(profile, MARCH_2026, Money.of(3000));

    expect(summary.allocatedCapital.equals(Money.of(200000))).toBe(true);
    // Il n'apparaît ni dans l'épargne, ni dans les placements, ni dans le patrimoine.
    expect(profile.savingsBalance.isZero).toBe(true);
    expect(profile.investmentsBalance.isZero).toBe(true);
  });

  it('le net est ce qui est encaissé moins ce qui est payé', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      tradingAccounts: [
        account({ id: 'a1', fee: Money.of(500), phase: 'failed' }),
        account({ id: 'a2', fee: Money.of(500), phase: 'failed' }),
        account({ id: 'a3', fee: Money.of(500), phase: 'funded' }),
      ],
      transactions: [payout(1200, 1, 'a3')],
    };
    const summary = tradingSummary(profile, MARCH_2026, Money.of(3000));

    expect(summary.lifetimeFees.equals(Money.of(1500))).toBe(true);
    expect(summary.lifetimePayouts.equals(Money.of(1200))).toBe(true);
    // Deux échecs à 500 € font qu'un versement de 1 200 € laisse l'activité déficitaire.
    expect(summary.lifetimeNet.equals(Money.of(-300))).toBe(true);
  });

  it('calcule le taux de réussite et le coût réel d’un compte financé', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      tradingAccounts: [
        account({ id: 'a1', phase: 'failed' }),
        account({ id: 'a2', phase: 'failed' }),
        account({ id: 'a3', phase: 'failed' }),
        account({ id: 'a4', phase: 'funded' }),
      ],
    };
    const summary = tradingSummary(profile, MARCH_2026, Money.of(3000));

    expect(summary.passRate).toBeCloseTo(0.25, 4);
    // 4 épreuves à 500 € pour un seul compte obtenu : il coûte 2 000 €, pas 500 €.
    expect(summary.costPerFundedAccount?.equals(Money.of(2000))).toBe(true);
  });

  it('l’épreuve payée est une dépense du mois où elle est engagée', () => {
    const started = formatDate(dateOf(MARCH_2026, 3));
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      tradingAccounts: [account({ startedAt: started, fee: Money.of(600) })],
    };
    const summary = monthlySummary(profile, MARCH_2026, TODAY);

    expect(summary.tradingFees.equals(Money.of(600))).toBe(true);
    expect(summary.totalExpenses.greaterThanOrEqual(Money.of(600))).toBe(true);
    expect(summary.disposable.equals(Money.of(2400))).toBe(true);
  });

  it('mesure la régularité des versements et la plus longue sécheresse', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      tradingAccounts: [account()],
      // Versements il y a 1, 2 et 6 mois, sur une fenêtre de douze.
      transactions: [payout(800, 1), payout(1000, 2), payout(600, 6)],
    };
    const stats = payoutStats(profile, MARCH_2026);

    expect(stats.monthsWithPayout).toBe(3);
    expect(stats.median.equals(Money.of(800))).toBe(true);
    expect(stats.best.equals(Money.of(1000))).toBe(true);
    // Cinq, et non trois : les mois antérieurs au premier versement sont eux aussi des
    // mois sans rentrée. Les exclure flatterait la régularité de l'activité.
    expect(stats.longestDrySpell).toBe(5);
  });
});

describe('Planification d’un revenu de trading', () => {
  it('ne compte rien tant que six mois de versements n’ont pas été observés', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000)],
      tradingAccounts: [account()],
      transactions: [payout(1500, 1), payout(2000, 2), payout(1800, 3)],
    };
    const estimate = tradingIncomeEstimate(profile, MARCH_2026);

    expect(estimate.plannable).toBe(false);
    expect(estimate.low.isZero).toBe(true);
    expect(estimate.typical.isPositive).toBe(true); // le médian reste affiché, il n'est juste pas planifié

    // Le budget ne retient que le salaire : trois bons mois ne font pas un revenu.
    const summary = monthlySummary(profile, MARCH_2026, TODAY);
    expect(summary.income.equals(Money.of(2000))).toBe(true);
  });

  it('accepte de planifier au-delà de six mois, sur le premier quintile', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000)],
      tradingAccounts: [account()],
      transactions: [1, 2, 3, 4, 5, 6, 7].map((offset) => payout(1000 + offset * 100, offset)),
    };
    const estimate = tradingIncomeEstimate(profile, MARCH_2026);

    expect(estimate.plannable).toBe(true);
    // Le quintile bas inclut les mois sans versement : il reste très en deçà du médian.
    expect(estimate.low.lessThan(estimate.typical)).toBe(true);
  });

  it('un versement déjà encaissé compte pour ce qu’il est', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000)],
      tradingAccounts: [account()],
      transactions: [payout(1500, 0)],
    };
    const breakdown = incomeBreakdown(profile, MARCH_2026, TODAY, 'prudent');

    expect(breakdown.trading?.planned.equals(Money.of(1500))).toBe(true);
    expect(breakdown.planned.equals(Money.of(3500))).toBe(true);
    expect(breakdown.received.equals(Money.of(1500))).toBe(true);
  });

  it('un versement n’est pas confondu avec un revenu ponctuel ordinaire', () => {
    const withPayout: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000)],
      tradingAccounts: [account()],
      transactions: [payout(900, 1)], // mois précédent : rien à encaisser en mars
    };
    // Sans la règle d'exclusion, ce versement passé gonflerait les revenus ordinaires.
    expect(monthlySummary(withPayout, MARCH_2026, TODAY).income.equals(Money.of(2000))).toBe(true);
  });
});

describe('Constats et assistant', () => {
  const losingProfile: FinancialProfile = {
    ...emptyProfile(),
    incomes: [income('Salaire', 2500)],
    recurringExpenses: [fixedExpense('Loyer', 900, 'fixed.rent')],
    tradingAccounts: [
      account({ id: 'a1', phase: 'failed', fee: Money.of(500) }),
      account({ id: 'a2', phase: 'failed', fee: Money.of(500) }),
      account({ id: 'a3', phase: 'funded', fee: Money.of(500) }),
    ],
    transactions: [payout(700, 2, 'a3')],
  };

  it('signale une activité déficitaire sans détour', () => {
    const analysis = analyse(losingProfile, MARCH_2026, TODAY);
    const insight = analysis.insights.find((entry) => entry.kind === 'tradingNetNegative');

    expect(insight).toBeDefined();
    expect(insight?.title).toContain('-800'); // 700 encaissés − 1 500 payés
  });

  it('rappelle que le capital géré n’est pas un avoir', () => {
    const analysis = analyse(losingProfile, MARCH_2026, TODAY);
    expect(analysis.insights.some((entry) => entry.kind === 'tradingCapitalNotOwned')).toBe(true);
  });

  it('répond à la question de la rentabilité par une soustraction', () => {
    const answer = ask('mon trading est-il rentable ?', analyse(losingProfile, MARCH_2026, TODAY));

    expect(answer.title).toContain('Non');
    expect(answer.figures.some((figure) => figure.label === 'Net')).toBe(true);
    // 1 compte financé sur 3 épreuves terminées. Les épreuves en cours ne comptent pas :
    // elles ne sont ni réussies ni perdues.
    // Comme ailleurs, le pourcentage français porte une espace fine insécable.
    expect(answer.paragraphs.join(' ').replace(/[\u202f\u00a0]/g, ' ')).toContain('33 %');
  });

  it('ne recommande aucune stratégie', () => {
    const answer = ask('mon activité de trading est-elle rentable ?', analyse(losingProfile, MARCH_2026, TODAY));
    expect(answer.caveats.join(' ')).toContain('aucune recommandation');
  });

  it('renvoie vers la saisie quand aucun compte n’est enregistré', () => {
    const answer = ask('parle-moi de mon trading', analyse(emptyProfile(), MARCH_2026, TODAY));
    expect(answer.title).toContain('Aucun compte');
  });

  it('signale la dépendance quand le trading pèse trop dans les revenus', () => {
    const dependent: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 800)],
      tradingAccounts: [account({ id: 'a1' })],
      transactions: [payout(2000, 0, 'a1')],
    };
    const analysis = analyse(dependent, MARCH_2026, TODAY);
    expect(analysis.insights.some((entry) => entry.kind === 'tradingDependency')).toBe(true);
  });
});
