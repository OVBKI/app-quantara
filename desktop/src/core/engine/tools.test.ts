import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile } from '../model';
import {
  MARCH_2026,
  debt as makeDebt,
  expense,
  fixedExpense,
  income,
  referenceDate,
  standardProfile,
} from '../testing/fixtures';
import { monthlySummary } from './budget';
import { analyse } from './analysis';
import { optimize } from './optimization';
import { inRealTerms, monthsToReach, project, scenarios } from './simulation';
import { canIAfford } from './affordability';
import { buildMonthlyReport } from './monthlyReport';
import { categorize, detectRecurrences, normalize } from './categorizer';
import { detectSeparator, exportCsv, importCsv, parseAmountField, parseDateField, splitLine } from './csv';
import { ask } from '../advisor/advisor';
import { addMonths, formatDate, dateOf } from '../yearMonth';

const TODAY = referenceDate(31);

describe('Optimisation', () => {
  it('compare l’utilisateur à ses propres mois, pas à une moyenne', () => {
    // Trois mois à 300 € de courses, puis 500 € : une dérive de 67 %.
    const history = [1, 2, 3].flatMap((offset) => {
      const month = addMonths(MARCH_2026, -offset);
      return [expense(300, 'variable.groceries', 10, month)];
    });
    const profile = standardProfile({
      transactions: [...history, expense(500, 'variable.groceries', 10)],
    });
    const summary = monthlySummary(profile, MARCH_2026, TODAY);
    const result = optimize(profile, summary, MARCH_2026, TODAY);

    const drift = result.suggestions.find((entry) => entry.kind === 'categoryAboveHabit');
    expect(drift).toBeDefined();
    expect(drift?.monthlySaving.equals(Money.of(200))).toBe(true);
    expect(drift?.detail).toContain('médiane');
  });

  it('chiffre les abonnements à l’année', () => {
    const profile = standardProfile({
      recurringExpenses: [
        fixedExpense('Streaming', 15, 'fixed.subscriptions', { subscription: true }),
        fixedExpense('Musique', 12, 'fixed.subscriptions', { subscription: true }),
        fixedExpense('Salle de sport', 30, 'fixed.subscriptions', { subscription: true }),
      ],
    });
    const summary = monthlySummary(profile, MARCH_2026, TODAY);
    const result = optimize(profile, summary, MARCH_2026, TODAY);

    const subscriptions = result.suggestions.find((entry) => entry.kind === 'subscriptionReview');
    expect(subscriptions).toBeDefined();
    expect(subscriptions?.title).toContain('684'); // (15 + 12 + 30) × 12
    expect(subscriptions?.monthlySaving.equals(Money.of(19))).toBe(true); // 57 ÷ 3
  });

  it('signale les intérêts d’une dette coûteuse', () => {
    const profile = standardProfile({ debts: [makeDebt('Revolving', 5000, 0.18, 150, 'creditCard')] });
    const summary = monthlySummary(profile, MARCH_2026, TODAY);
    const result = optimize(profile, summary, MARCH_2026, TODAY);

    const suggestion = result.suggestions.find((entry) => entry.kind === 'expensiveDebt');
    expect(suggestion).toBeDefined();
    expect(suggestion?.monthlySaving.roundedToUnit.units).toBe(75); // 5 000 × 18 % ÷ 12
  });

  it('ne propose rien d’absurde sur un profil vide', () => {
    const profile = emptyProfile();
    const summary = monthlySummary(profile, MARCH_2026, TODAY);
    const result = optimize(profile, summary, MARCH_2026, TODAY);
    expect(result.totalMonthly.isZero).toBe(true);
  });
});

describe('Simulation', () => {
  it('capitalise les intérêts mois par mois', () => {
    // 100 € par mois, 12 mois, 12 % par an : plus que 1 200 € grâce aux intérêts.
    const result = project(Money.of(100), Money.zero(), 0.12, 12, 'EUR');
    expect(result.totalContributed.equals(Money.of(1200))).toBe(true);
    expect(result.finalAmount.greaterThan(Money.of(1200))).toBe(true);
    // 1 280,93 exactement : (b + 100) × 1,01 douze fois de suite.
    expect(result.finalAmount.roundedToUnit.units).toBe(1281);
    expect(result.points).toHaveLength(12);
  });

  it('borne les taux aberrants plutôt que d’afficher un résultat absurde', () => {
    expect(project(Money.of(100), Money.zero(), 5, 12, 'EUR').annualRate).toBe(0.2);
    expect(project(Money.of(100), Money.zero(), -3, 12, 'EUR').annualRate).toBe(-0.1);
  });

  it('sans rendement, le total est la somme des versements', () => {
    const result = project(Money.of(200), Money.of(1000), 0, 24, 'EUR');
    expect(result.finalAmount.equals(Money.of(5800))).toBe(true);
    expect(result.totalInterest.isZero).toBe(true);
  });

  it('calcule le délai pour atteindre un montant', () => {
    expect(monthsToReach(Money.of(1200), Money.of(100), Money.zero(), 0)).toBe(12);
    expect(monthsToReach(Money.of(500), Money.of(1000), Money.zero(), 0)).toBe(1);
    expect(monthsToReach(Money.of(1000), Money.of(1000), Money.zero(), 0)).toBe(1);
    expect(monthsToReach(Money.of(1000), Money.zero(), Money.zero(), 0)).toBeNull();
  });

  it('propose trois scénarios ordonnés', () => {
    const result = scenarios(Money.of(200), Money.zero(), 120, 'EUR');
    expect(result).toHaveLength(3);
    expect(result[0]!.result.finalAmount.lessThan(result[2]!.result.finalAmount)).toBe(true);
  });

  it('convertit en euros d’aujourd’hui', () => {
    // 2 % d'inflation sur 10 ans : environ 82 % du pouvoir d'achat.
    const real = inRealTerms(Money.of(100000), 120, 0.02);
    expect(real.roundedToUnit.units).toBeGreaterThan(80000);
    expect(real.roundedToUnit.units).toBeLessThan(83000);
  });
});

describe('« Puis-je me le permettre ? »', () => {
  const profile = standardProfile({
    accounts: [{ id: 'c', name: 'Compte', kind: 'checking', balance: Money.of(8000) }],
  });
  const analysis = analyse(profile, MARCH_2026, TODAY);

  it('accepte une dépense modeste', () => {
    const answer = canIAfford(Money.of(100), analysis.summary, analysis.emergencyFund, analysis.cashFlow, analysis.capacity);
    expect(answer.verdict).toBe('yes');
    expect(answer.reasons[0]).toContain('disponibles');
  });

  it('prévient quand l’achat mange presque tout le disponible', () => {
    const available = analysis.summary.income
      .minus(analysis.summary.fixedExpenses)
      .minus(analysis.summary.debtPayments)
      .minus(analysis.summary.variableProjected)
      .minus(analysis.summary.savingsContributions);
    const answer = canIAfford(
      available.times(0.8),
      analysis.summary,
      analysis.emergencyFund,
      analysis.cashFlow,
      analysis.capacity,
    );
    expect(answer.verdict).toBe('yesButTight');
  });

  it('refuse un achat qui mettrait à découvert', () => {
    const answer = canIAfford(
      Money.of(50000),
      analysis.summary,
      analysis.emergencyFund,
      analysis.cashFlow,
      analysis.capacity,
    );
    expect(answer.verdict).toBe('no');
    expect(answer.wouldCauseOverdraft).toBe(true);
  });

  it('propose un délai d’épargne quand la réponse est non', () => {
    const answer = canIAfford(
      Money.of(50000),
      analysis.summary,
      analysis.emergencyFund,
      analysis.cashFlow,
      analysis.capacity,
    );
    expect(answer.monthsToSaveFor).not.toBeNull();
    expect(answer.reasons.join(' ')).toContain('mois');
  });
});

describe('Rapport mensuel', () => {
  it('compare au mois précédent et se juge lui-même', () => {
    const previous = addMonths(MARCH_2026, -1);
    const profile = standardProfile({
      transactions: [
        expense(300, 'variable.groceries', 10, previous),
        expense(400, 'variable.groceries', 10),
      ],
    });
    const report = buildMonthlyReport(profile, MARCH_2026, TODAY);

    expect(report.title).toContain('mars 2026');
    expect(report.increases[0]?.category).toBe('variable.groceries');
    expect(report.increases[0]?.delta.equals(Money.of(100))).toBe(true);
    expect(report.highlights.length).toBeGreaterThan(1);
  });

  it('reste calculable sans historique', () => {
    const report = buildMonthlyReport(emptyProfile(), MARCH_2026, TODAY);
    expect(report.incomeChange).toBeNull();
    expect(report.verdict).toBe('stable');
  });
});

describe('Catégorisation', () => {
  it('nettoie un libellé bancaire', () => {
    expect(normalize('CB CARREFOUR MARKET 4589 12/03')).toBe('CARREFOUR MARKET');
    expect(normalize('PRLV SEPA NETFLIX.COM')).toContain('NETFLIX');
  });

  it('reconnaît les enseignes courantes', () => {
    expect(categorize('CARREFOUR CITY')?.category).toBe('variable.groceries');
    expect(categorize('SNCF CONNECT')?.category).toBe('variable.publicTransport');
    expect(categorize('NETFLIX.COM')?.subscription).toBe(true);
  });

  it('distingue TotalEnergies de la station Total', () => {
    // L'ordre des règles est ici le seul rempart contre un faux positif.
    expect(categorize('TOTALENERGIES ELEC')?.category).toBe('fixed.electricity');
    expect(categorize('TOTAL STATION A6')?.category).toBe('variable.fuel');
  });

  it('donne priorité à une règle apprise de l’utilisateur', () => {
    const result = categorize('CARREFOUR', [{ pattern: 'carrefour', category: 'variable.household' }]);
    expect(result?.category).toBe('variable.household');
    expect(result?.source).toBe('user');
  });

  it('renvoie null plutôt que de deviner', () => {
    expect(categorize('XZQ 4471')).toBeNull();
  });

  it('détecte une charge mensuelle cachée dans les transactions', () => {
    const transactions = [0, 1, 2, 3].map((offset) => ({
      id: `t${offset}`,
      amount: Money.of(12.99),
      date: formatDate(dateOf(addMonths(MARCH_2026, -offset), 5)),
      kind: 'expense' as const,
      label: 'SPOTIFY',
    }));
    const detected = detectRecurrences(transactions);
    expect(detected).toHaveLength(1);
    expect(detected[0]?.suggestedFrequency).toBe('monthly');
    expect(detected[0]?.occurrences).toBe(4);
  });

  it('ne prend pas trois achats espacés au hasard pour un abonnement', () => {
    const days = [1, 9, 28];
    const transactions = days.map((day, index) => ({
      id: `t${index}`,
      amount: Money.of(20),
      date: formatDate(dateOf(MARCH_2026, day)),
      kind: 'expense' as const,
      label: 'BOUTIQUE',
    }));
    expect(detectRecurrences(transactions)).toHaveLength(0);
  });
});

describe('Import CSV', () => {
  it('découpe en respectant les guillemets', () => {
    expect(splitLine('a;"b;c";d', ';')).toEqual(['a', 'b;c', 'd']);
    expect(splitLine('a;"DUPONT ""JEAN""";c', ';')).toEqual(['a', 'DUPONT "JEAN"', 'c']);
  });

  it('devine le séparateur', () => {
    expect(detectSeparator(['a;b;c', '1;2;3'])).toBe(';');
    expect(detectSeparator(['a,b,c', '1,2,3'])).toBe(',');
  });

  it('lit les trois conventions de montant', () => {
    expect(parseAmountField('1 234,56')).toBeCloseTo(1234.56, 2);
    expect(parseAmountField('1,234.56')).toBeCloseTo(1234.56, 2);
    expect(parseAmountField('1234.56')).toBeCloseTo(1234.56, 2);
    expect(parseAmountField('-45,90 €')).toBeCloseTo(-45.9, 2);
    expect(parseAmountField('')).toBeNull();
  });

  it('lit les formats de date usuels', () => {
    expect(parseDateField('05/03/2026')).toBe('2026-03-05');
    expect(parseDateField('2026-03-05')).toBe('2026-03-05');
    expect(parseDateField('05.03.26')).toBe('2026-03-05');
    expect(parseDateField('n’importe quoi')).toBeNull();
  });

  it('importe un relevé et catégorise au passage', () => {
    const csv = [
      'Date;Libellé;Montant',
      '05/03/2026;CB CARREFOUR MARKET;-45,90',
      '12/03/2026;VIR SALAIRE;2500,00',
      '15/03/2026;PRLV NETFLIX;-13,49',
    ].join('\n');

    const report = importCsv(csv, 'EUR');
    expect(report.imported).toBe(3);
    expect(report.errors).toHaveLength(0);
    expect(report.transactions[0]?.category).toBe('variable.groceries');
    expect(report.transactions[0]?.amount.equals(Money.of(45.9))).toBe(true);
    expect(report.transactions[1]?.kind).toBe('income');
  });

  it('écarte les doublons d’un relevé qui chevauche le précédent', () => {
    const csv = ['Date;Libellé;Montant', '05/03/2026;CARREFOUR;-45,90'].join('\n');
    const existing = [
      {
        id: 'x',
        date: '2026-03-05',
        label: 'CARREFOUR',
        amount: Money.of(45.9),
        kind: 'expense' as const,
      },
    ];
    const report = importCsv(csv, 'EUR', existing);
    expect(report.imported).toBe(0);
    expect(report.duplicates).toBe(1);
  });

  it('explique ce qui manque quand les en-têtes sont inconnus', () => {
    const report = importCsv('col1;col2\n1;2', 'EUR');
    expect(report.imported).toBe(0);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain('date');
  });

  it('exporte dans un format relisible', () => {
    const csv = exportCsv([
      { id: 'a', date: '2026-03-05', label: 'Courses', amount: Money.of(45.9), kind: 'expense' },
    ]);
    const report = importCsv(csv, 'EUR');
    expect(report.imported).toBe(1);
    expect(report.transactions[0]?.amount.equals(Money.of(45.9))).toBe(true);
  });
});

describe('Assistant', () => {
  const analysis = analyse(standardProfile(), MARCH_2026, TODAY);

  it('explique où part l’argent en citant les montants', () => {
    const answer = ask('où part mon argent ?', analysis);
    expect(answer.title).toContain('mars 2026');
    expect(answer.figures.length).toBeGreaterThan(0);
    expect(answer.paragraphs.join(' ')).toMatch(/\d/);
  });

  it('justifie la capacité d’épargne au lieu de l’asséner', () => {
    const answer = ask('combien puis-je épargner ?', analysis);
    expect(answer.figures.some((figure) => figure.label.includes('libre'))).toBe(true);
    expect(answer.paragraphs.join(' ')).toContain('imprévu');
  });

  it('refuse de répondre hors de son périmètre', () => {
    const answer = ask('quel temps fera-t-il demain ?', analysis);
    expect(answer.title).toContain('ne sais pas');
    expect(answer.paragraphs.join(' ')).toContain('plausible et fausse');
  });

  it('lit le montant dans la question', () => {
    const answer = ask('puis-je me permettre 200 € ?', analysis);
    expect(answer.figures.some((figure) => figure.value.includes('200'))).toBe(true);
  });

  it('ne garantit jamais un rendement', () => {
    const answer = ask('que deviendraient 200 € par mois pendant 10 ans ?', analysis);
    expect(answer.figures).toHaveLength(4);
    expect(answer.caveats.join(' ')).toContain('ne préjugent pas des rendements futurs');
    expect(answer.paragraphs.join(' ')).not.toContain('garanti ');
  });

  it('signale les données manquantes plutôt que de les inventer', () => {
    const empty = analyse(emptyProfile(), MARCH_2026, TODAY);
    const answer = ask('mon budget est-il sain ?', empty);
    expect(answer.caveats.length).toBeGreaterThan(0);
    expect(answer.caveats.join(' ')).toContain('Aucun revenu déclaré');
  });

  it('annonce un budget déficitaire sans le maquiller', () => {
    const profile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 1000)],
      recurringExpenses: [fixedExpense('Loyer', 1500, 'fixed.rent')],
    };
    const answer = ask('combien puis-je épargner ?', analyse(profile, MARCH_2026, TODAY));
    expect(answer.title).toContain('déficitaire');
  });
});
