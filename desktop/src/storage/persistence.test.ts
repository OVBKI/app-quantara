import { describe, expect, it } from 'vitest';
import { Money } from '../core/money';
import { emptyProfile, totalSavingsBalance } from '../core/model';
import { deserializeProfile, serializeProfile } from './persistence';

/** Un profil enregistré tel que l'écrivait une version antérieure du format. */
function legacyFile(profile: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, savedAt: '2026-03-01T00:00:00.000Z', profile });
}

describe('Sauvegarde et relecture', () => {
  it('restitue les montants en Money, et non en nombres', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [
        {
          id: 'a',
          name: 'Livret',
          kind: 'savings' as const,
          openingBalance: Money.of(1234.56),
          balanceDate: '2026-03-01',
        },
      ],
    };
    const restored = deserializeProfile(serializeProfile(profile));

    expect(restored.accounts[0]?.openingBalance).toBeInstanceOf(Money);
    expect(restored.accounts[0]?.openingBalance.equals(Money.of(1234.56))).toBe(true);
  });

  it('convertit l’ancienne épargne globale en compte, sans la compter deux fois', () => {
    // Le bug d'origine : `savingsBalance` s'additionnait aux comptes d'épargne.
    const restored = deserializeProfile(
      legacyFile({
        currency: 'EUR',
        savingsBalance: Money.of(8000),
        accounts: [{ id: 'a', name: 'Livret', kind: 'savings', balance: Money.of(2000) }],
      }),
    );

    expect(restored.accounts).toHaveLength(2);
    expect(totalSavingsBalance(restored).equals(Money.of(10000))).toBe(true);
  });

  it('reprend le solde des anciens comptes sans date de relevé', () => {
    const restored = deserializeProfile(
      legacyFile({ currency: 'EUR', accounts: [{ id: 'a', name: 'Compte', kind: 'checking', balance: Money.of(500) }] }),
    );

    expect(restored.accounts[0]?.openingBalance.equals(Money.of(500))).toBe(true);
    expect(restored.accounts[0]?.balanceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuse un fichier venant d’un format plus récent', () => {
    const text = JSON.stringify({ version: 99, savedAt: '', profile: emptyProfile() });
    expect(() => deserializeProfile(text)).toThrow(/plus récente/);
  });

  it('complète les préférences absentes des fichiers anciens', () => {
    const restored = deserializeProfile(legacyFile({ currency: 'EUR' }));

    expect(restored.preferences.textScale).toBe(1);
    expect(restored.preferences.alerts.overdraft).toBe(true);
  });

  it('considère qu’un profil déjà rempli a été mis en route', () => {
    // Sans cette règle, une mise à jour renverrait tous les utilisateurs existants
    // dans l'écran de première installation.
    const restored = deserializeProfile(
      legacyFile({
        currency: 'EUR',
        incomes: [{ id: 'i', name: 'Salaire', amount: Money.of(2000), frequency: 'monthly', category: 'salary', variable: false, active: true }],
      }),
    );

    expect(restored.preferences.onboardingCompleted).toBe(true);
  });

  it('renvoie un profil vide vers la mise en route', () => {
    expect(deserializeProfile(legacyFile({ currency: 'EUR' })).preferences.onboardingCompleted).toBe(false);
  });
});
