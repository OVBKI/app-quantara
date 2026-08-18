import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { availableBalance, totalSavingsBalance, type Transaction } from '../model';
import { MARCH_2026, account, referenceDate, savingsAccount, standardProfile } from '../testing/fixtures';
import { analyse } from './analysis';
import { applicationTransactions, appliedAllocation, appliedTotal, planApplication } from './applyAllocation';

const REFERENCE = referenceDate(28);

function profileWithAccounts() {
  return standardProfile({
    accounts: [account('Compte courant', 3000), savingsAccount(5000), account('PEA', 0, 'investment')],
  });
}

function apply(profile = profileWithAccounts()) {
  const analysis = analyse(profile, MARCH_2026, REFERENCE);
  const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);
  const drafts = applicationTransactions(application, REFERENCE);
  const transactions: Transaction[] = drafts.map((draft, index) => ({ ...draft, id: `applied-${index}` }));
  return { profile: { ...profile, transactions: [...profile.transactions, ...transactions] }, application, transactions };
}

describe('Passage à l’acte du partage', () => {
  it('décrit chaque mouvement avant de le faire', () => {
    const profile = profileWithAccounts();
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(application.blocked).toBeNull();
    expect(application.moves.map((move) => move.part)).toEqual(['security', 'savings', 'investment']);
    // Rien n'a bougé tant qu'on n'a pas dit oui.
    expect(profile.transactions.every((transaction) => transaction.allocationMonth === undefined)).toBe(true);
  });

  it('retire du solde disponible ce qui est mis de côté', () => {
    const before = availableBalance(profileWithAccounts(), REFERENCE);
    const { profile, application } = apply();
    const after = availableBalance(profile, REFERENCE);

    expect(before.minus(after).equals(application.total)).toBe(true);
    expect(application.total.isPositive).toBe(true);
  });

  it('ne fait pas disparaître l’argent : il change de compte', () => {
    const source = profileWithAccounts();
    const beforeSavings = totalSavingsBalance(source, REFERENCE);
    const { profile, application } = apply(source);

    const moved = application.moves
      .filter((move) => move.part !== 'investment')
      .reduce((sum, move) => sum.plus(move.amount), Money.zero('EUR'));

    expect(totalSavingsBalance(profile, REFERENCE).minus(beforeSavings).equals(moved)).toBe(true);
  });

  it('laisse l’argent libre là où il est', () => {
    const { application } = apply();

    expect(application.moves.some((move) => move.part === 'free')).toBe(false);
    expect(application.stays.isPositive).toBe(true);
  });

  it('reconnaît un mois déjà partagé', () => {
    const { profile, application } = apply();

    expect(appliedAllocation(profile, MARCH_2026)).toHaveLength(application.moves.length);
    expect(appliedTotal(profile, MARCH_2026).equals(application.total)).toBe(true);
  });

  it('rend le solde initial quand on défait le partage', () => {
    const before = availableBalance(profileWithAccounts(), REFERENCE);
    const { profile, transactions } = apply();
    const undone = {
      ...profile,
      transactions: profile.transactions.filter((entry) => !transactions.some((added) => added.id === entry.id)),
    };

    expect(availableBalance(undone, REFERENCE).equals(before)).toBe(true);
  });

  it('refuse d’agir sans compte courant', () => {
    const profile = standardProfile({ accounts: [savingsAccount(5000)] });
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(application.blocked).toContain('compte courant');
    expect(applicationTransactions(application, REFERENCE)).toHaveLength(0);
  });

  it('signale une part sans compte de destination plutôt que de la déplacer au hasard', () => {
    const profile = standardProfile({ accounts: [account('Compte courant', 3000), savingsAccount(5000)] });
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(application.missingAccounts).toEqual(['investment']);
    expect(application.moves.some((move) => move.part === 'investment')).toBe(false);
  });

  it('choisit le compte courant le mieux garni', () => {
    const profile = standardProfile({
      accounts: [account('Appoint', 40), account('Principal', 3000), savingsAccount(5000)],
    });
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(profile.accounts.find((entry) => entry.id === application.fromAccountId)?.name).toBe('Principal');
  });

  it('respecte le compte imposé par l’utilisateur', () => {
    const profile = standardProfile({
      accounts: [account('Appoint', 40), account('Principal', 3000), savingsAccount(5000)],
    });
    const appoint = profile.accounts.find((entry) => entry.name === 'Appoint')!;
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, { source: appoint.id }, REFERENCE);

    expect(application.fromAccountId).toBe(appoint.id);
  });

  it('date les écritures dans le mois partagé, pas au jour de la saisie', () => {
    // Un partage de mars appliqué en avril doit rester daté de mars, sans quoi le solde
    // de chaque mois intermédiaire serait faux.
    const profile = profileWithAccounts();
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);
    const later = applicationTransactions(application, new Date(2026, 3, 12));

    expect(later.every((transaction) => transaction.date === '2026-03-31')).toBe(true);
  });
});
