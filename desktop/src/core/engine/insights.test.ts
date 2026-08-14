import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile } from '../model';
import {
  MARCH_2026,
  debt as makeDebt,
  expense,
  fixedExpense,
  income,
  referenceDate,
  savingsTransaction,
  standardProfile,
} from '../testing/fixtures';
import { monthlySummary } from './budget';
import { forecastCashFlow } from './cashflow';
import { analyse } from './analysis';

function insightKinds(profile = standardProfile(), day = 31) {
  return analyse(profile, MARCH_2026, referenceDate(day)).insights.map((insight) => insight.kind);
}

describe('Trésorerie', () => {
  it('détecte un creux avant l’arrivée du salaire', () => {
    // Loyer de 1 200 € le 5, salaire le 28, 800 € en banque : le compte passe en négatif
    // au milieu du mois, alors même que le solde de fin de mois est positif.
    const profile = {
      ...emptyProfile(),
      accounts: [{ id: 'compte', name: 'Compte courant', kind: 'checking' as const, balance: Money.of(800) }],
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [fixedExpense('Loyer', 1200, 'fixed.rent', { dayOfMonth: 5 })],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(1));
    const forecast = forecastCashFlow(profile, summary, MARCH_2026, Money.of(800), referenceDate(1));

    expect(forecast.projectedOverdraft).toBe(true);
    expect(forecast.lowestBalanceDate?.getDate()).toBeLessThan(28);
    expect(forecast.endOfMonthBalance.isPositive).toBe(true);
  });

  it('évite ce creux quand le revenu tombe en début de mois', () => {
    // Mêmes montants que le cas précédent : seule la date de réception change. Payé le 2
    // plutôt que le 28, le compte ne descend jamais sous zéro — c'est bien la date, et
    // non le montant, qui décide du découvert.
    const profile = {
      ...emptyProfile(),
      accounts: [{ id: 'compte', name: 'Compte courant', kind: 'checking' as const, balance: Money.of(800) }],
      incomes: [{ ...income('Salaire', 2000), dayOfMonth: 2 }],
      recurringExpenses: [fixedExpense('Loyer', 1200, 'fixed.rent', { dayOfMonth: 5 })],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(1));
    const forecast = forecastCashFlow(profile, summary, MARCH_2026, Money.of(800), referenceDate(1));

    expect(forecast.projectedOverdraft).toBe(false);
  });

  it('ne compte pas deux fois les dépenses déjà passées', () => {
    const profile = standardProfile();
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(20));
    const forecast = forecastCashFlow(profile, summary, MARCH_2026, Money.of(2000), referenceDate(20));
    // 31 points, un par jour du mois.
    expect(forecast.points).toHaveLength(31);
  });
});

describe('Analyse proactive', () => {
  it('signale des charges fixes trop lourdes', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [fixedExpense('Loyer', 1200, 'fixed.rent')],
    };
    expect(insightKinds(profile)).toContain('fixedExpenseLoad');
  });

  it('signale le poids des abonnements, y compris modeste', () => {
    // Exemple du cahier des charges : 87 € d'abonnements sur 4 000 € de revenus.
    const profile = standardProfile({
      recurringExpenses: [
        fixedExpense('Loyer', 1200, 'fixed.rent'),
        fixedExpense('Divers abonnements', 87, 'fixed.subscriptions', { subscription: true }),
      ],
    });
    expect(insightKinds(profile)).toContain('subscriptionLoad');
  });

  it('alerte au-delà d’un tiers du revenu en remboursements', () => {
    const profile = standardProfile({
      debts: [makeDebt('Crédit', 40000, 0.04, 1400)],
    });
    const kinds = insightKinds(profile);
    expect(kinds).toContain('debtLoad');
  });

  it('signale un budget déficitaire avant tout le reste', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 1000)],
      recurringExpenses: [fixedExpense('Loyer', 1500, 'fixed.rent')],
    };
    const insights = analyse(profile, MARCH_2026, referenceDate()).insights;
    expect(insights[0]?.kind).toBe('negativeDisposable');
    expect(insights[0]?.severity).toBe('critical');
  });

  it('félicite un fonds d’urgence complet', () => {
    const profile = standardProfile({ savingsBalance: Money.of(30000) });
    expect(insightKinds(profile)).toContain('emergencyFundComplete');
  });

  it('signale un dépassement de budget par catégorie', () => {
    const profile = standardProfile({
      categoryBudgets: [{ category: 'variable.restaurants', limit: Money.of(80) }],
    });
    const insights = analyse(profile, MARCH_2026, referenceDate(31)).insights;
    const drift = insights.find((insight) => insight.kind === 'categoryDrift');
    expect(drift).toBeDefined();
    expect(drift?.amount?.equals(Money.of(40))).toBe(true); // 120 dépensés pour 80 budgétés
  });

  it('reconnaît un bon taux d’épargne', () => {
    const profile = standardProfile({
      transactions: [expense(400, 'variable.groceries', 5), savingsTransaction(700, 2)],
    });
    expect(insightKinds(profile)).toContain('savingsRateGood');
  });

  it('cite toujours un montant vérifiable', () => {
    const insights = analyse(standardProfile(), MARCH_2026, referenceDate(31)).insights;
    expect(insights.length).toBeGreaterThan(0);
    // Chaque constat porte un chiffre : l'utilisateur doit pouvoir le recouper.
    expect(insights.every((insight) => /\d/.test(insight.message))).toBe(true);
  });
});
