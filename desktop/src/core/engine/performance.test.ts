import { describe, expect, it } from 'vitest';
import { Money } from '../money';
import {
  DEFAULT_PREFERENCES,
  emptyProfile,
  transactionsIn,
  type FinancialProfile,
  type Transaction,
} from '../model';
import { addMonths, dateOf, formatDate } from '../yearMonth';
import { MARCH_2026, account, fixedExpense, income } from '../testing/fixtures';
import { analyse } from './analysis';

/**
 * Garde-fou de performance.
 *
 * L'application recalcule tout à chaque changement d'état — c'est ce qui garantit qu'un
 * chiffre corrigé se répercute partout sans rien à rafraîchir. Le prix de ce choix est que
 * le coût d'un rendu doit rester borné, y compris sur un profil de plusieurs années.
 *
 * Deux moteurs le tenaient de moins en moins bien : `transactionsIn` reparcourait toute la
 * liste à chaque appel, et `accountBalance` analysait la date de chaque écriture pour n'en
 * retenir qu'une poignée — une fois par jour et par compte dans la prévision de trésorerie.
 *
 * Mesuré ici même, sur 6 000 écritures : 71 ms avant, 3 ms après.
 */

function profileWith(months: number, perMonth: number): FinancialProfile {
  const transactions: Transaction[] = [];
  for (let month = 0; month < months; month += 1) {
    const period = addMonths(MARCH_2026, -month);
    for (let index = 0; index < perMonth; index += 1) {
      transactions.push({
        id: `t-${month}-${index}`,
        amount: Money.of(10 + (index % 40)),
        date: formatDate(dateOf(period, (index % 28) + 1)),
        kind: 'expense',
        label: 'Achat',
        category: index % 2 === 0 ? 'variable.groceries' : 'variable.restaurants',
      });
    }
  }
  return {
    ...emptyProfile('EUR'),
    accounts: [account('Compte courant', 3000)],
    incomes: [income('Salaire', 3000)],
    recurringExpenses: [fixedExpense('Loyer', 1000, 'fixed.rent')],
    transactions,
    preferences: DEFAULT_PREFERENCES,
  };
}

describe('Coût d’un rendu', () => {
  it('sert les écritures d’un mois depuis un index, sans refiltrer', () => {
    /*
     * Vérification structurelle, donc déterministe : deux appels rendent le **même**
     * tableau. Un filtre en produirait un nouveau à chaque fois — c'est précisément ce que
     * l'ancienne version faisait, des dizaines de fois par écran.
     */
    const profile = profileWith(12, 40);
    expect(transactionsIn(profile, MARCH_2026)).toBe(transactionsIn(profile, MARCH_2026));

    // Un profil modifié est un autre objet : son index est reconstruit, jamais réutilisé.
    const changed = { ...profile, transactions: profile.transactions.slice(1) };
    expect(transactionsIn(changed, MARCH_2026)).not.toBe(transactionsIn(profile, MARCH_2026));
    expect(transactionsIn(changed, MARCH_2026)).toHaveLength(
      transactionsIn(profile, MARCH_2026).length - 1,
    );
  });

  it('reste sous 50 ms sur cinq ans d’usage assidu', () => {
    // Budget très large devant les 3 ms mesurés : il n'est pas là pour chronométrer la
    // machine, mais pour attraper un retour au parcours complet, qui en coûtait 71.
    const profile = profileWith(60, 100);
    const reference = dateOf(MARCH_2026, 15);
    analyse(profile, MARCH_2026, reference);

    const start = performance.now();
    analyse(profile, MARCH_2026, reference);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
