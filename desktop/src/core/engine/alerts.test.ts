import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile } from '../model';
import {
  account,
  expense,
  fixedExpense,
  income,
  MARCH_2026,
  referenceDate,
  savingsAccount,
} from '../testing/fixtures';
import { analyse } from './analysis';
import { DEFAULT_ALERT_PREFERENCES, alertSignature, buildAlerts } from './alerts';

describe('Alertes système', () => {
  it('annonce un découvert prévu', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [account('Compte', 300, 'checking')],
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [fixedExpense('Loyer', 1200, 'fixed.rent', { dayOfMonth: 5 })],
    };
    const alerts = buildAlerts(analyse(profile, MARCH_2026, referenceDate(1)), DEFAULT_ALERT_PREFERENCES, referenceDate(1));
    expect(alerts.some((alert) => alert.kind === 'overdraft')).toBe(true);
  });

  it('regroupe les prélèvements des trois prochains jours en une seule alerte', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [
        fixedExpense('Loyer', 900, 'fixed.rent', { dayOfMonth: 12 }),
        fixedExpense('Assurance', 150, 'fixed.insurance', { dayOfMonth: 13 }),
      ],
    };
    const alerts = buildAlerts(
      analyse(profile, MARCH_2026, referenceDate(11)),
      DEFAULT_ALERT_PREFERENCES,
      referenceDate(11),
    );
    const debits = alerts.filter((alert) => alert.kind === 'upcomingDebit');

    // Une alerte, pas deux : interrompre deux fois pour le même sujet fait ignorer les deux.
    expect(debits).toHaveLength(1);
    // L'espace fine insécable du format français est normalisée avant comparaison.
    expect(debits[0]?.title.replace(/[  ]/g, ' ')).toContain('1 050');
  });

  it('ignore les petits prélèvements', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [fixedExpense('Streaming', 12, 'fixed.subscriptions', { dayOfMonth: 12 })],
    };
    const alerts = buildAlerts(
      analyse(profile, MARCH_2026, referenceDate(11)),
      DEFAULT_ALERT_PREFERENCES,
      referenceDate(11),
    );
    expect(alerts.some((alert) => alert.kind === 'upcomingDebit')).toBe(false);
  });

  it('signale une enveloppe dépassée', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      transactions: [expense(500, 'variable.groceries', 10)],
      categoryBudgets: [{ category: 'variable.groceries' as const, limit: Money.of(400) }],
    };
    const alerts = buildAlerts(
      analyse(profile, MARCH_2026, referenceDate(15)),
      DEFAULT_ALERT_PREFERENCES,
      referenceDate(15),
    );
    expect(alerts.some((alert) => alert.kind === 'envelopeExceeded')).toBe(true);
  });

  it('annonce le palier franchi par un objectif, et lui seul', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      goals: [
        {
          id: 'g',
          name: 'Vacances',
          kind: 'travel' as const,
          target: Money.of(2000),
          current: Money.of(1400),
          priority: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          achieved: false,
        },
      ],
    };
    const alerts = buildAlerts(
      analyse(profile, MARCH_2026, referenceDate(15)),
      DEFAULT_ALERT_PREFERENCES,
      referenceDate(15),
    );
    const milestones = alerts.filter((alert) => alert.kind === 'goalMilestone');

    // 70 % : le palier des 50 % est franchi, celui des 75 % ne l'est pas encore.
    expect(milestones).toHaveLength(1);
    expect(milestones[0]?.id).toBe('goal.g.50');
  });

  it('ne répète jamais un palier, même un autre jour', () => {
    // Un découvert dure et se rappelle chaque jour ; un palier ne se franchit qu'une fois.
    const milestone = { id: 'goal.g.50', kind: 'goalMilestone' as const, title: 't', body: 'b' };
    const overdraft = { id: 'overdraft', kind: 'overdraft' as const, title: 't', body: 'b' };

    expect(alertSignature(milestone, new Date(2026, 2, 15))).toBe(alertSignature(milestone, new Date(2026, 5, 2)));
    expect(alertSignature(overdraft, new Date(2026, 2, 15))).not.toBe(alertSignature(overdraft, new Date(2026, 5, 2)));
  });

  it('compte le fonds d’urgence en mois couverts', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [fixedExpense('Loyer', 1000, 'fixed.rent', { dayOfMonth: 5 })],
      accounts: [savingsAccount(3500)],
    };
    const alerts = buildAlerts(
      analyse(profile, MARCH_2026, referenceDate(15)),
      DEFAULT_ALERT_PREFERENCES,
      referenceDate(15),
    );
    const fund = alerts.find((alert) => alert.kind === 'emergencyFundMilestone');

    // 3 500 € pour 1 000 € de dépenses essentielles : trois mois pleins, pas trois et demi.
    expect(fund?.id).toBe('emergencyFund.3');
    expect(fund?.title).toContain('3 mois');
  });

  it('respecte chaque préférence désactivée', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [account('Compte', 100, 'checking')],
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [fixedExpense('Loyer', 1500, 'fixed.rent', { dayOfMonth: 5 })],
    };
    const analysis = analyse(profile, MARCH_2026, referenceDate(1));
    const silent = buildAlerts(
      analysis,
      { upcomingDebits: false, overdraft: false, envelopes: false, milestones: false, monthlyReport: false },
      referenceDate(1),
    );
    expect(silent).toHaveLength(0);
  });

  it('signe chaque alerte par jour, pour ne pas la répéter', () => {
    const alert = { id: 'overdraft', kind: 'overdraft' as const, title: 't', body: 'b' };
    expect(alertSignature(alert, new Date(2026, 2, 15))).toBe(alertSignature(alert, new Date(2026, 2, 15)));
    expect(alertSignature(alert, new Date(2026, 2, 15))).not.toBe(alertSignature(alert, new Date(2026, 2, 16)));
  });
});
