import { Money, type Currency } from './money';
import type { Frequency } from './frequency';
import type { ExpenseCategoryId, IncomeCategory } from './categories';
import { categoryInfo } from './categories';
import { containsDate, parseDate, type YearMonth } from './yearMonth';
import type { CategorizationRule } from './engine/categorizer';
import type { IncomePlanningMode } from './engine/income';

/** Toutes les entités sont immuables : un état modifié est un nouvel objet, ce qui rend
 *  le rendu React prévisible et le calcul reproductible. */

export type AccountKind = 'checking' | 'savings' | 'investment' | 'cash';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly balance: Money;
}

export interface IncomeSource {
  readonly id: string;
  readonly name: string;
  /** Montant typique — celui d'un mois ordinaire. */
  readonly amount: Money;
  readonly frequency: Frequency;
  readonly category: IncomeCategory;
  /** Un revenu variable (indépendant, primes, heures supplémentaires) n'est pas projeté
   *  comme un salaire fixe : il porte une fourchette et se planifie sur son bas. */
  readonly variable: boolean;
  /** Mois faible. Facultatif : à défaut, le typique moins 20 %. */
  readonly minAmount?: Money;
  /** Mois fort. Facultatif : à défaut, le typique plus 20 %. */
  readonly maxAmount?: Money;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly active: boolean;
}

export interface RecurringExpense {
  readonly id: string;
  readonly name: string;
  readonly amount: Money;
  readonly frequency: Frequency;
  readonly category: ExpenseCategoryId;
  readonly dayOfMonth: number;
  readonly subscription: boolean;
  /** Force le caractère essentiel, quand la catégorie ne suffit pas à trancher. */
  readonly essentialOverride?: boolean;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly active: boolean;
}

export type TransactionKind = 'expense' | 'income' | 'savings' | 'transfer' | 'debtPayment';

export interface Transaction {
  readonly id: string;
  /** Toujours positif : c'est `kind` qui porte le sens, jamais le signe. */
  readonly amount: Money;
  readonly date: string; // ISO
  readonly kind: TransactionKind;
  readonly label: string;
  readonly category?: ExpenseCategoryId;
  readonly incomeCategory?: IncomeCategory;
  readonly note?: string;
  readonly goalId?: string;
  readonly accountId?: string;
  /** Renseigné quand la transaction matérialise une charge déjà déclarée comme
   *  récurrente : elle est alors exclue du variable, sinon elle compterait deux fois. */
  readonly recurringExpenseId?: string;
  readonly incomeSourceId?: string;
  /** Versement reçu d'une société de financement. Exclu des revenus ordinaires : il ne
   *  se planifie pas comme un salaire. */
  readonly tradingAccountId?: string;
}

export type DebtKind = 'creditCard' | 'consumerLoan' | 'carLoan' | 'studentLoan' | 'mortgage' | 'overdraft' | 'otherDebt';

export interface Debt {
  readonly id: string;
  readonly name: string;
  readonly kind: DebtKind;
  readonly outstanding: Money;
  readonly annualRate: number;
  readonly monthlyPayment: Money;
  readonly active: boolean;
}

/** Au-delà de ce taux, rembourser rapporte plus, et plus sûrement, que placer. */
export const HIGH_INTEREST_THRESHOLD = 0.08;

export function isHighInterest(debt: Debt): boolean {
  return debt.annualRate >= HIGH_INTEREST_THRESHOLD;
}

export type GoalKind = 'emergencyFund' | 'purchase' | 'travel' | 'property' | 'education' | 'retirement' | 'otherGoal';

export interface Goal {
  readonly id: string;
  readonly name: string;
  readonly kind: GoalKind;
  readonly target: Money;
  readonly current: Money;
  readonly targetDate?: string;
  readonly monthlyContribution?: Money;
  readonly priority: number;
  readonly createdAt: string;
  readonly achieved: boolean;
}

export type PropFirmPhase = 'challenge' | 'verification' | 'funded' | 'failed' | 'closed';

/**
 * Compte auprès d'une société de financement.
 *
 * `accountSize` est le capital confié, jamais un avoir : il n'entre dans aucun calcul de
 * patrimoine. `fee` est le prix de l'épreuve — c'est le seul montant réellement engagé,
 * et donc le seul qui pèse sur le budget.
 */
export interface TradingAccount {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly phase: PropFirmPhase;
  readonly accountSize: Money;
  readonly fee: Money;
  /** Part des gains revenant au trader, de 0 à 1. */
  readonly profitSplit: number;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface CategoryBudget {
  readonly category: ExpenseCategoryId;
  readonly limit: Money;
}

export type RiskProfile = 'cautious' | 'balanced' | 'dynamic';

export interface BudgetPreferences {
  /** Hypothèse retenue pour les revenus irréguliers. */
  readonly incomePlanning: IncomePlanningMode;
  /** Nombre de mois de dépenses visés pour le fonds d'urgence (3, 6 ou 9). */
  readonly emergencyFundMonths: number;
  /** Lisse les revenus irréguliers sur la médiane des mois passés. */
  readonly smoothIncome: boolean;
  readonly riskProfile: RiskProfile;
  /** Part du disponible laissée libre quoi qu'il arrive : un plan qui ne laisse rien
   *  pour vivre n'est pas tenu. */
  readonly minimumFreeShare: number;
}

export const DEFAULT_PREFERENCES: BudgetPreferences = {
  incomePlanning: 'prudent',
  emergencyFundMonths: 6,
  smoothIncome: true,
  riskProfile: 'balanced',
  minimumFreeShare: 0.1,
};

export interface FinancialProfile {
  readonly currency: Currency;
  readonly accounts: readonly Account[];
  readonly incomes: readonly IncomeSource[];
  readonly recurringExpenses: readonly RecurringExpense[];
  readonly transactions: readonly Transaction[];
  readonly debts: readonly Debt[];
  readonly goals: readonly Goal[];
  readonly tradingAccounts: readonly TradingAccount[];
  readonly categoryBudgets: readonly CategoryBudget[];
  /** Règles apprises quand l'utilisateur corrige une catégorie : il ne doit pas avoir
   *  à recorriger le même marchand le mois suivant. */
  readonly categorizationRules: readonly CategorizationRule[];
  readonly preferences: BudgetPreferences;
  readonly savingsBalance: Money;
  readonly investmentsBalance: Money;
}

export function emptyProfile(currency: Currency = 'EUR'): FinancialProfile {
  return {
    currency,
    accounts: [],
    incomes: [],
    recurringExpenses: [],
    transactions: [],
    debts: [],
    goals: [],
    tradingAccounts: [],
    categoryBudgets: [],
    categorizationRules: [],
    preferences: DEFAULT_PREFERENCES,
    savingsBalance: Money.zero(currency),
    investmentsBalance: Money.zero(currency),
  };
}

// --- Sélecteurs ---

function isActiveOn(entry: { startDate?: string; endDate?: string }, reference: Date): boolean {
  if (entry.startDate && parseDate(entry.startDate) > reference) return false;
  if (entry.endDate && parseDate(entry.endDate) < reference) return false;
  return true;
}

export function activeIncomes(profile: FinancialProfile, reference: Date): IncomeSource[] {
  return profile.incomes.filter((income) => income.active && isActiveOn(income, reference));
}

export function activeRecurringExpenses(profile: FinancialProfile, reference: Date): RecurringExpense[] {
  return profile.recurringExpenses.filter((expense) => expense.active && isActiveOn(expense, reference));
}

export function activeDebts(profile: FinancialProfile): Debt[] {
  return profile.debts.filter((debt) => debt.active && debt.outstanding.isPositive);
}

export function activeGoals(profile: FinancialProfile): Goal[] {
  return [...profile.goals].filter((goal) => !goal.achieved).sort((a, b) => a.priority - b.priority);
}

export function transactionsIn(profile: FinancialProfile, period: YearMonth): Transaction[] {
  return profile.transactions.filter((transaction) => containsDate(period, parseDate(transaction.date)));
}

/** Une transaction rattachée à une charge récurrente ou à une source de revenu déjà
 *  déclarée est une matérialisation, pas un flux supplémentaire. */
export function isRecurringInstance(transaction: Transaction): boolean {
  return transaction.recurringExpenseId !== undefined || transaction.incomeSourceId !== undefined;
}

export function isEssential(expense: RecurringExpense): boolean {
  return expense.essentialOverride ?? categoryInfo(expense.category).essential;
}

export function totalSavingsBalance(profile: FinancialProfile): Money {
  const fromAccounts = profile.accounts
    .filter((account) => account.kind === 'savings')
    .map((account) => account.balance);
  return Money.sum([profile.savingsBalance, ...fromAccounts], profile.currency);
}
