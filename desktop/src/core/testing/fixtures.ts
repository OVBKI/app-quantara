import { Money } from '../money';
import type { Frequency } from '../frequency';
import type { ExpenseCategoryId, IncomeCategory } from '../categories';
import { formatDate, yearMonth, dateOf, type YearMonth } from '../yearMonth';
import {
  DEFAULT_PREFERENCES,
  emptyProfile,
  type Account,
  type AccountKind,
  type Debt,
  type FinancialProfile,
  type Goal,
  type IncomeSource,
  type RecurringExpense,
  type Transaction,
} from '../model';

/** Mars 2026 : 31 jours, ce qui rend les projections au prorata vérifiables à la main. */
export const MARCH_2026: YearMonth = yearMonth(2026, 3);

export function referenceDate(day = 28, period: YearMonth = MARCH_2026): Date {
  return dateOf(period, day);
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Un compte dont le relevé date d'avant la période testée : les mouvements du mois
 *  s'y ajoutent, ce qui est précisément ce qu'on veut vérifier. */
export function account(
  name: string,
  balance: number,
  kind: AccountKind = 'checking',
  balanceDate = '2026-02-28',
): Account {
  return { id: nextId('account'), name, kind, openingBalance: Money.of(balance), balanceDate };
}

export function savingsAccount(balance: number): Account {
  return account('Livret', balance, 'savings');
}

export function income(
  name: string,
  amount: number,
  frequency: Frequency = 'monthly',
  category: IncomeCategory = 'salary',
): IncomeSource {
  return {
    id: nextId('income'),
    name,
    amount: Money.of(amount),
    frequency,
    category,
    variable: false,
    active: true,
  };
}

export function fixedExpense(
  name: string,
  amount: number,
  category: ExpenseCategoryId,
  options: { frequency?: Frequency; subscription?: boolean; dayOfMonth?: number } = {},
): RecurringExpense {
  return {
    id: nextId('expense'),
    name,
    amount: Money.of(amount),
    frequency: options.frequency ?? 'monthly',
    category,
    dayOfMonth: options.dayOfMonth ?? 5,
    subscription: options.subscription ?? false,
    active: true,
  };
}

export function expense(
  amount: number,
  category: ExpenseCategoryId,
  day: number,
  period: YearMonth = MARCH_2026,
): Transaction {
  return {
    id: nextId('transaction'),
    amount: Money.of(amount),
    date: formatDate(dateOf(period, day)),
    kind: 'expense',
    label: category,
    category,
  };
}

export function savingsTransaction(amount: number, day: number, period: YearMonth = MARCH_2026): Transaction {
  return {
    id: nextId('transaction'),
    amount: Money.of(amount),
    date: formatDate(dateOf(period, day)),
    kind: 'savings',
    label: 'Épargne',
  };
}

export function incomeTransaction(amount: number, day: number, period: YearMonth = MARCH_2026): Transaction {
  return {
    id: nextId('transaction'),
    amount: Money.of(amount),
    date: formatDate(dateOf(period, day)),
    kind: 'income',
    label: 'Revenu ponctuel',
  };
}

export function debt(
  name: string,
  outstanding: number,
  annualRate: number,
  monthlyPayment: number,
  kind: Debt['kind'] = 'consumerLoan',
): Debt {
  return {
    id: nextId('debt'),
    name,
    kind,
    outstanding: Money.of(outstanding),
    annualRate,
    monthlyPayment: Money.of(monthlyPayment),
    active: true,
  };
}

export function goal(
  name: string,
  target: number,
  options: { current?: number; targetDate?: string; createdAt?: string; priority?: number } = {},
): Goal {
  return {
    id: nextId('goal'),
    name,
    kind: 'purchase',
    target: Money.of(target),
    current: Money.of(options.current ?? 0),
    targetDate: options.targetDate,
    priority: options.priority ?? 1,
    createdAt: options.createdAt ?? '2026-01-01',
    achieved: false,
  };
}

/** Profil de référence utilisé par plusieurs suites : 4 000 € de revenus,
 *  1 380 € de charges fixes, 520 € de dépenses variables constatées. */
export function standardProfile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    ...emptyProfile('EUR'),
    incomes: [income('Salaire', 4000)],
    recurringExpenses: [
      fixedExpense('Loyer', 1200, 'fixed.rent'),
      fixedExpense('Énergie', 150, 'fixed.electricity'),
      fixedExpense('Streaming', 30, 'fixed.subscriptions', { subscription: true }),
    ],
    transactions: [expense(400, 'variable.groceries', 5), expense(120, 'variable.restaurants', 12)],
    accounts: [savingsAccount(5000)],
    preferences: DEFAULT_PREFERENCES,
    ...overrides,
  };
}
