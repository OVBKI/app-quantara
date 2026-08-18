import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import { emptyProfile, type IncomeSource, type Transaction } from '../model';
import { MARCH_2026, income, referenceDate } from '../testing/fixtures';
import { yearMonth } from '../yearMonth';
import { MAX_PENDING_MONTHS, declarationHistory, pendingDeclarations } from './declarations';
import { incomeBreakdown } from './income';

const FREELANCE: IncomeSource = { ...income('Missions', 2500), variable: true, declaredMonthly: true };

/** Une déclaration : le montant réellement touché, rattaché à sa source. */
function declaration(amount: number, year: number, month: number, sourceId = FREELANCE.id): Transaction {
  return {
    id: `d-${year}-${month}`,
    amount: Money.of(amount),
    date: `${year}-${String(month).padStart(2, '0')}-28`,
    kind: 'income',
    label: 'Revenu déclaré',
    incomeSourceId: sourceId,
  };
}

function profileWith(transactions: Transaction[] = [], source: IncomeSource = FREELANCE) {
  return { ...emptyProfile(), incomes: [source], transactions };
}

describe('Mois à déclarer', () => {
  it('ne demande rien pour un revenu fixe', () => {
    const profile = { ...emptyProfile(), incomes: [income('Salaire', 3000)] };
    expect(pendingDeclarations(profile, referenceDate(31))).toHaveLength(0);
  });

  it('réclame les mois clos, du plus ancien au plus récent', () => {
    // Le 15 mars : janvier et février sont terminés, mars ne l'est pas.
    const pending = pendingDeclarations(profileWith(), referenceDate(15));
    const labels = pending.map((entry) => entry.label);

    expect(labels).toEqual(['décembre 2025', 'janvier 2026', 'février 2026']);
  });

  it('ne réclame pas le mois en cours avant son dernier jour', () => {
    const pending = pendingDeclarations(profileWith(), referenceDate(15));
    expect(pending.some((entry) => entry.label.startsWith('mars'))).toBe(false);
  });

  it('réclame le mois en cours le dernier jour, et lui seul en plus', () => {
    // Mars 2026 compte 31 jours : c'est ce jour-là que la question se pose.
    const pending = pendingDeclarations(profileWith(), referenceDate(31));
    expect(pending.some((entry) => entry.label.startsWith('mars'))).toBe(true);
  });

  it('ne réclame plus un mois déjà déclaré', () => {
    const profile = profileWith([declaration(2100, 2026, 2)]);
    const pending = pendingDeclarations(profile, referenceDate(15));

    expect(pending.some((entry) => entry.label.startsWith('février'))).toBe(false);
  });

  it('ne remonte pas au-delà de quelques mois', () => {
    // Réclamer un an d'arriérés à l'ouverture ferait fermer la fenêtre.
    const pending = pendingDeclarations(profileWith(), referenceDate(15));
    expect(pending.length).toBeLessThanOrEqual(MAX_PENDING_MONTHS + 1);
  });

  it('ignore les mois précédant le début de la source', () => {
    const started = { ...FREELANCE, startDate: '2026-02-01' };
    const pending = pendingDeclarations(profileWith([], started), referenceDate(15));

    expect(pending.map((entry) => entry.label)).toEqual(['février 2026']);
  });

  it('propose la médiane des mois déjà déclarés', () => {
    const profile = profileWith([
      declaration(1800, 2025, 12),
      declaration(2400, 2026, 1),
      declaration(3000, 2026, 2),
    ]);
    const pending = pendingDeclarations(profile, referenceDate(31));

    expect(pending[0]?.suggestion?.equals(Money.of(2400))).toBe(true);
  });

  it('ne propose rien tant qu’aucun mois n’a été déclaré', () => {
    expect(pendingDeclarations(profileWith(), referenceDate(31))[0]?.suggestion).toBeNull();
  });
});

describe('Revenu déclaré au mois', () => {
  function breakdownFor(transactions: Transaction[], day = 15) {
    return incomeBreakdown(profileWith(transactions), MARCH_2026, referenceDate(day), 'prudent');
  }

  it('retient le montant saisi, sans aucune marge', () => {
    const breakdown = breakdownFor([declaration(3175.42, 2026, 3)]);

    expect(breakdown.planned.equals(Money.of(3175.42))).toBe(true);
    expect(breakdown.low.equals(breakdown.high)).toBe(true);
  });

  it('déclare le mois inconnu plutôt que d’inventer une fourchette', () => {
    // Le point de la demande : sans saisie et sans historique, l'application ne suppose
    // rien. Un ±20 % inventé serait pire que l'aveu d'ignorance.
    const breakdown = breakdownFor([]);
    const source = breakdown.sources[0];

    expect(source?.unknown).toBe(true);
    expect(breakdown.planned.isZero).toBe(true);
    expect(breakdown.awaitingDeclaration).toBe(true);
  });

  it('propose une estimation provisoire dès deux mois déclarés', () => {
    const breakdown = breakdownFor([declaration(2000, 2026, 1), declaration(3000, 2026, 2)]);
    const source = breakdown.sources[0];

    expect(source?.unknown).toBe(false);
    expect(source?.provisional).toBe(true);
    expect(source?.typical.equals(Money.of(2500))).toBe(true);
  });

  it('ne confond jamais une estimation provisoire avec un montant reçu', () => {
    const breakdown = breakdownFor([declaration(2000, 2026, 1), declaration(3000, 2026, 2)]);

    expect(breakdown.sources[0]?.actual).toBeNull();
    expect(breakdown.received.isZero).toBe(true);
  });

  it('cesse d’attendre une déclaration une fois le mois saisi', () => {
    const breakdown = breakdownFor([declaration(2800, 2026, 3)]);
    expect(breakdown.awaitingDeclaration).toBe(false);
  });
});

describe('Historique des déclarations', () => {
  it('liste les mois saisis, du plus récent au plus ancien', () => {
    const profile = profileWith([declaration(1800, 2026, 1), declaration(2400, 2026, 2)]);
    const history = declarationHistory(profile, FREELANCE, referenceDate(15));

    expect(history.map((entry) => entry.label)).toEqual(['février 2026', 'janvier 2026']);
    expect(history[0]?.amount.equals(Money.of(2400))).toBe(true);
  });

  it('renvoie une liste vide quand rien n’a été déclaré', () => {
    expect(declarationHistory(profileWith(), FREELANCE, referenceDate(15))).toEqual([]);
  });

  it('rattache la déclaration au bon mois', () => {
    const profile = profileWith([declaration(2400, 2026, 2)]);
    const history = declarationHistory(profile, FREELANCE, referenceDate(15));

    expect(history[0]?.period).toEqual(yearMonth(2026, 2));
  });
});
