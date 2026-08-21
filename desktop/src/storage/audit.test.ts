import { describe, expect, it } from 'vitest';
import { Money } from '../core/money';
import { activeDebts, activeIncomes, activeRecurringExpenses, totalSavingsBalance } from '../core/model';
import { deserializeProfile, serializeProfile } from './persistence';
import { monthlySummary } from '../core/engine/budget';
import { MARCH_2026, referenceDate } from '../core/testing/fixtures';

/**
 * Régressions issues de l'audit — lecture et écriture du fichier de profil.
 *
 * C'est le seul endroit de l'application où une erreur ne se corrige pas : un calcul faux
 * s'affiche et se répare, un fichier écrasé est perdu. Ces cas valent donc plus que leur
 * nombre.
 */

const money = (units: number) => ({ __money: String(units * 1_000_000), currency: 'EUR' });

function roundTrip(profile: unknown): ReturnType<typeof deserializeProfile> {
  return deserializeProfile(JSON.stringify({ version: 1, savedAt: '2026-03-01T00:00:00.000Z', profile }));
}

describe('Migration d’un profil ancien', () => {
  it('ne remigre pas l’épargne à chaque ouverture', () => {
    /*
     * L'ancien champ `savingsBalance` était converti en compte à la lecture… puis
     * recopié tel quel dans le fichier à l'enregistrement. À chaque lancement, un compte
     * de plus : l'épargne affichée doublait, triplait, et la liste des comptes se
     * remplissait de doublons portant le même identifiant.
     */
    const legacy = { currency: 'EUR', savingsBalance: money(8000), accounts: [], transactions: [] };

    let profile = roundTrip(legacy);
    expect(totalSavingsBalance(profile, referenceDate(28)).equals(Money.of(8000))).toBe(true);

    // Trois ouvertures de plus, en repassant par le fichier écrit à chaque fois.
    for (let launch = 0; launch < 3; launch += 1) {
      profile = deserializeProfile(serializeProfile(profile));
    }

    expect(totalSavingsBalance(profile, referenceDate(28)).equals(Money.of(8000))).toBe(true);
    expect(profile.accounts).toHaveLength(1);
    expect(new Set(profile.accounts.map((account) => account.id)).size).toBe(profile.accounts.length);
  });

  it('ne fait pas disparaître les revenus, charges et dettes sans drapeau « actif »', () => {
    /*
     * `active` est postérieur aux premiers fichiers. Les moteurs filtrent dessus : un
     * profil écrit avant son introduction perdait d'un coup tous ses revenus, toutes ses
     * charges et toutes ses dettes — présents dans le fichier, invisibles dans
     * l'application.
     */
    const legacy = {
      currency: 'EUR',
      accounts: [],
      transactions: [],
      incomes: [{ id: 'i1', name: 'Salaire', amount: money(2000), frequency: 'monthly', category: 'salary', variable: false }],
      recurringExpenses: [
        { id: 'e1', name: 'Loyer', amount: money(800), frequency: 'monthly', category: 'fixed.rent', dayOfMonth: 5, subscription: false },
      ],
      debts: [{ id: 'd1', name: 'Crédit', kind: 'consumerLoan', outstanding: money(3000), annualRate: 0.05, monthlyPayment: money(150) }],
      goals: [{ id: 'g1', name: 'Vacances', kind: 'travel', target: money(2000), current: money(500) }],
    };

    const profile = roundTrip(legacy);
    const reference = referenceDate(15);

    expect(activeIncomes(profile, reference)).toHaveLength(1);
    expect(activeRecurringExpenses(profile, reference)).toHaveLength(1);
    expect(activeDebts(profile)).toHaveLength(1);
    // Un objectif sans priorité ni date de création ne doit pas produire de NaN au tri.
    expect(Number.isFinite(profile.goals[0]!.priority)).toBe(true);
    expect(profile.goals[0]!.createdAt).toBeTruthy();
    expect(profile.goals[0]!.achieved).toBe(false);
  });

  it('ignore une valeur nulle là où une valeur par défaut est attendue', () => {
    const profile = roundTrip({ currency: 'EUR', preferences: { textScale: null, emergencyFundMonths: null } });

    expect(Number.isFinite(profile.preferences.textScale)).toBe(true);
    expect(Number.isFinite(profile.preferences.emergencyFundMonths)).toBe(true);
  });

  it('refuse un contenu qui n’est pas un profil, avec un message compréhensible', () => {
    expect(() => roundTrip(null)).toThrow(/illisible|inattendue/i);
    expect(() => roundTrip('du texte')).toThrow(/illisible|inattendue/i);
    expect(() => deserializeProfile('{"version":1,"profile":{')).toThrow(/illisible|inattendue/i);
  });

  it('rejette un fichier écrit par une version plus récente, même sans numéro lisible', () => {
    expect(() => deserializeProfile(JSON.stringify({ version: 99, profile: { currency: 'EUR' } }))).toThrow(
      /plus récente/i,
    );
  });
});

describe('Devise', () => {
  it('ne laisse pas un profil dont la devise ne correspond pas à ses montants', () => {
    /*
     * Changer la devise dans les Réglages ne convertissait aucun montant. Le premier
     * calcul levait « Opération entre devises différentes » — pendant le rendu, donc
     * écran blanc, sur un profil déjà réenregistré dans cet état.
     */
    const profile = roundTrip({
      currency: 'USD',
      accounts: [{ id: 'a1', name: 'Compte', kind: 'checking', openingBalance: money(1000), balanceDate: '2026-02-28' }],
      incomes: [
        { id: 'i1', name: 'Salaire', amount: money(2000), frequency: 'monthly', category: 'salary', variable: false, active: true },
      ],
      transactions: [],
    });

    expect(() => monthlySummary(profile, MARCH_2026, referenceDate(15))).not.toThrow();
  });
});
