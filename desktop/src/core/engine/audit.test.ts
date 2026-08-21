import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import {
  DEFAULT_ALLOCATION_TARGETS,
  ALLOCATION_PARTS,
  allocationTotal,
  accountBalance,
  detachAccount,
  netWorth,
  rebalanceAllocation,
  type Transaction,
} from '../model';
import { addMonths, dateOf, formatDate, lastMonths } from '../yearMonth';
import {
  MARCH_2026,
  account,
  expense,
  fixedExpense,
  income,
  referenceDate,
  savingsAccount,
  standardProfile,
} from '../testing/fixtures';
import { analyse } from './analysis';
import { monthlySummary } from './budget';
import { accountMovements, overviewAccounts, summariseAccount } from './accounts';
import { importCsv } from './csv';
import { canIAfford } from './affordability';
import { compareSpending } from './comparison';
import { optimize } from './optimization';
import { expectedIncomes, receiptTotals } from './receipts';

/**
 * Régressions issues de l'audit.
 *
 * Chaque cas de ce fichier a d'abord été écrit pour **échouer** : il reproduit un défaut
 * constaté, avec des valeurs vérifiables à la main. Le garder ici après correction est ce
 * qui empêche le défaut de revenir — un audit dont il ne reste qu'un rapport se refait
 * entièrement au bout de six mois.
 */

describe('Trésorerie — les charges déjà payées ne sont pas décomptées deux fois', () => {
  it('ne rejoue pas une échéance dont la transaction est déjà enregistrée', () => {
    /*
     * La simulation démarre au solde d'aujourd'hui, qui contient déjà le loyer prélevé le
     * 3. Le rejouer depuis le 1er le soustrait une seconde fois, et l'application annonce
     * un découvert à quelqu'un dont le compte est sain — le pire faux positif possible,
     * et il frappe précisément l'utilisateur assidu qui saisit ses dépenses.
     */
    const courant = account('Compte courant', 3000, 'checking', '2026-02-28');
    const loyer = fixedExpense('Loyer', 1200, 'fixed.rent', { dayOfMonth: 3 });
    const paid: Transaction = {
      id: 'loyer-mars',
      amount: Money.of(1200),
      date: '2026-03-03',
      kind: 'expense',
      label: 'Loyer',
      category: 'fixed.rent',
      accountId: courant.id,
      recurringExpenseId: loyer.id,
    };

    const profile = standardProfile({
      accounts: [courant],
      incomes: [income('Salaire', 2000)],
      recurringExpenses: [loyer],
      transactions: [paid],
    });

    const { cashFlow } = analyse(profile, MARCH_2026, referenceDate(20));

    // 3 000 − 1 200 déjà passés = 1 800 aujourd'hui ; le loyer ne repart pas une 2ᵉ fois.
    expect(accountBalance(profile, courant, referenceDate(20)).equals(Money.of(1800))).toBe(true);
    expect(cashFlow.points.find((point) => point.day === 20)!.balance.equals(Money.of(1800))).toBe(true);
    expect(cashFlow.projectedOverdraft).toBe(false);
  });
});

describe('Budget — le variable constaté s’arrête à aujourd’hui', () => {
  it('n’extrapole pas une dépense datée plus tard dans le mois', () => {
    /*
     * Une dépense saisie d'avance au 20 ne peut pas servir à mesurer le rythme des six
     * premiers jours : multipliée par 31/6, elle transforme 500 € en 2 583 € et fait
     * basculer le budget en déficit imaginaire.
     */
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [],
      transactions: [
        {
          id: 'passe',
          amount: Money.of(200),
          date: '2026-03-03',
          kind: 'expense',
          label: 'Courses',
          category: 'variable.groceries',
        },
        {
          id: 'futur',
          amount: Money.of(500),
          date: '2026-03-20',
          kind: 'expense',
          label: 'Achat prévu',
          category: 'variable.clothing',
        },
      ],
    });

    const summary = monthlySummary(profile, MARCH_2026, referenceDate(6));

    // Constaté à date : 200 € seulement. Les 500 € du 20 ne sont pas encore dépensés.
    expect(summary.variableSpentToDate.equals(Money.of(200))).toBe(true);
    expect(summary.disposable.isNegative).toBe(false);
  });
});

describe('Répartition — les parts ne dépassent jamais 100 %', () => {
  it('ne produit aucune part négative, quel que soit le curseur déplacé', () => {
    // Balayage exhaustif au demi-point près : c'est le seul moyen d'attraper les
    // combinaisons où les arrondis des trois premières parts dépassent le solde.
    const bases = [
      DEFAULT_ALLOCATION_TARGETS,
      { enabled: true, security: 0, savings: 0.5, investment: 0.5, free: 0 },
      { enabled: true, security: 0.33, savings: 0.33, investment: 0.17, free: 0.17 },
      { enabled: true, security: 1, savings: 0, investment: 0, free: 0 },
    ];

    for (const base of bases) {
      for (const part of ALLOCATION_PARTS) {
        for (let percent = 0; percent <= 100; percent += 1) {
          const moved = rebalanceAllocation(base, part, percent / 100);
          for (const key of ALLOCATION_PARTS) {
            expect(moved[key], `${part}→${percent}% donne ${key}=${moved[key]}`).toBeGreaterThanOrEqual(0);
          }
          expect(allocationTotal(moved)).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('n’attribue jamais plus que le disponible', () => {
    const profile = standardProfile({
      preferences: {
        ...standardProfile().preferences,
        allocationTargets: { enabled: true, security: 0, savings: 0.5, investment: 0.5, free: 0 },
      },
    });
    const { allocation } = analyse(profile, MARCH_2026, referenceDate(28));

    expect(allocation.allocated.greaterThan(allocation.disposable)).toBe(false);
  });
});

describe('Relevé de compte — un seul solde par compte', () => {
  it('accorde le relevé et la tuile quand la date de relevé tombe dans le mois affiché', () => {
    /*
     * C'est le cas normal après la mise en route : « saisissez le solde d'aujourd'hui »
     * pose une date de relevé en plein mois. Le relevé repartait alors du 1er et rejouait
     * des mouvements déjà compris dans le solde — deux chiffres différents pour le même
     * compte, sur le même écran.
     */
    const courant = account('Compte courant', 1000, 'checking', '2026-03-15');
    const profile = standardProfile({
      accounts: [courant],
      transactions: [
        {
          id: 'avant',
          amount: Money.of(100),
          date: '2026-03-05',
          kind: 'expense',
          label: 'Avant le relevé',
          category: 'variable.groceries',
          accountId: courant.id,
        },
        {
          id: 'apres',
          amount: Money.of(50),
          date: '2026-03-20',
          kind: 'expense',
          label: 'Après le relevé',
          category: 'variable.groceries',
          accountId: courant.id,
        },
      ],
    });

    const summary = summariseAccount(profile, courant, MARCH_2026, referenceDate(28));
    const movements = accountMovements(profile, courant, MARCH_2026);

    expect(summary.balance.equals(Money.of(950))).toBe(true);
    expect(movements.at(-1)!.balanceAfter.equals(summary.balance)).toBe(true);
    // La dépense antérieure au relevé est déjà comprise dedans : elle n'est pas rejouée.
    expect(movements.map((entry) => entry.transaction.id)).toEqual(['apres']);
    expect(summary.debited.equals(Money.of(50))).toBe(true);
  });
});

describe('Import de relevé — un débit reste un débit', () => {
  it('ne prend pas une colonne crédit à zéro pour un revenu', () => {
    // Beaucoup de relevés français remplissent les deux colonnes, dont l'une à « 0,00 ».
    const csv = ['Date;Libellé;Débit;Crédit', '05/03/2026;CARREFOUR;45,00;0,00'].join('\n');
    const result = importCsv(csv, 'EUR');

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.kind).toBe('expense');
  });

  it('reconnaît toujours un vrai crédit', () => {
    const csv = ['Date;Libellé;Débit;Crédit', '27/03/2026;VIREMENT SALAIRE;0,00;2500,00'].join('\n');
    const result = importCsv(csv, 'EUR');

    expect(result.transactions[0]!.kind).toBe('income');
    expect(result.transactions[0]!.amount.equals(Money.of(2500))).toBe(true);
  });
});

describe('Patrimoine — une ligne de portefeuille ne compte qu’une fois', () => {
  it('ne double pas un placement rattaché à un compte qui n’est pas de type placement', () => {
    /*
     * Le compte peut être requalifié après coup dans les Réglages. Si l'exclusion ne
     * regarde que les comptes de type « placement », la ligne s'ajoute au solde du livret
     * au lieu de le remplacer, et le patrimoine double.
     */
    const livret = savingsAccount(10000);
    const profile = standardProfile({
      accounts: [livret],
      transactions: [],
      holdings: [
        {
          id: 'h1',
          name: 'ETF monde',
          assetClass: 'etf',
          invested: Money.of(10000),
          currentValue: Money.of(10000),
          valuedOn: '2026-03-02',
          accountId: livret.id,
        },
      ],
    });

    expect(netWorth(profile, referenceDate(28)).equals(Money.of(10000))).toBe(true);
  });
});

describe('Suppression d’un compte — aucune écriture ne devient invisible', () => {
  it('détache tout ce qui pointait vers le compte supprimé', () => {
    /*
     * Supprimer un compte laissait derrière lui des écritures pointant vers un
     * identifiant mort : plus comptées dans aucun solde, et pas davantage listées dans
     * « Écritures sans compte », qui ne détectait que l'absence totale de compte. L'argent
     * disparaissait du suivi sans un mot.
     */
    const courant = account('Compte courant', 1000);
    const livret = savingsAccount(5000);
    const salaire = { ...income('Salaire', 2000), accountId: courant.id };

    const profile = standardProfile({
      accounts: [courant, livret],
      incomes: [salaire],
      recurringExpenses: [],
      transactions: [
        { ...expense(100, 'variable.groceries', 5), id: 'depense', accountId: courant.id },
        {
          id: 'virement',
          amount: Money.of(200),
          date: '2026-03-10',
          kind: 'transfer',
          label: 'Vers le livret',
          accountId: courant.id,
          toAccountId: livret.id,
        },
      ],
      holdings: [
        {
          id: 'h1',
          name: 'ETF',
          assetClass: 'etf',
          invested: Money.of(100),
          currentValue: Money.of(100),
          valuedOn: '2026-03-02',
          accountId: courant.id,
        },
      ],
      preferences: { ...standardProfile().preferences, allocationAccounts: { savings: courant.id } },
    });

    const after = detachAccount(profile, courant.id);

    expect(after.accounts.map((entry) => entry.id)).toEqual([livret.id]);
    expect(after.transactions.every((entry) => entry.accountId !== courant.id)).toBe(true);
    expect(after.transactions.every((entry) => entry.toAccountId !== courant.id)).toBe(true);
    expect(after.incomes[0]!.accountId).toBeUndefined();
    expect(after.holdings[0]!.accountId).toBeUndefined();
    expect(after.preferences.allocationAccounts.savings).toBeUndefined();

    // Le virement garde sa destination : seul le côté supprimé est détaché.
    expect(after.transactions.find((entry) => entry.id === 'virement')!.toAccountId).toBe(livret.id);
  });

  it('signale une écriture pointant vers un compte qui n’existe plus', () => {
    // Pour les profils déjà dans cet état : la détection ne peut pas se contenter de
    // l'absence de compte, elle doit vérifier que le compte désigné existe.
    const livret = savingsAccount(5000);
    const profile = standardProfile({
      accounts: [livret],
      recurringExpenses: [],
      transactions: [{ ...expense(100, 'variable.groceries', 5), id: 'orpheline', accountId: 'compte-supprimé' }],
    });

    const overview = overviewAccounts(profile, MARCH_2026, referenceDate(28));
    expect(overview.unassigned.map((entry) => entry.id)).toContain('orpheline');
  });
});

describe('« Ce qui reste » — une seule définition par question posée', () => {
  it('répond « puis-je me le permettre » avec l’arithmétique du budget, enveloppes comprises', () => {
    /*
     * Deux écrans annonçaient « ce qu'il vous reste » sous le même libellé, et deux
     * montants différents : l'un retranchait ce qui était déjà dépensé, l'autre une
     * extrapolation du mois entier. Écart mesuré : 1 700 € contre 1 380 €.
     *
     * Les deux questions sont légitimes et distinctes — « combien puis-je encore dépenser
     * aujourd'hui » n'est pas « que restera-t-il une fois le mois vécu ». Ce qui ne l'est
     * pas, c'est de les calculer chacune dans son coin, et de les nommer pareil. Chacune a
     * désormais son nom et une définition unique, portée par le budget.
     */
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [fixedExpense('Loyer', 1000, 'fixed.rent')],
      transactions: [expense(200, 'variable.groceries', 3)],
      categoryBudgets: [{ category: 'variable.groceries', limit: Money.of(600) }],
    });

    const { summary, emergencyFund, cashFlow } = analyse(profile, MARCH_2026, referenceDate(10));
    const answer = canIAfford(Money.zero('EUR'), summary, emergencyFund, cashFlow, Money.zero('EUR'));

    // L'enveloppe déclarée fait foi : 600 € réservés pour les courses, pas 620 € extrapolés.
    expect(summary.discretionaryLeft.equals(Money.of(1400))).toBe(true);
    expect(answer.remainingAfter.equals(summary.discretionaryLeft)).toBe(true);

    // Et « reste à vivre » répond à l'autre question : 3 000 − 1 000 − 200 déjà dépensés.
    expect(summary.remainingToSpend.equals(Money.of(1800))).toBe(true);
  });
});

describe('Fonds d’urgence — une cible qui ne bouge pas avec la saisie', () => {
  it('annonce le même objectif au 5 et au 25 du mois', () => {
    /*
     * La cible se calculait sur les dépenses essentielles **constatées à date**. Elle
     * grandissait donc au fil des courses saisies : de 8 700 € en début de mois à
     * 10 500 € à la fin, assez pour faire basculer le voyant de santé du vert à l'orange
     * sans qu'aucune décision financière n'ait été prise. Un objectif d'épargne qui bouge
     * chaque jour n'est pas un objectif.
     */
    const history = lastMonths(addMonths(MARCH_2026, -1), 3).map((month, index) => ({
      ...expense(400, 'variable.groceries', 10, month),
      id: `courses-${index}`,
    }));
    const base = standardProfile({
      accounts: [account('Compte courant', 3000), savingsAccount(2000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [fixedExpense('Loyer', 1000, 'fixed.rent')],
      transactions: history,
    });

    const early = analyse(
      { ...base, transactions: [...history, expense(100, 'variable.groceries', 3)] },
      MARCH_2026,
      referenceDate(5),
    ).emergencyFund;
    const late = analyse(
      { ...base, transactions: [...history, expense(400, 'variable.groceries', 3)] },
      MARCH_2026,
      referenceDate(25),
    ).emergencyFund;

    // 1 000 € de loyer + 400 € de courses en médiane sur trois mois complets.
    expect(early.monthlyNeed.equals(Money.of(1400))).toBe(true);
    expect(late.monthlyNeed.equals(early.monthlyNeed)).toBe(true);
    expect(late.target.equals(early.target)).toBe(true);
  });
});

describe('Comparaison — la même comptabilité que le reste de l’application', () => {
  it('ne dépend pas de la diligence avec laquelle les charges ont été pointées', () => {
    /*
     * L'écran Comparaison était le seul à additionner les matérialisations de charges
     * récurrentes. Un loyer pointé en mars et oublié en février produisait « Loyer :
     * +800 € » — un dérapage qui n'existe pas, causé par un pointage, pas par une
     * dépense. Et le total du mois s'écartait de celui du Budget sur le même écran.
     */
    const loyer = fixedExpense('Loyer', 800, 'fixed.rent', { dayOfMonth: 3 });
    const pointed: Transaction = {
      id: 'loyer-mars',
      amount: Money.of(800),
      date: '2026-03-03',
      kind: 'expense',
      label: 'Loyer',
      category: 'fixed.rent',
      recurringExpenseId: loyer.id,
    };

    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [loyer],
      transactions: [
        pointed,
        expense(300, 'variable.groceries', 10),
        // Février : des courses saisies, mais le loyer non pointé.
        { ...expense(300, 'variable.groceries', 10, addMonths(MARCH_2026, -1)), id: 'courses-fevrier' },
      ],
    });

    const comparison = compareSpending(profile, MARCH_2026, 'previousMonth');
    const rent = comparison.categories.find((entry) => entry.category === 'fixed.rent');

    expect(rent?.current.equals(Money.of(800))).toBe(true);
    expect(rent?.reference.equals(Money.of(800))).toBe(true);
    expect(rent?.delta.isZero).toBe(true);

    // Et le total s'accorde avec celui que le Budget affiche pour le même mois.
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(28));
    const budgeted = Money.sum(summary.categoryTotals.map((entry) => entry.amount), 'EUR');
    expect(comparison.currentTotal.equals(budgeted)).toBe(true);
  });

  it('dit sur combien de mois la moyenne porte réellement', () => {
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      recurringExpenses: [],
      transactions: [
        expense(300, 'variable.groceries', 10),
        { ...expense(200, 'variable.groceries', 10, addMonths(MARCH_2026, -1)), id: 'un-seul-mois' },
      ],
    });

    const comparison = compareSpending(profile, MARCH_2026, 'threeMonths');

    expect(comparison.monthsObserved).toBe(1);
    expect(comparison.windowMonths).toBe(3);
    // Annoncer « Moyenne 3 mois » sur un seul mois saisi serait faux.
    expect(comparison.label).not.toBe('Moyenne 3 mois');
    expect(comparison.label).toContain('1 mois');
  });
});

describe('Historique — un mois passé se calcule avec les charges de ce mois-là', () => {
  it('ne fait pas apparaître dans mars une charge qui commence en juin', () => {
    /*
     * Les dates de début et de fin d'une charge existaient, mais étaient toujours
     * évaluées à la date du jour : quel que soit le mois affiché, c'était la liste des
     * charges d'aujourd'hui qui servait. Conséquence directe : impossible d'enregistrer
     * une hausse de loyer sans réécrire tout le passé, puisque clore l'ancienne charge et
     * en ouvrir une nouvelle ne changeait rien à ce qui était affiché.
     */
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [
        { ...fixedExpense('Loyer', 800, 'fixed.rent'), endDate: '2026-05-31' },
        { ...fixedExpense('Loyer augmenté', 900, 'fixed.rent'), startDate: '2026-06-01' },
      ],
      transactions: [],
    });

    // Vu depuis juillet — le mois de mars ne connaît que l'ancien loyer.
    const july = referenceDate(10, addMonths(MARCH_2026, 4));
    expect(monthlySummary(profile, MARCH_2026, july).fixedExpenses.equals(Money.of(800))).toBe(true);
    expect(monthlySummary(profile, addMonths(MARCH_2026, 4), july).fixedExpenses.equals(Money.of(900))).toBe(true);
  });

  it('garde une charge close en cours de mois pour le mois qu’elle a couvert', () => {
    // Un abonnement résilié le 12 mars a bien été payé en mars.
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [{ ...fixedExpense('Streaming', 30, 'fixed.subscriptions'), endDate: '2026-03-12' }],
      transactions: [],
    });

    expect(monthlySummary(profile, MARCH_2026, referenceDate(28)).fixedExpenses.equals(Money.of(30))).toBe(true);
    expect(
      monthlySummary(profile, addMonths(MARCH_2026, 1), referenceDate(28)).fixedExpenses.isZero,
    ).toBe(true);
  });

  it('ne compte pas un revenu qui n’avait pas encore commencé', () => {
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [{ ...income('Nouveau poste', 3000), startDate: '2026-06-01' }],
      recurringExpenses: [],
      transactions: [],
    });

    const july = referenceDate(10, addMonths(MARCH_2026, 4));
    expect(monthlySummary(profile, MARCH_2026, july).income.isZero).toBe(true);
    expect(monthlySummary(profile, addMonths(MARCH_2026, 4), july).income.equals(Money.of(3000))).toBe(true);
  });
});

describe('Revenus — un encaissement complète l’attente, il ne la remplace pas', () => {
  function received(amount: number, day: number, sourceId: string, period = MARCH_2026): Transaction {
    return {
      id: `recu-${sourceId}-${day}`,
      amount: Money.of(amount),
      date: formatDate(dateOf(period, day)),
      kind: 'income',
      label: 'Virement',
      incomeSourceId: sourceId,
    };
  }

  it('ne ramène pas un salaire de 3 000 € à 1 500 € parce qu’un acompte est saisi', () => {
    /*
     * Saisir un acompte faisait tomber le revenu du mois au montant de l'acompte, et le
     * disponible avec lui : l'application annonçait un budget en déficit à quelqu'un dont
     * le salaire arrive dans huit jours. Le geste le plus naturel — noter ce qui vient
     * d'arriver sur le compte — était puni.
     */
    const salaire = income('Salaire', 3000);
    const profile = standardProfile({
      accounts: [account('Compte courant', 2000)],
      incomes: [salaire],
      recurringExpenses: [],
      transactions: [received(1500, 10, salaire.id)],
    });

    const summary = monthlySummary(profile, MARCH_2026, referenceDate(12));

    expect(summary.income.equals(Money.of(3000))).toBe(true);
    expect(summary.incomeDetail.received.equals(Money.of(1500))).toBe(true);
  });

  it('retient le montant réel quand il dépasse l’attente', () => {
    const salaire = income('Salaire', 3000);
    const profile = standardProfile({
      accounts: [account('Compte courant', 2000)],
      incomes: [salaire],
      recurringExpenses: [],
      transactions: [received(3200, 27, salaire.id)],
    });

    const summary = monthlySummary(profile, MARCH_2026, referenceDate(28));
    expect(summary.income.equals(Money.of(3200))).toBe(true);
  });

  it('propose de compléter un acompte au lieu de le tenir pour soldé', () => {
    const salaire = income('Salaire', 3000);
    const profile = standardProfile({
      accounts: [account('Compte courant', 2000)],
      incomes: [salaire],
      transactions: [received(1500, 10, salaire.id), received(1500, 27, salaire.id)],
    });

    const [entry] = expectedIncomes(profile, MARCH_2026, referenceDate(28));

    // Les deux versements comptent : ne lire que le premier laissait le mois
    // éternellement à moitié encaissé.
    expect(entry!.receipts).toHaveLength(2);
    expect(entry!.amount!.equals(Money.of(3000))).toBe(true);
    expect(entry!.remaining.isZero).toBe(true);
    expect(receiptTotals([entry!], 'EUR').pending).toBe(0);
  });

  it('ne compte pas trois fois un revenu trimestriel encaissé', () => {
    /*
     * Un revenu trimestriel de 3 000 € vaut 1 000 €/mois une fois lissé. Saisir
     * l'encaissement le portait à 3 000 € pour le mois qui le reçoit, sans rien retirer
     * aux deux autres : le trimestre en annonçait 5 000.
     */
    const prime = income('Prime trimestrielle', 3000, 'quarterly');
    const profile = standardProfile({
      accounts: [account('Compte courant', 2000)],
      incomes: [prime],
      recurringExpenses: [],
      transactions: [received(3000, 5, prime.id)],
    });

    const quarter = [MARCH_2026, addMonths(MARCH_2026, 1), addMonths(MARCH_2026, 2)].map(
      (month) => monthlySummary(profile, month, referenceDate(28)).income,
    );

    expect(quarter[0]!.equals(Money.of(1000))).toBe(true);
    expect(Money.sum(quarter, 'EUR').equals(Money.of(3000))).toBe(true);
  });
});

describe('Optimisation — une même économie ne se compte qu’une fois', () => {
  /** Six mois à 200 € de restaurants, puis un mois à 600 €. */
  function restaurantHistory(): Transaction[] {
    return lastMonths(addMonths(MARCH_2026, -1), 6).map((month, index) => ({
      id: `resto-${index}`,
      amount: Money.of(200),
      date: formatDate(dateOf(month, 10)),
      kind: 'expense' as const,
      label: 'Restaurant',
      category: 'variable.restaurants' as const,
    }));
  }

  it('n’annonce pas 580 € d’économies sur un poste qui en coûte 600', () => {
    /*
     * Deux pistes visaient la même catégorie et s'additionnaient : « revenir à votre
     * habitude » libérait 400 €, « réduire ce poste discrétionnaire de 30 % » en libérait
     * 180 de plus. Total annoncé : 580 € sur un poste de 600 € — soit une réduction de
     * 97 % présentée comme tenable.
     *
     * Les deux pistes mènent au même argent : la plus généreuse fait foi, elles ne
     * s'ajoutent pas.
     */
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [],
      transactions: [...restaurantHistory(), expense(600, 'variable.restaurants', 10)],
    });

    const summary = monthlySummary(profile, MARCH_2026, referenceDate(28));
    const result = optimize(profile, summary, MARCH_2026, referenceDate(28));

    const onRestaurants = result.suggestions.filter((entry) => entry.category === 'variable.restaurants');
    const claimed = Money.sum(onRestaurants.map((entry) => entry.monthlySaving), 'EUR');

    expect(claimed.equals(Money.of(400))).toBe(true);
    expect(claimed.greaterThan(Money.of(600))).toBe(false);
  });

  it('ne prend pas une charge récurrente pour un dérapage de comportement', () => {
    /*
     * L'habitude était mesurée sur les seules dépenses ponctuelles, mais le mois en cours
     * y ajoutait les charges récurrentes de la même catégorie. Un abonnement de salle de
     * sport inchangé depuis un an suffisait donc à déclencher « Loisirs : 50 % au-dessus
     * de votre habitude » — et à proposer d'économiser une somme qui n'est pas libre.
     */
    const history: Transaction[] = lastMonths(addMonths(MARCH_2026, -1), 6).map((month, index) => ({
      id: `loisir-${index}`,
      amount: Money.of(100),
      date: formatDate(dateOf(month, 10)),
      kind: 'expense' as const,
      label: 'Cinéma',
      category: 'variable.leisure' as const,
    }));

    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [fixedExpense('Salle de sport', 50, 'variable.leisure')],
      transactions: [...history, expense(100, 'variable.leisure', 10)],
    });

    const summary = monthlySummary(profile, MARCH_2026, referenceDate(28));
    const result = optimize(profile, summary, MARCH_2026, referenceDate(28));

    // Rien n'a changé dans le comportement : aucune dérive à signaler.
    expect(result.suggestions.some((entry) => entry.kind === 'categoryAboveHabit')).toBe(false);

    // Et la piste discrétionnaire porte sur les 100 € réellement libres, pas sur 150.
    const discretionary = result.suggestions.find((entry) => entry.kind === 'discretionarySpending');
    expect(discretionary?.monthlySaving.equals(Money.of(30))).toBe(true);
  });
});

describe('Enveloppes — une catégorie fixe n’est pas comptée deux fois', () => {
  it('ne réserve pas un plafond posé sur une charge déjà récurrente', () => {
    const profile = standardProfile({
      accounts: [account('Compte courant', 3000)],
      incomes: [income('Salaire', 3000)],
      recurringExpenses: [fixedExpense('Loyer', 900, 'fixed.rent')],
      transactions: [],
      categoryBudgets: [{ category: 'fixed.rent', limit: Money.of(900) }],
    });

    const summary = monthlySummary(profile, MARCH_2026, referenceDate(15));

    expect(summary.fixedExpenses.equals(Money.of(900))).toBe(true);
    expect(summary.totalExpenses.equals(Money.of(900))).toBe(true);
    expect(summary.disposable.equals(Money.of(2100))).toBe(true);
  });
});
