import { Money } from '../money';
import { approximateDayInterval, monthlyEquivalent } from '../frequency';
import { activeDebts, activeIncomes, activeRecurringExpenses, availableBalance, type FinancialProfile } from '../model';
import { daysInMonth, dateOf, type YearMonth } from '../yearMonth';
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
}

export interface CashFlowForecast {
  readonly points: readonly CashFlowPoint[];
  readonly events: readonly CashFlowEvent[];
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
  for (const income of activeIncomes(profile, reference)) {
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
          id: `${income.id}-${index}`,
          date: dateOf(period, day),
          label: income.name,
          amount: each,
          kind: 'income',
        });
      }
    } else {
      events.push({
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

  for (const expense of activeRecurringExpenses(profile, reference)) {
    const monthly = monthlyEquivalent(expense.amount, expense.frequency);
    if (!monthly.isPositive) continue;
    events.push({
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
  const isCurrentMonth = reference.getFullYear() === period.year && reference.getMonth() + 1 === period.month;
  const today = isCurrentMonth ? reference.getDate() : total;

  const points: CashFlowPoint[] = [];
  let balance = openingBalance;
  let lowest = openingBalance;
  let lowestDate: Date | null = null;

  for (let day = 1; day <= total; day += 1) {
    for (const event of events.filter((entry) => entry.date.getDate() === day)) {
      balance = event.kind === 'income' ? balance.plus(event.amount) : balance.minus(event.amount);
    }

    // Avant aujourd'hui, les dépenses variables sont déjà dans le solde réel : les
    // ajouter une seconde fois compterait double.
    if (day > today) balance = balance.minus(dailyVariable);

    const date = dateOf(period, day);
    points.push({ day, date, balance });

    if (balance.lessThan(lowest)) {
      lowest = balance;
      lowestDate = date;
    }
  }

  const upcoming = events
    .filter((event) => event.date >= reference)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    points,
    events: upcoming,
    lowestBalance: lowest,
    lowestBalanceDate: lowestDate,
    projectedOverdraft: lowest.isNegative,
    endOfMonthBalance: points[points.length - 1]?.balance ?? balance,
  };
}

export function openingBalanceOf(profile: FinancialProfile, reference: Date = new Date()): Money {
  return availableBalance(profile, reference);
}
