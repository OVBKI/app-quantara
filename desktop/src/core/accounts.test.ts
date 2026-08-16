import { describe, expect, it } from 'vitest';
import { Money } from './money';
import {
  accountBalance,
  availableBalance,
  emptyProfile,
  netWorth,
  totalInvestmentsBalance,
  totalSavingsBalance,
  type Holding,
  type Transaction,
} from './model';
import { account, savingsAccount } from './testing/fixtures';

function tx(entry: Partial<Transaction> & Pick<Transaction, 'amount' | 'kind'>): Transaction {
  return {
    id: crypto.randomUUID(),
    date: '2026-03-10',
    label: 'Test',
    ...entry,
  };
}

function holding(invested: number, currentValue: number, accountId?: string): Holding {
  return {
    id: crypto.randomUUID(),
    name: 'Ligne',
    assetClass: 'etf',
    invested: Money.of(invested),
    currentValue: Money.of(currentValue),
    valuedOn: '2026-03-01',
    accountId,
  };
}

describe('Solde d’un compte', () => {
  const compte = account('Compte courant', 1000, 'checking', '2026-02-28');

  it('part du relevé et applique les mouvements postérieurs', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [compte],
      transactions: [
        tx({ amount: Money.of(200), kind: 'expense', accountId: compte.id }),
        tx({ amount: Money.of(50), kind: 'income', accountId: compte.id }),
      ],
    };

    expect(accountBalance(profile, compte, new Date(2026, 2, 31)).equals(Money.of(850))).toBe(true);
  });

  it('ignore ce qui précède le relevé', () => {
    // Une transaction antérieure est déjà comprise dans le solde communiqué par la banque.
    // La recompter ferait dériver le solde à chaque import d'historique.
    const profile = {
      ...emptyProfile(),
      accounts: [compte],
      transactions: [tx({ amount: Money.of(500), kind: 'expense', date: '2026-01-15', accountId: compte.id })],
    };

    expect(accountBalance(profile, compte, new Date(2026, 2, 31)).equals(Money.of(1000))).toBe(true);
  });

  it('ignore une transaction rattachée à un autre compte', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [compte],
      transactions: [tx({ amount: Money.of(200), kind: 'expense', accountId: 'ailleurs' })],
    };

    expect(accountBalance(profile, compte).equals(Money.of(1000))).toBe(true);
  });

  it('se corrige tout seul quand la transaction disparaît', () => {
    // C'est l'intérêt d'un solde déduit plutôt que stocké : rien à défaire à la main.
    const mouvement = tx({ amount: Money.of(200), kind: 'expense', accountId: compte.id });
    const avec = { ...emptyProfile(), accounts: [compte], transactions: [mouvement] };
    const sans = { ...avec, transactions: [] };

    expect(accountBalance(avec, compte, new Date(2026, 2, 31)).equals(Money.of(800))).toBe(true);
    expect(accountBalance(sans, compte, new Date(2026, 2, 31)).equals(Money.of(1000))).toBe(true);
  });
});

describe('Virement entre comptes', () => {
  const courant = account('Courant', 2000, 'checking', '2026-02-28');
  const livret = account('Livret', 500, 'savings', '2026-02-28');
  const profile = {
    ...emptyProfile(),
    accounts: [courant, livret],
    transactions: [
      tx({ amount: Money.of(300), kind: 'transfer', accountId: courant.id, toAccountId: livret.id }),
    ],
  };
  const fin = new Date(2026, 2, 31);

  it('débite la source et crédite la destination', () => {
    expect(accountBalance(profile, courant, fin).equals(Money.of(1700))).toBe(true);
    expect(accountBalance(profile, livret, fin).equals(Money.of(800))).toBe(true);
  });

  it('ne fait disparaître aucun argent', () => {
    // Un virement déplace, il ne dépense pas : le patrimoine total est inchangé.
    expect(netWorth(profile, fin).equals(Money.of(2500))).toBe(true);
  });
});

describe('Totaux par nature de compte', () => {
  it('sépare le disponible de l’épargne', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [account('Courant', 1200), account('Espèces', 80, 'cash'), savingsAccount(6000)],
    };

    expect(availableBalance(profile).equals(Money.of(1280))).toBe(true);
    expect(totalSavingsBalance(profile).equals(Money.of(6000))).toBe(true);
  });

  it('ne compte pas deux fois un compte de placement détaillé', () => {
    // Le piège que l'ancienne version n'évitait pas : détailler ses lignes ne doit pas
    // s'ajouter au solde du compte qui les contient.
    const compte = account('PEA', 10000, 'investment');
    const profile = {
      ...emptyProfile(),
      accounts: [compte],
      holdings: [holding(8000, 9500, compte.id)],
    };

    expect(totalInvestmentsBalance(profile).equals(Money.of(9500))).toBe(true);
  });

  it('retient le solde du compte tant qu’aucune ligne n’est saisie', () => {
    const compte = account('PEA', 10000, 'investment');
    const profile = { ...emptyProfile(), accounts: [compte] };

    expect(totalInvestmentsBalance(profile).equals(Money.of(10000))).toBe(true);
  });

  it('additionne les lignes non rattachées à un compte', () => {
    const profile = { ...emptyProfile(), holdings: [holding(1000, 1150), holding(500, 480)] };

    expect(totalInvestmentsBalance(profile).equals(Money.of(1630))).toBe(true);
  });

  it('exclut un compte archivé', () => {
    const profile = {
      ...emptyProfile(),
      accounts: [account('Courant', 1000), { ...account('Ancien', 900), archived: true }],
    };

    expect(availableBalance(profile).equals(Money.of(1000))).toBe(true);
  });
});
