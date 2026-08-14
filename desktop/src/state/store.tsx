import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Money, type Currency } from '../core/money';
import {
  emptyProfile,
  type BudgetPreferences,
  type Debt,
  type FinancialProfile,
  type Goal,
  type IncomeSource,
  type RecurringExpense,
  type Transaction,
  type CategoryBudget,
  type Account,
} from '../core/model';
import { analyse, type FinancialAnalysis } from '../core/engine/analysis';
import type { CategorizationRule } from '../core/engine/categorizer';
import { yearMonthOf, type YearMonth } from '../core/yearMonth';
import { clearProfile, loadStored, saveProfile, unlockStored } from '../storage/persistence';

interface StoreValue {
  readonly profile: FinancialProfile;
  readonly analysis: FinancialAnalysis;
  readonly period: YearMonth;
  readonly ready: boolean;
  readonly error: string | null;
  /** Le fichier est chiffré et le mot de passe n'a pas encore été fourni. */
  readonly locked: boolean;
  readonly encrypted: boolean;
  setPeriod(period: YearMonth): void;

  unlock(password: string): Promise<void>;
  lock(): void;
  enableEncryption(password: string): Promise<void>;
  disableEncryption(): Promise<void>;

  addIncome(income: Omit<IncomeSource, 'id'>): void;
  updateIncome(income: IncomeSource): void;
  removeIncome(id: string): void;

  addExpense(expense: Omit<RecurringExpense, 'id'>): void;
  updateExpense(expense: RecurringExpense): void;
  removeExpense(id: string): void;

  addTransaction(transaction: Omit<Transaction, 'id'>): void;
  updateTransaction(transaction: Transaction): void;
  addTransactions(transactions: readonly Omit<Transaction, 'id'>[]): void;
  removeTransaction(id: string): void;
  learnCategorization(rule: CategorizationRule): void;

  addGoal(goal: Omit<Goal, 'id' | 'createdAt' | 'achieved'>): void;
  updateGoal(goal: Goal): void;
  removeGoal(id: string): void;
  contributeToGoal(id: string, amount: Money): void;

  addDebt(debt: Omit<Debt, 'id'>): void;
  updateDebt(debt: Debt): void;
  removeDebt(id: string): void;

  addAccount(account: Omit<Account, 'id'>): void;
  updateAccount(account: Account): void;
  removeAccount(id: string): void;

  setCategoryBudget(budget: CategoryBudget): void;
  removeCategoryBudget(category: CategoryBudget['category']): void;

  updatePreferences(preferences: Partial<BudgetPreferences>): void;
  setCurrency(currency: Currency): void;
  setBalances(savings: Money, investments: Money): void;
  replaceProfile(profile: FinancialProfile): void;
  reset(): Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

function id(): string {
  return crypto.randomUUID();
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<FinancialProfile>(() => emptyProfile('EUR'));
  const [period, setPeriod] = useState<YearMonth>(() => yearMonthOf(new Date()));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [encrypted, setEncrypted] = useState(false);
  // Le mot de passe ne vit qu'en mémoire, et jamais dans l'état React : il n'a aucune
  // raison de déclencher un rendu, ni de se retrouver dans un instantané de débogage.
  const password = useRef<string | null>(null);

  // Chargement initial. Tant qu'il n'a pas abouti, rien n'est enregistré : sans ce
  // garde-fou, le profil vide de départ écraserait le fichier existant.
  useEffect(() => {
    let cancelled = false;
    loadStored()
      .then((stored) => {
        if (cancelled) return;
        if (stored.kind === 'profile') setProfile(stored.profile);
        if (stored.kind === 'encrypted') {
          setEncrypted(true);
          setLocked(true);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Tant que le profil est verrouillé, il est vide en mémoire : l'enregistrer
    // écraserait le fichier chiffré par un profil sans données.
    if (!ready || locked) return;
    saveProfile(profile, password.current).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [profile, ready, locked]);

  const analysis = useMemo(() => analyse(profile, period), [profile, period]);

  const update = useCallback((change: (current: FinancialProfile) => FinancialProfile) => {
    setProfile((current) => change(current));
  }, []);

  const value = useMemo<StoreValue>(() => {
    return {
      profile,
      analysis,
      period,
      ready,
      error,
      locked,
      encrypted,
      setPeriod,

      unlock: async (candidate) => {
        const stored = await unlockStored(candidate);
        password.current = candidate;
        setProfile(stored);
        setLocked(false);
        setError(null);
      },

      lock: () => {
        if (!encrypted) return;
        password.current = null;
        setProfile(emptyProfile('EUR'));
        setLocked(true);
      },

      enableEncryption: async (candidate) => {
        await saveProfile(profile, candidate);
        password.current = candidate;
        setEncrypted(true);
      },

      disableEncryption: async () => {
        await saveProfile(profile, null);
        password.current = null;
        setEncrypted(false);
      },


      addIncome: (income) => update((p) => ({ ...p, incomes: [...p.incomes, { ...income, id: id() }] })),
      updateIncome: (income) =>
        update((p) => ({ ...p, incomes: p.incomes.map((entry) => (entry.id === income.id ? income : entry)) })),
      removeIncome: (target) => update((p) => ({ ...p, incomes: p.incomes.filter((entry) => entry.id !== target) })),

      addExpense: (expense) =>
        update((p) => ({ ...p, recurringExpenses: [...p.recurringExpenses, { ...expense, id: id() }] })),
      updateExpense: (expense) =>
        update((p) => ({
          ...p,
          recurringExpenses: p.recurringExpenses.map((entry) => (entry.id === expense.id ? expense : entry)),
        })),
      removeExpense: (target) =>
        update((p) => ({ ...p, recurringExpenses: p.recurringExpenses.filter((entry) => entry.id !== target) })),

      addTransaction: (transaction) =>
        update((p) => ({ ...p, transactions: [...p.transactions, { ...transaction, id: id() }] })),
      updateTransaction: (transaction) =>
        update((p) => ({
          ...p,
          transactions: p.transactions.map((entry) => (entry.id === transaction.id ? transaction : entry)),
        })),

      // Un import ajoute des centaines de lignes : les insérer une par une déclencherait
      // autant de recalculs complets de l'analyse.
      addTransactions: (entries) =>
        update((p) => ({
          ...p,
          transactions: [...p.transactions, ...entries.map((entry) => ({ ...entry, id: id() }))],
        })),

      learnCategorization: (rule) =>
        update((p) => ({
          ...p,
          categorizationRules: [
            ...p.categorizationRules.filter((entry) => entry.pattern !== rule.pattern),
            rule,
          ],
        })),
      removeTransaction: (target) =>
        update((p) => ({ ...p, transactions: p.transactions.filter((entry) => entry.id !== target) })),

      addGoal: (goal) =>
        update((p) => ({
          ...p,
          goals: [...p.goals, { ...goal, id: id(), createdAt: new Date().toISOString().slice(0, 10), achieved: false }],
        })),
      updateGoal: (goal) =>
        update((p) => ({ ...p, goals: p.goals.map((entry) => (entry.id === goal.id ? goal : entry)) })),
      removeGoal: (target) => update((p) => ({ ...p, goals: p.goals.filter((entry) => entry.id !== target) })),

      // Un versement alimente l'objectif et laisse une trace dans les transactions :
      // sans elle, le taux d'épargne du mois ignorerait l'effort réalisé.
      contributeToGoal: (target, amount) =>
        update((p) => ({
          ...p,
          goals: p.goals.map((entry) =>
            entry.id === target
              ? {
                  ...entry,
                  current: entry.current.plus(amount),
                  achieved: entry.current.plus(amount).greaterThanOrEqual(entry.target),
                }
              : entry,
          ),
          transactions: [
            ...p.transactions,
            {
              id: id(),
              amount,
              date: new Date().toISOString().slice(0, 10),
              kind: 'savings' as const,
              label: p.goals.find((entry) => entry.id === target)?.name ?? 'Épargne',
              goalId: target,
            },
          ],
        })),

      addDebt: (debt) => update((p) => ({ ...p, debts: [...p.debts, { ...debt, id: id() }] })),
      updateDebt: (debt) =>
        update((p) => ({ ...p, debts: p.debts.map((entry) => (entry.id === debt.id ? debt : entry)) })),
      removeDebt: (target) => update((p) => ({ ...p, debts: p.debts.filter((entry) => entry.id !== target) })),

      addAccount: (account) => update((p) => ({ ...p, accounts: [...p.accounts, { ...account, id: id() }] })),
      updateAccount: (account) =>
        update((p) => ({ ...p, accounts: p.accounts.map((entry) => (entry.id === account.id ? account : entry)) })),
      removeAccount: (target) =>
        update((p) => ({ ...p, accounts: p.accounts.filter((entry) => entry.id !== target) })),

      setCategoryBudget: (budget) =>
        update((p) => ({
          ...p,
          categoryBudgets: [
            ...p.categoryBudgets.filter((entry) => entry.category !== budget.category),
            budget,
          ],
        })),
      removeCategoryBudget: (category) =>
        update((p) => ({ ...p, categoryBudgets: p.categoryBudgets.filter((entry) => entry.category !== category) })),

      updatePreferences: (preferences) =>
        update((p) => ({ ...p, preferences: { ...p.preferences, ...preferences } })),

      setCurrency: (currency) => update((p) => ({ ...p, currency })),

      setBalances: (savings, investments) =>
        update((p) => ({ ...p, savingsBalance: savings, investmentsBalance: investments })),

      replaceProfile: (next) => setProfile(next),

      reset: async () => {
        await clearProfile();
        password.current = null;
        setEncrypted(false);
        setLocked(false);
        setProfile(emptyProfile('EUR'));
      },
    };
  }, [profile, analysis, period, ready, error, locked, encrypted, update]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore doit être utilisé à l’intérieur de StoreProvider');
  return value;
}
