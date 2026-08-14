import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile, type FinancialProfile, type IncomeSource, type Transaction } from '../model';
import { MARCH_2026, expense, fixedExpense, income, referenceDate, standardProfile } from '../testing/fixtures';
import { addMonths, dateOf, formatDate } from '../yearMonth';
import { monthlySummary } from './budget';
import { analyse } from './analysis';
import { estimateSource, incomeBreakdown, smoothingBuffer } from './income';
import { suggestEnvelopes } from './envelopes';
import { ask } from '../advisor/advisor';

const TODAY = referenceDate(15);

function variableIncome(overrides: Partial<IncomeSource> = {}): IncomeSource {
  return {
    ...income('Freelance', 3000, 'monthly', 'freelance'),
    variable: true,
    ...overrides,
  };
}

/** Salaire réellement encaissé un mois donné, rattaché à sa source. */
function received(sourceId: string, amount: number, monthsAgo: number): Transaction {
  const month = addMonths(MARCH_2026, -monthsAgo);
  return {
    id: `recu-${sourceId}-${monthsAgo}`,
    amount: Money.of(amount),
    date: formatDate(dateOf(month, 28)),
    kind: 'income',
    label: 'Facturation',
    incomeSourceId: sourceId,
  };
}

describe('Revenu irrégulier', () => {
  it('encadre le revenu par une fourchette déclarée', () => {
    const source = variableIncome({ minAmount: Money.of(1800), maxAmount: Money.of(4200) });
    const profile: FinancialProfile = { ...emptyProfile(), incomes: [source] };
    const estimate = estimateSource(profile, source, MARCH_2026);

    expect(estimate.low.equals(Money.of(1800))).toBe(true);
    expect(estimate.typical.equals(Money.of(3000))).toBe(true);
    expect(estimate.high.equals(Money.of(4200))).toBe(true);
  });

  it('applique une fourchette de ±20 % quand elle n’est pas renseignée', () => {
    const source = variableIncome();
    const profile: FinancialProfile = { ...emptyProfile(), incomes: [source] };
    const estimate = estimateSource(profile, source, MARCH_2026);

    expect(estimate.low.equals(Money.of(2400))).toBe(true);
    expect(estimate.high.equals(Money.of(3600))).toBe(true);
  });

  it('préfère l’historique réel à la fourchette déclarée', () => {
    // Six mois encaissés : c'est cette distribution qui fait foi, pas une estimation.
    const source = variableIncome({ minAmount: Money.of(1000), maxAmount: Money.of(9000) });
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [source],
      transactions: [2000, 2500, 3000, 3500, 4000, 4500].map((amount, index) =>
        received(source.id, amount, index + 1),
      ),
    };
    const estimate = estimateSource(profile, source, MARCH_2026);

    expect(estimate.historyMonths).toBe(6);
    expect(estimate.typical.roundedToUnit.units).toBe(3250); // médiane de la série
    expect(estimate.low.greaterThan(Money.of(1000))).toBe(true);
    expect(estimate.high.lessThan(Money.of(9000))).toBe(true);
  });

  it('un montant déjà encaissé remplace toute estimation', () => {
    const source = variableIncome();
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [source],
      transactions: [received(source.id, 5200, 0)],
    };
    const breakdown = incomeBreakdown(profile, MARCH_2026, TODAY, 'prudent');

    // Le mois est connu : le mode prudent ne s'applique plus, il n'y a plus d'hypothèse.
    expect(breakdown.planned.equals(Money.of(5200))).toBe(true);
    expect(breakdown.low.equals(Money.of(5200))).toBe(true);
    expect(breakdown.received.equals(Money.of(5200))).toBe(true);
  });

  it('planifie sur le mois faible par défaut', () => {
    const source = variableIncome({ minAmount: Money.of(1800), maxAmount: Money.of(4200) });
    const profile: FinancialProfile = { ...emptyProfile(), incomes: [source] };

    expect(incomeBreakdown(profile, MARCH_2026, TODAY, 'prudent').planned.equals(Money.of(1800))).toBe(true);
    expect(incomeBreakdown(profile, MARCH_2026, TODAY, 'typical').planned.equals(Money.of(3000))).toBe(true);
    expect(incomeBreakdown(profile, MARCH_2026, TODAY, 'optimistic').planned.equals(Money.of(4200))).toBe(true);
  });

  it('mélange sans broncher un salaire fixe et une activité irrégulière', () => {
    const freelance = variableIncome({ minAmount: Money.of(500), maxAmount: Money.of(2500) });
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 2000), freelance],
    };
    const breakdown = incomeBreakdown(profile, MARCH_2026, TODAY, 'prudent');

    expect(breakdown.low.equals(Money.of(2500))).toBe(true); // 2 000 fixe + 500 faible
    expect(breakdown.high.equals(Money.of(4500))).toBe(true); // 2 000 fixe + 2 500 fort
    expect(breakdown.hasVariableSource).toBe(true);
  });

  it('mesure l’amplitude et dimensionne le coussin de lissage', () => {
    const source = variableIncome({ minAmount: Money.of(2000), maxAmount: Money.of(4000) });
    const profile: FinancialProfile = { ...emptyProfile(), incomes: [source] };
    const breakdown = incomeBreakdown(profile, MARCH_2026, TODAY, 'prudent');

    expect(breakdown.volatility).toBeCloseTo(2000 / 3000, 4);
    // Trois mois de l'écart entre le typique et le faible : 3 × 1 000.
    expect(smoothingBuffer(breakdown).equals(Money.of(3000))).toBe(true);
  });

  it('un revenu fixe n’a ni fourchette ni coussin', () => {
    const profile: FinancialProfile = { ...emptyProfile(), incomes: [income('Salaire', 2500)] };
    const breakdown = incomeBreakdown(profile, MARCH_2026, TODAY, 'prudent');

    expect(breakdown.low.equals(breakdown.high)).toBe(true);
    expect(breakdown.volatility).toBe(0);
    expect(breakdown.hasVariableSource).toBe(false);
  });

  it('signale l’irrégularité et recommande un tampon', () => {
    const profile = standardProfile({
      incomes: [variableIncome({ minAmount: Money.of(1500), maxAmount: Money.of(5000) })],
    });
    const analysis = analyse(profile, MARCH_2026, TODAY);

    expect(analysis.incomeIsVolatile).toBe(true);
    expect(analysis.smoothingBuffer.isPositive).toBe(true);
    expect(analysis.insights.some((insight) => insight.kind === 'volatileIncome')).toBe(true);
  });

  it('le budget prudent réduit le disponible, il ne l’invente pas', () => {
    const base = standardProfile({
      incomes: [variableIncome({ minAmount: Money.of(2000), maxAmount: Money.of(6000) })],
    });
    const prudent = monthlySummary(base, MARCH_2026, TODAY);
    const optimistic = monthlySummary(
      { ...base, preferences: { ...base.preferences, incomePlanning: 'optimistic' } },
      MARCH_2026,
      TODAY,
    );

    expect(prudent.income.equals(Money.of(2000))).toBe(true);
    expect(optimistic.income.equals(Money.of(6000))).toBe(true);
    expect(prudent.disposable.lessThan(optimistic.disposable)).toBe(true);
  });
});

describe('Enveloppes par catégorie', () => {
  const profileWithEnvelopes = (spent: number, planned: number, day = 15): FinancialProfile => ({
    ...emptyProfile(),
    incomes: [income('Salaire', 3000)],
    transactions: [expense(spent, 'variable.groceries', Math.min(day, 28))],
    categoryBudgets: [{ category: 'variable.groceries', limit: Money.of(planned) }],
  });

  it('compare le rythme de dépense au calendrier, pas au seul total', () => {
    // 300 € sur 400 € au 15 mars : 75 % consommés pour 48 % du mois écoulé.
    const summary = monthlySummary(profileWithEnvelopes(300, 400), MARCH_2026, referenceDate(15));
    const envelope = summary.envelopes.envelopes[0]!;

    expect(envelope.consumed).toBeCloseTo(0.75, 4);
    expect(envelope.monthProgress).toBeCloseTo(15 / 31, 4);
    expect(envelope.state).toBe('atRisk');
    expect(envelope.remaining.equals(Money.of(100))).toBe(true);
  });

  it('reste sereine quand le rythme suit le calendrier', () => {
    const summary = monthlySummary(profileWithEnvelopes(200, 400), MARCH_2026, referenceDate(15));
    expect(summary.envelopes.envelopes[0]?.state).toBe('onTrack');
  });

  it('marque le dépassement et le répercute sur le disponible', () => {
    const overspent = monthlySummary(profileWithEnvelopes(500, 400), MARCH_2026, referenceDate(28));
    const envelope = overspent.envelopes.envelopes[0]!;

    expect(envelope.state).toBe('exceeded');
    expect(envelope.remaining.equals(Money.of(-100))).toBe(true);
    // Le plan réserve le réel, pas l'enveloppe : ignorer un dépassement afficherait un
    // disponible qui n'existe pas.
    expect(overspent.variableReserved.greaterThanOrEqual(Money.of(500))).toBe(true);
  });

  it('réserve l’enveloppe même quand le mois est calme', () => {
    // 50 € dépensés sur une enveloppe de 400 € : le plan retient bien 400 €.
    const calm = monthlySummary(profileWithEnvelopes(50, 400), MARCH_2026, referenceDate(15));
    expect(calm.variablePlanned.equals(Money.of(400))).toBe(true);
    expect(calm.variableReserved.equals(Money.of(400))).toBe(true);
    expect(calm.disposable.equals(Money.of(2600))).toBe(true); // 3 000 − 400
  });

  it('isole les dépenses hors de toute enveloppe', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      incomes: [income('Salaire', 3000)],
      transactions: [expense(200, 'variable.groceries', 5), expense(90, 'variable.leisure', 8)],
      categoryBudgets: [{ category: 'variable.groceries', limit: Money.of(400) }],
    };
    const summary = monthlySummary(profile, MARCH_2026, referenceDate(15));

    expect(summary.envelopes.unbudgeted.equals(Money.of(90))).toBe(true);
    // 400 € d'enveloppe tenue, plus le hors-enveloppe extrapolé au rythme du mois :
    // 90 € en 15 jours donnent 186 € sur 31. Un poste sans budget décidé n'a aucune
    // raison de s'arrêter là où il en est.
    expect(summary.variableReserved.equals(Money.of(586))).toBe(true);
  });

  it('calcule ce qui reste par jour pour tenir l’enveloppe', () => {
    // 400 − 240 = 160 € pour les 16 jours restants du mois.
    const summary = monthlySummary(profileWithEnvelopes(240, 400), MARCH_2026, referenceDate(15));
    expect(summary.envelopes.envelopes[0]?.perRemainingDay.equals(Money.of(10))).toBe(true);
  });

  it('propose des enveloppes à partir des mois passés', () => {
    const months = [1, 2, 3].map((offset) => addMonths(MARCH_2026, -offset));
    const profile: FinancialProfile = {
      ...emptyProfile(),
      transactions: [
        expense(380, 'variable.groceries', 10, months[0]!),
        expense(400, 'variable.groceries', 10, months[1]!),
        expense(420, 'variable.groceries', 10, months[2]!),
        expense(60, 'variable.restaurants', 12, months[0]!),
        expense(90, 'variable.restaurants', 12, months[1]!),
      ],
    };
    const suggestions = suggestEnvelopes(profile, months);

    expect(suggestions[0]?.category).toBe('variable.groceries');
    expect(suggestions[0]?.suggested.equals(Money.of(400))).toBe(true); // médiane
    expect(suggestions[0]?.basis).toBe(3);
  });

  it('ne propose rien sur un seul mois d’historique', () => {
    const profile: FinancialProfile = {
      ...emptyProfile(),
      transactions: [expense(380, 'variable.groceries', 10, addMonths(MARCH_2026, -1))],
    };
    expect(suggestEnvelopes(profile, [addMonths(MARCH_2026, -1)])).toHaveLength(0);
  });

  it('signale l’absence d’enveloppes quand des dépenses variables existent', () => {
    const profile = standardProfile();
    const analysis = analyse(profile, MARCH_2026, referenceDate(15));
    expect(analysis.insights.some((insight) => insight.kind === 'noEnvelopes')).toBe(true);
  });

  it('n’affiche aucune enveloppe tant qu’aucune n’est définie', () => {
    const summary = monthlySummary(
      { ...emptyProfile(), recurringExpenses: [fixedExpense('Loyer', 800, 'fixed.rent')] },
      MARCH_2026,
      TODAY,
    );
    expect(summary.envelopes.envelopes).toHaveLength(0);
    expect(summary.variablePlanned.isZero).toBe(true);
  });
});

describe('Assistant sur le revenu irrégulier', () => {
  it('conseille de s’engager sur le mois faible', () => {
    const profile = standardProfile({
      incomes: [variableIncome({ minAmount: Money.of(1500), maxAmount: Money.of(5000) })],
    });
    const answer = ask('mon salaire n’est pas fixe, comment faire ?', analyse(profile, MARCH_2026, TODAY));

    // Le formatage français sépare les milliers par une espace fine insécable (U+202F),
    // pas par une espace ordinaire : on normalise avant de comparer.
    const title = answer.title.replace(/[\u202f\u00a0]/g, ' ');
    expect(title).toContain('1 500');
    expect(title).toContain('5 000');
    expect(answer.paragraphs.join(' ')).toContain('mois faible');
    expect(answer.figures.some((figure) => figure.label.includes('Tampon'))).toBe(true);
  });

  it('renvoie vers le réglage quand le revenu est déclaré fixe', () => {
    const answer = ask('comment gérer un revenu irrégulier ?', analyse(standardProfile(), MARCH_2026, TODAY));
    expect(answer.title).toContain('fixes');
  });
});
