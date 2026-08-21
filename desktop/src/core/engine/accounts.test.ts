import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { availableBalance, type Transaction } from '../model';
import { MARCH_2026, account, referenceDate, savingsAccount, standardProfile } from '../testing/fixtures';
import { accountDailyBalances, accountMovements, overviewAccounts, summariseAccount } from './accounts';
import { expectedIncomes, receiptTotals, receiptTransaction } from './receipts';

const REFERENCE = referenceDate(28);

function tracked() {
  const current = account('Compte courant', 2000);
  const livret = savingsAccount(4000);
  const transactions: Transaction[] = [
    {
      id: 'dep-1',
      amount: Money.of(120),
      date: '2026-03-04',
      kind: 'expense',
      label: 'Courses',
      category: 'variable.groceries',
      accountId: current.id,
    },
    {
      id: 'dep-2',
      amount: Money.of(80),
      date: '2026-03-11',
      kind: 'expense',
      label: 'Essence',
      category: 'variable.fuel',
      accountId: current.id,
    },
    {
      id: 'vir-1',
      amount: Money.of(300),
      date: '2026-03-15',
      kind: 'savings',
      label: 'Mise de côté',
      accountId: current.id,
      toAccountId: livret.id,
    },
  ];
  return { profile: standardProfile({ accounts: [current, livret], transactions }), current, livret };
}

describe('Relevé de compte', () => {
  it('classe les mouvements par date et suit le solde ligne à ligne', () => {
    const { profile, current } = tracked();
    const movements = accountMovements(profile, current, MARCH_2026);

    expect(movements.map((entry) => entry.transaction.id)).toEqual(['dep-1', 'dep-2', 'vir-1']);
    // 2 000 − 120 − 80 − 300
    expect(movements.at(-1)!.balanceAfter.equals(Money.of(1500))).toBe(true);
  });

  it('compte un virement dans les deux sens', () => {
    const { profile, current, livret } = tracked();

    const leaving = accountMovements(profile, current, MARCH_2026).find((entry) => entry.transaction.id === 'vir-1');
    const arriving = accountMovements(profile, livret, MARCH_2026).find((entry) => entry.transaction.id === 'vir-1');

    expect(leaving?.amount.equals(Money.of(-300))).toBe(true);
    expect(arriving?.amount.equals(Money.of(300))).toBe(true);
  });

  it('sépare ce qui entre de ce qui sort', () => {
    const { profile, current } = tracked();
    const summary = summariseAccount(profile, current, MARCH_2026, REFERENCE);

    expect(summary.debited.equals(Money.of(500))).toBe(true);
    expect(summary.credited.isZero).toBe(true);
    expect(summary.net.equals(Money.of(-500))).toBe(true);
    expect(summary.movementCount).toBe(3);
  });

  it('donne un solde pour chaque jour du mois', () => {
    const { profile, current } = tracked();
    const daily = accountDailyBalances(profile, current, MARCH_2026);

    expect(daily).toHaveLength(31);
    // Avant la première dépense, le solde de départ ; après le 15, tout est passé.
    expect(daily[0]!.balance.equals(Money.of(2000))).toBe(true);
    expect(daily[30]!.balance.equals(Money.of(1500))).toBe(true);
  });

  it('signale les écritures qui ne touchent aucun compte', () => {
    const { profile } = tracked();
    const orphan: Transaction = {
      id: 'orphelin',
      amount: Money.of(45),
      date: '2026-03-09',
      kind: 'expense',
      label: 'Sans compte',
      category: 'variable.leisure',
    };
    const overview = overviewAccounts({ ...profile, transactions: [...profile.transactions, orphan] }, MARCH_2026, REFERENCE);

    expect(overview.unassigned.map((entry) => entry.id)).toEqual(['orphelin']);
  });

  it('valorise un compte de placement par ses lignes, pas par ses versements', () => {
    // Le portefeuille vaut 1 500 alors que 1 000 seulement ont été versés : c'est la
    // valeur qui compte, et c'est la règle appliquée partout ailleurs.
    const { profile } = tracked();
    const pea = account('PEA', 1000, 'investment');
    const withHoldings = {
      ...profile,
      accounts: [...profile.accounts, pea],
      holdings: [
        {
          id: 'h1',
          name: 'Fonds monde',
          assetClass: 'etf' as const,
          invested: Money.of(1000),
          currentValue: Money.of(1500),
          valuedOn: '2026-03-02',
          accountId: pea.id,
        },
      ],
    };

    const summary = summariseAccount(withHoldings, pea, MARCH_2026, REFERENCE);
    expect(summary.balance.equals(Money.of(1500))).toBe(true);
    expect(summary.valuedByHoldings).toBe(true);
  });

  it('additionne les soldes de tous les comptes', () => {
    const { profile } = tracked();
    const overview = overviewAccounts(profile, MARCH_2026, REFERENCE);

    // 1 500 sur le courant, 4 300 sur le livret.
    expect(overview.total.equals(Money.of(5800))).toBe(true);
  });
});

describe('Encaissements', () => {
  it('distingue ce qui est attendu de ce qui est reçu', () => {
    const { profile } = tracked();
    const entries = expectedIncomes(profile, MARCH_2026, REFERENCE);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.receipts).toHaveLength(0);
    expect(entries[0]!.expected.equals(Money.of(4000))).toBe(true);
  });

  it('crédite le compte quand l’encaissement est confirmé', () => {
    const { profile, current } = tracked();
    const before = availableBalance(profile, REFERENCE);
    const entry = expectedIncomes(profile, MARCH_2026, REFERENCE)[0]!;

    const draft = receiptTransaction(entry, MARCH_2026, entry.expected, current.id, REFERENCE);
    const after = availableBalance(
      { ...profile, transactions: [...profile.transactions, { ...draft, id: 'reçu' }] },
      REFERENCE,
    );

    expect(draft.accountId).toBe(current.id);
    expect(after.minus(before).equals(entry.expected)).toBe(true);
  });

  it('date l’encaissement au jour de réception habituel', () => {
    const { profile, current } = tracked();
    const withDay = {
      ...profile,
      incomes: profile.incomes.map((income) => ({ ...income, dayOfMonth: 5 })),
    };
    const entry = expectedIncomes(withDay, MARCH_2026, REFERENCE)[0]!;

    expect(receiptTransaction(entry, MARCH_2026, entry.expected, current.id, REFERENCE).date).toBe('2026-03-05');
  });

  it('ne date jamais un encaissement dans le futur', () => {
    // Paie attendue le 31, confirmée le 28 : l'argent est là aujourd'hui, il doit
    // compter aujourd'hui. Daté du 31, il resterait invisible trois jours de plus.
    const { profile, current } = tracked();
    const entry = expectedIncomes(profile, MARCH_2026, REFERENCE)[0]!;

    expect(receiptTransaction(entry, MARCH_2026, entry.expected, current.id, REFERENCE).date).toBe('2026-03-28');
  });

  it('reconnaît un revenu déjà encaissé et ne le propose plus', () => {
    const { profile, current } = tracked();
    const entry = expectedIncomes(profile, MARCH_2026, REFERENCE)[0]!;
    const draft = receiptTransaction(entry, MARCH_2026, entry.expected, current.id, REFERENCE);
    const updated = { ...profile, transactions: [...profile.transactions, { ...draft, id: 'reçu' }] };

    const after = expectedIncomes(updated, MARCH_2026, REFERENCE)[0]!;
    expect(after.receipts.map((entry) => entry.id)).toEqual(['reçu']);
    expect(receiptTotals([after], 'EUR').pending).toBe(0);
  });

  it('signale un encaissement rattaché à aucun compte', () => {
    const { profile } = tracked();
    const entry = expectedIncomes(profile, MARCH_2026, REFERENCE)[0]!;
    const floating = { ...receiptTransaction(entry, MARCH_2026, entry.expected, undefined, REFERENCE), id: 'flottant' };
    const updated = { ...profile, transactions: [...profile.transactions, floating] };

    expect(expectedIncomes(updated, MARCH_2026, REFERENCE)[0]!.unassigned).toBe(true);
  });

  it('« rien reçu » est une réponse, pas une absence', () => {
    const { profile, current } = tracked();
    const entry = expectedIncomes(profile, MARCH_2026, REFERENCE)[0]!;
    const zero = { ...receiptTransaction(entry, MARCH_2026, Money.zero('EUR'), current.id, REFERENCE), id: 'zéro' };
    const updated = { ...profile, transactions: [...profile.transactions, zero] };

    const after = expectedIncomes(updated, MARCH_2026, REFERENCE)[0]!;
    expect(after.receipts).toHaveLength(1);
    expect(after.amount?.isZero).toBe(true);
  });
});
