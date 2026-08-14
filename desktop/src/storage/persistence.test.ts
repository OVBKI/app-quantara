import { describe, expect, it } from 'vitest';
import { Money } from '../core/money';
import { emptyProfile } from '../core/model';
import { deserializeProfile, serializeProfile } from './persistence';

/** Un profil enregistré tel que l'écrivait une version antérieure du format. */
function legacyFile(profile: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, savedAt: '2026-03-01T00:00:00.000Z', profile });
}

describe('Sauvegarde et relecture', () => {
  it('restitue les montants en Money, et non en nombres', () => {
    const profile = { ...emptyProfile(), savingsBalance: Money.of(1234.56) };
    const restored = deserializeProfile(serializeProfile(profile));

    expect(restored.savingsBalance).toBeInstanceOf(Money);
    expect(restored.savingsBalance.equals(Money.of(1234.56))).toBe(true);
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
