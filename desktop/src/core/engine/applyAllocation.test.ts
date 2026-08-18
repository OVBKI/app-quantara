import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { availableBalance, totalSavingsBalance, type Transaction } from '../model';
import { MARCH_2026, account, referenceDate, savingsAccount, standardProfile } from '../testing/fixtures';
import { analyse } from './analysis';
import {
  applicationTransactions,
  appliedAllocation,
  appliedTotal,
  destinationAccounts,
  planApplication,
} from './applyAllocation';

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

  it('propose un compte de la nature attendue, sans l’imposer', () => {
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000), savingsAccount(5000), account('PEA', 0, 'investment')],
    });
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    const livret = profile.accounts.find((entry) => entry.kind === 'savings')!;
    const pea = profile.accounts.find((entry) => entry.kind === 'investment')!;
    expect(application.moves.find((move) => move.part === 'security')?.toAccountId).toBe(livret.id);
    expect(application.moves.find((move) => move.part === 'investment')?.toAccountId).toBe(pea.id);
  });

  it('accepte n’importe quel compte comme destination', () => {
    // « Investir » dirigé vers un livret : c'est le choix de l'utilisateur, pas une
    // erreur à corriger. L'application enregistre ce qu'il a décidé.
    const profile = profileWithAccounts();
    const livret = profile.accounts.find((entry) => entry.kind === 'savings')!;
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(
      profile,
      analysis.allocation,
      MARCH_2026,
      { investment: livret.id },
      REFERENCE,
    );

    expect(application.moves.find((move) => move.part === 'investment')?.toAccountId).toBe(livret.id);
  });

  it('qualifie l’écriture d’après le compte d’arrivée, pas d’après la part', () => {
    // L'épargne dirigée vers un compte de placement n'est pas un versement d'épargne :
    // le taux d'épargne affiché ailleurs compterait alors ce qui n'y est pas.
    const profile = profileWithAccounts();
    const pea = profile.accounts.find((entry) => entry.kind === 'investment')!;
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, { savings: pea.id }, REFERENCE);

    expect(application.moves.find((move) => move.part === 'savings')?.kind).toBe('transfer');
  });

  it('retient les comptes enregistrés dans les préférences', () => {
    const base = profileWithAccounts();
    const pea = base.accounts.find((entry) => entry.kind === 'investment')!;
    const profile = {
      ...base,
      preferences: { ...base.preferences, allocationAccounts: { security: pea.id } },
    };
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(application.moves.find((move) => move.part === 'security')?.toAccountId).toBe(pea.id);
  });

  it('retombe sur la proposition quand le compte enregistré n’existe plus', () => {
    const base = profileWithAccounts();
    const profile = {
      ...base,
      preferences: { ...base.preferences, allocationAccounts: { security: 'compte-supprimé' } },
    };
    const livret = profile.accounts.find((entry) => entry.kind === 'savings')!;
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(application.moves.find((move) => move.part === 'security')?.toAccountId).toBe(livret.id);
  });

  it('n’offre jamais le compte source comme destination', () => {
    const profile = profileWithAccounts();
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(destinationAccounts(profile, 'savings', application.fromAccountId).some((entry) => entry.id === application.fromAccountId)).toBe(false);
    expect(application.moves.every((move) => move.toAccountId !== application.fromAccountId)).toBe(true);
  });

  it('signale une part sans destination possible plutôt que de la déplacer au hasard', () => {
    // Un seul compte : il n'existe nulle part où mettre l'argent de côté.
    const profile = standardProfile({ accounts: [account('Compte courant', 3000)] });
    const analysis = analyse(profile, MARCH_2026, REFERENCE);
    const application = planApplication(profile, analysis.allocation, MARCH_2026, {}, REFERENCE);

    expect(application.missingAccounts).toEqual(['security', 'savings', 'investment']);
    expect(application.moves).toHaveLength(0);
    expect(application.blocked).toContain('Aucun autre compte');
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
