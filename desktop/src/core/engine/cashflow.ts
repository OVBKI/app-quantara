import { Money } from '../money';
import { approximateDayInterval, monthlyEquivalent } from '../frequency';
import { activeDebts, availableBalance, incomesFor, recurringExpensesFor, type FinancialProfile } from '../model';
import { containsDate, daysInMonth, dateOf, parseDate, startOfDay, type YearMonth } from '../yearMonth';
import type { MonthlySummary } from './budget';

export interface CashFlowPoint {
  readonly day: number;
  readonly date: Date;
  readonly balance: Money;
}

export interface CashFlowEvent {
  readonly id: string;
  readonly date: Date;
  readonly label: string;
  readonly amount: Money;
  readonly kind: 'income' | 'expense' | 'debt';
  /** L'écriture correspondante existe déjà : l'échéance est honorée, pas attendue. */
  readonly settled: boolean;
}

export interface CashFlowForecast {
  readonly points: readonly CashFlowPoint[];
  /** **Toutes** les échéances du mois, passées comprises. Un calendrier qui masquerait
   *  le début du mois empêcherait de vérifier ce qui est déjà tombé. */
  readonly events: readonly CashFlowEvent[];
  /** Celles qui restent à venir, dans l'ordre. */
  readonly upcoming: readonly CashFlowEvent[];
  readonly lowestBalance: Money;
  readonly lowestBalanceDate: Date | null;
  readonly projectedOverdraft: boolean;
  readonly endOfMonthBalance: Money;
}

/**
 * Projection de trésorerie jour par jour.
 *
 * Un solde de fin de mois positif ne dit rien du 12 du mois, quand le loyer, l'énergie
 * et l'assurance tombent avant le salaire. C'est le creux qui provoque le découvert,
 * pas le solde final — donc c'est le creux qu'on calcule.
 */
export function forecastCashFlow(
  profile: FinancialProfile,
  summary: MonthlySummary,
  period: YearMonth,
  openingBalance: Money,
  reference: Date = new Date(),
): CashFlowForecast {
  const total = daysInMonth(period);
  const events: CashFlowEvent[] = [];

  // Revenus : placés à leur date d'échéance, ou en fin de mois à défaut d'information.
  for (const income of incomesFor(profile, period)) {
    const monthly = monthlyEquivalent(income.amount, income.frequency);
    if (!monthly.isPositive) continue;
    const interval = approximateDayInterval(income.frequency);
    if (interval !== null && interval < 20) {
      // Revenu fréquent (hebdomadaire, quinzaine) : réparti sur le mois.
      const occurrences = Math.max(Math.round(total / interval), 1);
      const each = monthly.dividedBy(BigInt(occurrences));
      for (let index = 0; index < occurrences; index += 1) {
        const day = Math.min(Math.round((index + 1) * interval), total);
        events.push({
          settled: false,
          id: `${income.id}-${index}`,
          date: dateOf(period, day),
          label: income.name,
          amount: each,
          kind: 'income',
        });
      }
    } else {
      events.push({
        settled: false,
        id: income.id,
        // Le 28 par défaut : tant que la date de réception n'est pas connue, mieux vaut
        // supposer tard dans le mois — une hypothèse optimiste masquerait un découvert.
        date: dateOf(period, Math.min(Math.max(income.dayOfMonth ?? 28, 1), total)),
        label: income.name,
        amount: monthly,
        kind: 'income',
      });
    }
  }

  for (const expense of recurringExpensesFor(profile, period)) {
    const monthly = monthlyEquivalent(expense.amount, expense.frequency);
    if (!monthly.isPositive) continue;
    events.push({
      settled: false,
      id: expense.id,
      date: dateOf(period, expense.dayOfMonth),
      label: expense.name,
      amount: monthly,
      kind: 'expense',
    });
  }

  for (const debt of activeDebts(profile)) {
    if (!debt.monthlyPayment.isPositive) continue;
    events.push({
      settled: false,
      id: debt.id,
      date: dateOf(period, 5),
      label: debt.name,
      amount: debt.monthlyPayment,
      kind: 'debt',
    });
  }

  // Les dépenses variables sont étalées : on ne sait pas quel jour l'utilisateur fera
  // ses courses, seulement le rythme moyen.
  const dailyVariable = summary.variableProjected.dividedBy(BigInt(total));

  /*
   * Jusqu'où le mois est-il écoulé ?
   *
   * Zéro pour un mois à venir, le jour courant pour le mois en cours, le mois entier
   * pour un mois révolu.
   */
  const elapsed = reference < dateOf(period, 1) ? 0 : reference >= dateOf(period, total) ? total : reference.getDate();

  // Les échéances regroupées par jour, une fois : les refiltrer dans la boucle
  // parcourait la liste entière trente et une fois.
  const byDay = new Map<number, CashFlowEvent[]>();
  for (const event of events) {
    const day = event.date.getDate();
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }

  const points: CashFlowPoint[] = [];
  let balance = openingBalance;
  let lowest = openingBalance;
  let lowestDate: Date | null = null;

  for (let day = 1; day <= total; day += 1) {
    const date = dateOf(period, day);

    if (day <= elapsed) {
      /*
       * Le passé se lit, il ne se simule pas.
       *
       * Le solde d'un jour écoulé est celui des comptes à cette date — il contient déjà
       * les charges prélevées et les dépenses saisies. Rejouer les échéances par-dessus
       * les déduisait une seconde fois, et l'application annonçait un découvert à
       * quelqu'un dont le compte était sain. Le défaut frappait précisément l'utilisateur
       * assidu : plus il saisissait ses dépenses, plus la courbe s'enfonçait.
       */
      balance = availableBalance(profile, date);
    } else {
      for (const event of byDay.get(day) ?? []) {
        balance = event.kind === 'income' ? balance.plus(event.amount) : balance.minus(event.amount);
      }
      balance = balance.minus(dailyVariable);
    }

    points.push({ day, date, balance });

    if (balance.lessThan(lowest)) {
      lowest = balance;
      lowestDate = date;
    }
  }

  /*
   * Une échéance dont l'écriture existe déjà est honorée.
   *
   * Sans ce marquage, le calendrier affichait côte à côte le salaire encaissé et le
   * salaire attendu — deux fois le même argent le même jour.
   */
  const settledExpenses = new Set(
    profile.transactions
      .filter((transaction) => containsDate(period, parseDate(transaction.date)))
      .map((transaction) => transaction.recurringExpenseId ?? transaction.incomeSourceId)
      .filter((id): id is string => id !== undefined),
  );

  const chronological = [...events]
    .map((event) => ({ ...event, settled: settledExpenses.has(event.id.split('-')[0] ?? event.id) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Comparaison à la journée : `reference` porte l'heure courante, `date` minuit. Sans
  // cela, un prélèvement daté d'aujourd'hui disparaît des « prochaines échéances » dès
  // 00 h 01 — exactement le jour où il faut le voir.
  const startOfToday = startOfDay(reference);
  const upcoming = chronological.filter((event) => !event.settled && event.date >= startOfToday);

  return {
    points,
    events: chronological,
    upcoming,
    lowestBalance: lowest,
    lowestBalanceDate: lowestDate,
    projectedOverdraft: lowest.isNegative,
    endOfMonthBalance: points[points.length - 1]?.balance ?? balance,
  };
}

export function openingBalanceOf(profile: FinancialProfile, reference: Date = new Date()): Money {
  return availableBalance(profile, reference);
}
