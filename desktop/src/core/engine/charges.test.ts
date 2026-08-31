import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { accountBalance, type Transaction } from '../model';
import { addMonths } from '../yearMonth';
import { MARCH_2026, account, fixedExpense, income, referenceDate, standardProfile } from '../testing/fixtures';
import { summariseAccount } from './accounts';
import { analyse } from './analysis';
import { chargeTotals, chargeTransaction, dueCharges } from './charges';

/**
 * Pointage des charges fixes.
 *
 * Le geste que l'écran propose : cocher « c'est parti » en face d'un loyer, et voir le
 * solde du compte baisser d'autant. Tout le reste — le budget, la trésorerie, le relevé —
 * s'accorde tout seul, puisque l'écriture créée est celle que tous les moteurs lisent déjà.
 */

const COURANT = () => account('Compte courant', 2000, 'checking', '2026-02-28');

describe('Ce qui est à payer ce mois-ci', () => {
  it('liste les charges du mois, toutes à cocher au départ', () => {
    const courant = COURANT();
    const profile = standardProfile({
      accounts: [courant],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [
        fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 }),
        fixedExpense('Internet', 30, 'fixed.internet', { dayOfMonth: 15 }),
      ],
      transactions: [],
    });

    const charges = dueCharges(profile, MARCH_2026, referenceDate(10));

    expect(charges.map((entry) => entry.expense.name)).toEqual(['Loyer', 'Internet']);
    expect(charges.every((entry) => !entry.paid)).toBe(true);
    expect(charges[0]!.due.equals(Money.of(800))).toBe(true);

    // Le loyer était attendu le 3, on est le 10 : il est en retard de pointage.
    expect(charges[0]!.overdue).toBe(true);
    expect(charges[1]!.overdue).toBe(false);
  });

  it('retire le montant du compte au moment où on coche', () => {
    const courant = COURANT();
    const loyer = { ...fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 }), accountId: courant.id };
    const profile = standardProfile({
      accounts: [courant],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [loyer],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(10));
    const draft = chargeTransaction(profile, entry!, MARCH_2026, entry!.due, undefined, referenceDate(10));
    const after = { ...profile, transactions: [{ ...draft, id: 'pointé' }] };

    expect(accountBalance(after, courant, referenceDate(10)).equals(Money.of(1200))).toBe(true);

    // Et la charge est maintenant cochée, sans rien avoir eu à stocker à côté.
    const [checked] = dueCharges(after, MARCH_2026, referenceDate(10));
    expect(checked!.paid).toBe(true);
    expect(checked!.payments.map((payment) => payment.id)).toEqual(['pointé']);
    expect(checked!.overdue).toBe(false);
  });

  it('date le pointage au jour du prélèvement, jamais dans le futur', () => {
    const courant = COURANT();
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 25 })],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(10));

    // Prélèvement habituel le 25, mais on coche le 10 : dater du 25 sortirait l'écriture
    // du solde d'aujourd'hui, qui ne verrait rien bouger.
    expect(chargeTransaction(profile, entry!, MARCH_2026, entry!.due, courant.id, referenceDate(10)).date).toBe('2026-03-10');
    // Le 28, l'échéance est passée : c'est bien le 25 qui compte.
    expect(chargeTransaction(profile, entry!, MARCH_2026, entry!.due, courant.id, referenceDate(28)).date).toBe('2026-03-25');
  });

  it('se remet à zéro le mois suivant, sans rien à réinitialiser', () => {
    /*
     * C'est le point qui compte : la liste n'est pas un état stocké quelque part qu'il
     * faudrait penser à vider le 1er du mois. Elle se déduit des écritures du mois
     * affiché. Un mois sans écriture est un mois où rien n'est coché — et remonter en
     * arrière remontre exactement ce qui avait été pointé à l'époque.
     */
    const courant = COURANT();
    const loyer = { ...fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 }), accountId: courant.id };
    const paid: Transaction = {
      id: 'loyer-mars',
      amount: Money.of(800),
      date: '2026-03-03',
      kind: 'expense',
      label: 'Loyer',
      category: 'fixed.rent',
      accountId: courant.id,
      recurringExpenseId: loyer.id,
    };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [loyer],
      transactions: [paid],
    });

    const march = dueCharges(profile, MARCH_2026, referenceDate(28));
    const april = dueCharges(profile, addMonths(MARCH_2026, 1), referenceDate(28, addMonths(MARCH_2026, 1)));

    expect(march[0]!.paid).toBe(true);
    expect(april[0]!.paid).toBe(false);
    expect(chargeTotals(april, 'EUR').pending).toBe(1);

    // Et mars garde sa mémoire quand on y revient.
    expect(dueCharges(profile, MARCH_2026, referenceDate(28))[0]!.paid).toBe(true);
  });

  it('signale un pointage qui ne débite aucun compte', () => {
    const courant = COURANT();
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 })],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(10));
    const floating = { ...chargeTransaction(profile, entry!, MARCH_2026, entry!.due, undefined, referenceDate(10)), id: 'flottant' };
    const after = { ...profile, transactions: [floating] };

    expect(dueCharges(after, MARCH_2026, referenceDate(10))[0]!.unassigned).toBe(true);
  });

  it('accepte un montant différent de celui prévu', () => {
    // Une facture d'électricité n'est jamais exactement celle du mois dernier.
    const courant = COURANT();
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [fixedExpense('Électricité', 90, 'fixed.electricity', { dayOfMonth: 8 })],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(10));
    const draft = chargeTransaction(profile, entry!, MARCH_2026, Money.of(117.4), courant.id, referenceDate(10));
    const after = { ...profile, transactions: [{ ...draft, id: 'réel' }] };

    const [checked] = dueCharges(after, MARCH_2026, referenceDate(10));
    expect(checked!.paid).toBe(true);
    expect(checked!.amount!.equals(Money.of(117.4))).toBe(true);
    expect(checked!.difference.equals(Money.of(27.4))).toBe(true);
    expect(accountBalance(after, courant, referenceDate(10)).equals(Money.of(1882.6))).toBe(true);
  });
});

describe('Pointer ne change rien au budget', () => {
  it('ne compte pas la charge deux fois, et ne rejoue pas l’échéance', () => {
    /*
     * L'invariant qui rend ce pointage sûr. L'écriture créée porte `recurringExpenseId` :
     * le budget la reconnaît comme la **matérialisation** d'une charge déjà déclarée, et
     * non comme une dépense de plus. Sans ce lien, cocher son loyer le ferait compter deux
     * fois — une fois comme charge, une fois comme dépense — et la trésorerie le
     * soustrairait une troisième.
     */
    const courant = account('Compte courant', 3000, 'checking', '2026-02-28');
    const loyer = { ...fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 }), accountId: courant.id };
    const profile = standardProfile({
      accounts: [courant],
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [loyer],
      transactions: [],
    });

    const before = analyse(profile, MARCH_2026, referenceDate(20));

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(20));
    const after = {
      ...profile,
      transactions: [{ ...chargeTransaction(profile, entry!, MARCH_2026, entry!.due, undefined, referenceDate(20)), id: 'pointé' }],
    };
    const summary = analyse(after, MARCH_2026, referenceDate(20));

    // Le budget est identique : le loyer était déjà compté comme charge.
    expect(summary.summary.totalExpenses.equals(before.summary.totalExpenses)).toBe(true);
    expect(summary.summary.disposable.equals(before.summary.disposable)).toBe(true);
    expect(summary.summary.variableSpentToDate.isZero).toBe(true);

    // Le compte, lui, a bougé — c'est tout l'objet du geste.
    expect(accountBalance(after, courant, referenceDate(20)).equals(Money.of(2200))).toBe(true);

    // Et la trésorerie ne resoustrait pas l'échéance du 3, déjà passée sur le compte.
    expect(summary.cashFlow.points.find((point) => point.day === 20)!.balance.equals(Money.of(2200))).toBe(true);
    expect(summary.cashFlow.projectedOverdraft).toBe(false);
  });
});

describe('Cocher fait toujours partir l’argent', () => {
  it('date le pointage du jour quand l’échéance est couverte par le relevé', () => {
    /*
     * Le cas signalé. Le relevé du compte date du 20, les charges tombent le 5 : datées du
     * 5, elles étaient réputées déjà comprises dans le solde saisi, et cocher ne faisait
     * rien bouger. La date configurée sur la charge dit quand elle **tombe d'habitude** —
     * elle ne doit pas empêcher le geste de produire son effet.
     *
     * Le pointage est donc daté du jour où on coche dès que la date habituelle serait
     * absorbée par le relevé. Dans le cas courant — un relevé antérieur au mois — rien ne
     * change : c'est bien la date d'échéance qui est retenue, plus fidèle à la réalité.
     */
    const courant = account('Compte courant', 3447, 'checking', '2026-03-20');
    const loyer = { ...fixedExpense('Loyer', 1088, 'fixed.rent', { dayOfMonth: 5 }), accountId: courant.id };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [loyer],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(28));
    const draft = chargeTransaction(profile, entry!, MARCH_2026, entry!.due, undefined, referenceDate(28));

    expect(draft.date).toBe('2026-03-28');

    const after = { ...profile, transactions: [{ ...draft, id: 'pointé' }] };
    expect(accountBalance(after, courant, referenceDate(28)).equals(Money.of(2359))).toBe(true);
    expect(dueCharges(after, MARCH_2026, referenceDate(28))[0]!.alreadyInStatement).toBe(false);
  });

  it('garde la date d’échéance quand elle produit déjà son effet', () => {
    // Relevé antérieur au mois : la date réelle du prélèvement est plus fidèle, et elle
    // fait bien baisser le solde. Aucune raison de la remplacer.
    const courant = account('Compte courant', 3447, 'checking', '2026-02-28');
    const loyer = { ...fixedExpense('Loyer', 1088, 'fixed.rent', { dayOfMonth: 5 }), accountId: courant.id };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [loyer],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(28));
    const draft = chargeTransaction(profile, entry!, MARCH_2026, entry!.due, undefined, referenceDate(28));

    expect(draft.date).toBe('2026-03-05');
    const after = { ...profile, transactions: [{ ...draft, id: 'pointé' }] };
    expect(accountBalance(after, courant, referenceDate(28)).equals(Money.of(2359))).toBe(true);
  });

  it('suit le compte de repli quand la charge n’en désigne aucun', () => {
    const courant = account('Compte courant', 3447, 'checking', '2026-03-20');
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [fixedExpense('Loyer', 1088, 'fixed.rent', { dayOfMonth: 5 })],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(28));
    expect(chargeTransaction(profile, entry!, MARCH_2026, entry!.due, courant.id, referenceDate(28)).date).toBe(
      '2026-03-28',
    );
  });
});

describe('Quand le solde de départ contient déjà la charge', () => {
  /*
   * Le cas de la mise en route, et donc le cas le plus fréquent : on installe
   * l'application le 31, on saisit « le solde d'aujourd'hui », puis on pointe les charges
   * du mois. Elles sont datées du 5 — antérieures au relevé — donc déjà comprises dans le
   * montant saisi. Les soustraire une seconde fois ferait afficher moins d'argent que la
   * banque n'en montre.
   *
   * L'arithmétique était juste, mais l'écran promettait « le solde baisse d'autant » et
   * annonçait ensuite « Sorti −0,00 € » sur un mois où 1 780 € étaient sortis. C'était le
   * compte rendu qui mentait, pas le calcul.
   */
  function pointedProfile() {
    const courant = account('Compte courant', 3447, 'checking', '2026-03-31');
    const charges = [
      { name: 'appartement', amount: 1088 },
      { name: 'basic-fit', amount: 35 },
      { name: 'voiture', amount: 295 },
      { name: 'engie', amount: 72 },
      { name: 'assurance', amount: 43 },
      { name: 'proximus', amount: 247 },
    ].map((entry) => ({
      ...fixedExpense(entry.name, entry.amount, 'fixed.otherFixed', { dayOfMonth: 5 }),
      accountId: courant.id,
    }));

    const transactions: Transaction[] = charges.map((expense, index) => ({
      id: `pointé-${index}`,
      amount: expense.amount,
      date: '2026-03-05',
      kind: 'expense',
      label: expense.name,
      category: 'fixed.otherFixed',
      accountId: courant.id,
      recurringExpenseId: expense.id,
    }));

    return {
      courant,
      profile: standardProfile({
        accounts: [courant],
        incomes: [income('Salaire', 3000)],
        recurringExpenses: charges,
        transactions,
      }),
    };
  }

  it('ne soustrait pas une deuxième fois ce que le relevé contenait déjà', () => {
    const { courant, profile } = pointedProfile();
    // 3 447 € saisis le 31 : c'est ce que la banque affiche, loyer déjà parti.
    expect(accountBalance(profile, courant, referenceDate(31)).equals(Money.of(3447))).toBe(true);
  });

  it('dit quand même ce qui est sorti du mois', () => {
    const { courant, profile } = pointedProfile();
    const summary = summariseAccount(profile, courant, MARCH_2026, referenceDate(31));

    // 1 088 + 35 + 295 + 72 + 43 + 247 : le mois a bien vu partir cet argent.
    expect(summary.debited.equals(Money.of(1780))).toBe(true);
    // Et la carte peut expliquer pourquoi le solde n'a pas bougé pour autant.
    expect(summary.beforeStatement.equals(Money.of(1780))).toBe(true);
  });

  it('marque la charge comme déjà comprise dans le solde', () => {
    const { profile } = pointedProfile();
    const charges = dueCharges(profile, MARCH_2026, referenceDate(31));

    expect(charges.every((entry) => entry.paid)).toBe(true);
    expect(charges.every((entry) => entry.alreadyInStatement)).toBe(true);
  });

  it('ne le dit pas quand le pointage a réellement bougé le solde', () => {
    const courant = account('Compte courant', 3447, 'checking', '2026-02-28');
    const loyer = { ...fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 5 }), accountId: courant.id };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [loyer],
      transactions: [
        {
          id: 'pointé',
          amount: Money.of(800),
          date: '2026-03-05',
          kind: 'expense',
          label: 'Loyer',
          category: 'fixed.rent',
          accountId: courant.id,
          recurringExpenseId: loyer.id,
        },
      ],
    });

    expect(dueCharges(profile, MARCH_2026, referenceDate(20))[0]!.alreadyInStatement).toBe(false);
    expect(accountBalance(profile, courant, referenceDate(20)).equals(Money.of(2647))).toBe(true);
    expect(summariseAccount(profile, courant, MARCH_2026, referenceDate(20)).beforeStatement.isZero).toBe(true);
  });
});

describe('Charges non mensuelles', () => {
  it('pointe une assurance annuelle pour son montant réel, pas pour un douzième', () => {
    /*
     * Le budget lisse une assurance de 1 200 € à 100 €/mois — c'est ce qu'il faut pour
     * planifier. Mais le jour où elle est prélevée, la banque retire 1 200 €. Débiter le
     * douzième ferait dériver le solde suivi de celui du compte réel.
     */
    const courant = account('Compte courant', 5000, 'checking', '2026-02-28');
    const assurance = {
      ...fixedExpense('Assurance habitation', 1200, 'fixed.insurance', { frequency: 'annual', dayOfMonth: 10 }),
      accountId: courant.id,
    };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [assurance],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(15));
    expect(entry!.due.equals(Money.of(1200))).toBe(true);

    const after = {
      ...profile,
      transactions: [{ ...chargeTransaction(profile, entry!, MARCH_2026, entry!.due, undefined, referenceDate(15)), id: 'assur' }],
    };
    expect(accountBalance(after, courant, referenceDate(15)).equals(Money.of(3800))).toBe(true);
  });

  it('ne la repropose pas chaque mois une fois qu’elle est payée', () => {
    const courant = account('Compte courant', 5000, 'checking', '2026-02-28');
    const assurance = {
      ...fixedExpense('Assurance habitation', 1200, 'fixed.insurance', { frequency: 'annual', dayOfMonth: 10 }),
      accountId: courant.id,
    };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [assurance],
      transactions: [
        {
          id: 'assur',
          amount: Money.of(1200),
          date: '2026-03-10',
          kind: 'expense',
          label: 'Assurance habitation',
          category: 'fixed.insurance',
          accountId: courant.id,
          recurringExpenseId: assurance.id,
        },
      ],
    });

    // Avril, mai, juin : l'échéance annuelle est derrière, la ligne disparaît de la liste.
    for (const offset of [1, 2, 6]) {
      const month = addMonths(MARCH_2026, offset);
      expect(dueCharges(profile, month, referenceDate(28, month))).toHaveLength(0);
    }

    // Un an plus tard, elle revient.
    const nextYear = addMonths(MARCH_2026, 12);
    expect(dueCharges(profile, nextYear, referenceDate(28, nextYear))).toHaveLength(1);
  });

  it('regroupe un prélèvement hebdomadaire en une ligne mensuelle', () => {
    const courant = COURANT();
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [fixedExpense('Cantine', 25, 'fixed.otherFixed', { frequency: 'weekly', dayOfMonth: 5 })],
      transactions: [],
    });

    const [entry] = dueCharges(profile, MARCH_2026, referenceDate(28));
    // 25 € × 52 ÷ 12 : le total du mois, en une seule case à cocher.
    expect(entry!.due.roundedTo(2).equals(Money.of(108.33))).toBe(true);
  });
});

describe('Compte du pointage', () => {
  it('résume ce qui est parti et ce qui reste à pointer', () => {
    const courant = COURANT();
    const loyer = { ...fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 }), accountId: courant.id };
    const profile = standardProfile({
      accounts: [courant],
      recurringExpenses: [loyer, fixedExpense('Internet', 30, 'fixed.internet', { dayOfMonth: 15 })],
      transactions: [
        {
          id: 'loyer-mars',
          amount: Money.of(800),
          date: '2026-03-03',
          kind: 'expense',
          label: 'Loyer',
          category: 'fixed.rent',
          accountId: courant.id,
          recurringExpenseId: loyer.id,
        },
      ],
    });

    const totals = chargeTotals(dueCharges(profile, MARCH_2026, referenceDate(20)), 'EUR');

    expect(totals.due.equals(Money.of(830))).toBe(true);
    expect(totals.paid.equals(Money.of(800))).toBe(true);
    expect(totals.remaining.equals(Money.of(30))).toBe(true);
    expect(totals.pending).toBe(1);
  });
});
