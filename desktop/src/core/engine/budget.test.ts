import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile } from '../model';
import { MARCH_2026, expense, fixedExpense, income, referenceDate, savingsTransaction, standardProfile } from '../testing/fixtures';
import { monthlySummary, projectedVariableSpending, savingsCapacity } from './budget';

describe('Revenus', () => {
  it('additionne des sources de périodicités différentes', () => {
    // Exemple du cahier des charges : 3 000 + 250 + 800 = 4 050 €.
    const profile = {
      ...emptyProfile(),
      incomes: [
        income('Salaire', 3000, 'monthly'),
        income('Allocation', 250, 'monthly', 'benefits'),
        income('Freelance', 9600, 'annual', 'freelance'),
      ],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate());
    expect(summary.income.equals(Money.of(4050))).toBe(true);
  });

  it('ne compte pas deux fois un salaire déjà déclaré', () => {
    const profile = standardProfile({
      transactions: [
        {
          id: 'salaire-mars',
          amount: Money.of(4000),
          date: '2026-03-28',
          kind: 'income',
          label: 'Salaire',
          incomeSourceId: 'income-1',
        },
      ],
    });
    const summary = monthlySummary(profile, MARCH_2026, referenceDate());
    expect(summary.income.equals(Money.of(4000))).toBe(true);
  });
});

describe('Dépenses et disponible', () => {
  it('revenus − fixes − variables = disponible', () => {
    // Exemple du cahier des charges : 4 000 − 2 000 − 700 = 1 300 €.
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 4000)],
      recurringExpenses: [fixedExpense('Charges', 2000, 'fixed.rent')],
      transactions: [expense(700, 'variable.groceries', 10)],
    };
    // Fin de mois : la dépense variable est constatée, pas projetée.
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(31));
    expect(summary.disposable.equals(Money.of(1300))).toBe(true);
  });

  it('calcule la part des charges fixes dans le revenu', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 4000)],
      recurringExpenses: [fixedExpense('Loyer', 2040, 'fixed.rent')],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate());
    expect(summary.fixedRatio).toBeCloseTo(0.51, 6);
  });

  it('étale une charge annuelle sur les douze mois', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [fixedExpense('Assurance', 1200, 'fixed.insurance', { frequency: 'annual' })],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate());
    expect(summary.fixedExpenses.equals(Money.of(100))).toBe(true);
  });

  it('distingue les dépenses essentielles du reste', () => {
    const profile = standardProfile();
    const summary = monthlySummary(profile, MARCH_2026, referenceDate());
    // Essentiel : loyer 1 200 + énergie 150 + courses 400. Exclus : streaming, restaurant.
    expect(summary.essentialExpenses.equals(Money.of(1750))).toBe(true);
  });

  it('isole le poids des abonnements', () => {
    const summary = monthlySummary(standardProfile(), MARCH_2026, referenceDate());
    expect(summary.subscriptions.equals(Money.of(30))).toBe(true);
  });
});

describe('Projection des dépenses variables', () => {
  it('extrapole le rythme observé en cours de mois', () => {
    // 200 € en 10 jours sur un mois de 31 jours → 620 € projetés.
    const profile = {
      ...emptyProfile(),
      transactions: [expense(200, 'variable.groceries', 3)],
    };
    const projection = projectedVariableSpending(profile, MARCH_2026, referenceDate(10));
    expect(projection.method).toBe('runRate');
    expect(projection.amount.equals(Money.of(620))).toBe(true);
  });

  it('ne projette pas sur trop peu de jours', () => {
    // Deux jours de courses ne disent rien du mois : on retombe sur le constaté.
    const profile = { ...emptyProfile(), transactions: [expense(200, 'variable.groceries', 1)] };
    const projection = projectedVariableSpending(profile, MARCH_2026, referenceDate(2));
    expect(projection.method).toBe('actual');
    expect(projection.amount.equals(Money.of(200))).toBe(true);
  });

  it('ne projette pas un mois déjà terminé', () => {
    const profile = { ...emptyProfile(), transactions: [expense(300, 'variable.groceries', 10)] };
    const projection = projectedVariableSpending(profile, MARCH_2026, new Date(2026, 4, 15));
    expect(projection.method).toBe('actual');
    expect(projection.amount.equals(Money.of(300))).toBe(true);
  });

  it('exclut du variable une transaction rattachée à une charge fixe', () => {
    const profile = standardProfile({
      transactions: [
        expense(400, 'variable.groceries', 5),
        {
          id: 'loyer-mars',
          amount: Money.of(1200),
          date: '2026-03-05',
          kind: 'expense',
          label: 'Loyer',
          category: 'fixed.rent',
          recurringExpenseId: 'expense-1',
        },
      ],
    });
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(31));
    expect(summary.variableSpentToDate.equals(Money.of(400))).toBe(true);
  });
});

describe('Capacité d’épargne', () => {
  it('laisse toujours une part libre', () => {
    const summary = monthlySummary(standardProfile(), MARCH_2026, referenceDate(31));
    const capacity = savingsCapacity(summary, 0.1);
    expect(capacity.units).toBeCloseTo(summary.disposable.units * 0.9, 4);
    expect(capacity.lessThan(summary.disposable)).toBe(true);
  });

  it('ne propose rien à épargner sur un budget déficitaire', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 1000)],
      recurringExpenses: [fixedExpense('Loyer', 1500, 'fixed.rent')],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate());
    expect(summary.disposable.isNegative).toBe(true);
    expect(savingsCapacity(summary, 0.1).isZero).toBe(true);
  });
});

describe('Reste à vivre quotidien', () => {
  it('répartit ce qui reste sur les jours restants', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3100)],
      recurringExpenses: [fixedExpense('Loyer', 1000, 'fixed.rent')],
      transactions: [expense(600, 'variable.groceries', 5), savingsTransaction(0, 6)],
    };
    // Au 11 mars : 3 100 − 1 000 − 600 = 1 500 € pour 20 jours → 75 €/jour.
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(11));
    expect(summary.daysRemaining).toBe(20);
    expect(summary.safeToSpendPerDay.equals(Money.of(75))).toBe(true);
  });
});
