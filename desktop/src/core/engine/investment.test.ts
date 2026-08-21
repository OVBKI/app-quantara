import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile, totalSavingsBalance } from '../model';
import {
  debt as makeDebt,
  fixedExpense,
  income,
  MARCH_2026,
  referenceDate,
  savingsAccount,
  standardProfile,
} from '../testing/fixtures';
import { monthlySummary } from './budget';
import { emergencyFundStatus } from './emergencyFund';
import { ASSET_CLASSES, investmentGuidance } from './investment';

const TODAY = referenceDate(28);

function guidanceFor(profile = standardProfile(), monthly = Money.of(200)) {
  const summary = monthlySummary(profile, MARCH_2026, TODAY);
  const emergency = emergencyFundStatus(
    summary,
    totalSavingsBalance(profile),
    profile.preferences.emergencyFundMonths,
    Money.of(300),
  );
  return investmentGuidance(profile, summary, emergency, monthly);
}

describe('Préalables à l’investissement', () => {
  it('bloque tant que le fonds d’urgence est incomplet', () => {
    const guidance = guidanceFor(standardProfile({ accounts: [savingsAccount(500)] }));

    expect(guidance.state).toBe('blocked');
    expect(guidance.checks.find((check) => check.id === 'emergencyFund')?.passed).toBe(false);
    // Le montant indicatif retombe à zéro : afficher une somme à placer contredirait le blocage.
    expect(guidance.indicativeMonthly.isZero).toBe(true);
  });

  it('bloque tant qu’une dette coûteuse subsiste', () => {
    const profile = standardProfile({
      accounts: [savingsAccount(30000)],
      debts: [makeDebt('Revolving', 4000, 0.18, 150, 'creditCard')],
    });
    const guidance = guidanceFor(profile);

    expect(guidance.state).toBe('blocked');
    const check = guidance.checks.find((entry) => entry.id === 'noExpensiveDebt');
    expect(check?.passed).toBe(false);
    // Séparateur décimal français : « 18,0 % », pas « 18.0 % ».
    expect(check?.detail).toContain('18,0 %');
  });

  it('bloque quand rien n’est disponible à placer', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 1200)],
      recurringExpenses: [fixedExpense('Loyer', 1100, 'fixed.rent')],
      accounts: [savingsAccount(50000)],
    };
    const guidance = guidanceFor(profile, Money.zero());

    expect(guidance.state).toBe('blocked');
    expect(guidance.checks.find((check) => check.id === 'positiveCapacity')?.passed).toBe(false);
  });

  it('signale un revenu instable sans bloquer pour autant', () => {
    const profile = standardProfile({
      accounts: [savingsAccount(30000)],
      incomes: [
        {
          ...income('Freelance', 3000),
          variable: true,
          minAmount: Money.of(1000),
          maxAmount: Money.of(6000),
        },
      ],
    });
    const guidance = guidanceFor(profile);

    const check = guidance.checks.find((entry) => entry.id === 'stableIncome');
    expect(check?.passed).toBe(false);
    expect(check?.blocking).toBe(false);
    // Non bloquant : l'état est « partiel », pas « bloqué ».
    expect(guidance.state).toBe('partial');
  });

  it('ouvre la voie quand tout est en place', () => {
    const guidance = guidanceFor(standardProfile({ accounts: [savingsAccount(30000)] }));

    expect(guidance.state).toBe('ready');
    expect(guidance.checks.every((check) => check.passed)).toBe(true);
    expect(guidance.indicativeMonthly.equals(Money.of(200))).toBe(true);
  });
});

describe('Contenu éducatif', () => {
  it('ne nomme aucun produit ni aucun émetteur', () => {
    // Un nom de produit ou d'émetteur ferait basculer le contenu du côté du conseil
    // en investissement, activité réglementée.
    const text = ASSET_CLASSES.map((asset) => `${asset.name} ${asset.description} ${asset.drawback}`).join(' ');
    for (const forbidden of ['ETF', 'PEA ', 'Amundi', 'BlackRock', 'MSCI', 'S&P', 'Bitcoin', 'ISIN']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('énonce le revers de chaque famille', () => {
    for (const asset of ASSET_CLASSES) {
      expect(asset.drawback.length).toBeGreaterThan(30);
    }
  });

  it('ne promet aucun rendement chiffré', () => {
    const text = ASSET_CLASSES.map((asset) => `${asset.description} ${asset.drawback}`).join(' ');
    // Aucun pourcentage de rendement : les seuls chiffres autorisés décrivent des baisses.
    expect(/\d+\s*%\s*(par an|annuel|de rendement)/i.test(text)).toBe(false);
  });

  it('porte un avertissement de risque explicite', () => {
    const guidance = guidanceFor();
    expect(guidance.disclaimer).toContain('aucun conseil en investissement');
    expect(guidance.disclaimer).toContain('perdre de la valeur');
  });
});
