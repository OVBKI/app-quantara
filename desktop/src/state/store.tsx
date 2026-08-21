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
  accountBalance,
  emptyProfile,
  type BudgetPreferences,
  type CustomCategory,
  type Holding,
  type Debt,
  type FinancialProfile,
  type Goal,
  type IncomeSource,
  type RecurringExpense,
  type Transaction,
  detachAccount,
  type CategoryBudget,
  type Account,
} from '../core/model';
import type { ExpenseCategoryId } from '../core/categories';
import { applyCategories } from '../core/categories';
import { analyse, type FinancialAnalysis } from '../core/engine/analysis';
import type { CategorizationRule } from '../core/engine/categorizer';
import {
  containsDate,
  dateOf,
  daysInMonth,
  formatDate,
  parseDate,
  yearMonthOf,
  type YearMonth,
} from '../core/yearMonth';
import { clearProfile, loadStored, saveProfile, unlockStored, withCurrency } from '../storage/persistence';

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

  /** Rend l'identifiant créé : de quoi défaire exactement cet ajout, plus tard, sans
   *  dépendre de l'ordre des actions comme le ferait `undo`. */
  addTransaction(transaction: Omit<Transaction, 'id'>): string;
  updateTransaction(transaction: Transaction): void;
  addTransactions(transactions: readonly Omit<Transaction, 'id'>[]): readonly string[];
  removeTransaction(id: string): void;
  /** Retire plusieurs écritures d'un coup : défaire un partage doit être une seule
   *  action, annulable d'un seul `undo`. */
  removeTransactions(ids: readonly string[]): void;
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

  /** Enregistre le montant réellement touché pour un mois donné. Remplace la saisie
   *  précédente s'il y en avait une : on corrige, on n'empile pas. */
  declareIncome(sourceId: string, period: YearMonth, amount: Money): void;

  addHolding(holding: Omit<Holding, 'id'>): void;
  updateHolding(holding: Holding): void;
  removeHolding(id: string): void;

  saveCategory(category: CustomCategory): void;
  removeCategory(id: string, reassignTo: ExpenseCategoryId): void;

  updatePreferences(preferences: Partial<BudgetPreferences>): void;
  setCurrency(currency: Currency): void;
  /** Revient à l'état précédant la dernière modification. */
  undo(): void;
  readonly canUndo: boolean;
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
  // Le chargement initial a échoué : le fichier existant est intact et le restera.
  const loadFailed = useRef(false);
  // Historique d'annulation. Borné : garder tout un profil par frappe finirait par peser,
  // et personne ne revient vingt modifications en arrière.
  const history = useRef<FinancialProfile[]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);

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
        if (cancelled) return;
        /*
         * Un fichier illisible ne doit **jamais** être écrasé.
         *
         * Sans ce drapeau, l'échec de lecture laissait le profil vide en mémoire, `ready`
         * passait quand même à `true`, et l'effet d'enregistrement réécrivait aussitôt un
         * profil vide par-dessus les données de l'utilisateur — y compris quand le fichier
         * d'origine était chiffré, remplacé alors par un fichier en clair. Le message
         * d'erreur s'affichait après la destruction, et jamais dans l'écran de mise en
         * route qui prenait la main.
         */
        loadFailed.current = true;
        setError(cause instanceof Error ? cause.message : String(cause));
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
    if (!ready || locked || loadFailed.current) return;
    saveProfile(profile, password.current).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [profile, ready, locked]);

  const analysis = useMemo(() => {
    // Le catalogue de catégories est de la donnée de référence : il doit être en place
    // avant que les moteurs ne l'interrogent, sans quoi une catégorie créée par
    // l'utilisateur serait inconnue le temps d'un rendu.
    applyCategories(profile.categories);
    return analyse(profile, period);
  }, [profile, period]);

  const HISTORY_LIMIT = 20;

  const update = useCallback((change: (current: FinancialProfile) => FinancialProfile) => {
    setProfile((current) => {
      const next = change(current);
      if (next === current) return current;
      history.current = [...history.current.slice(-(HISTORY_LIMIT - 1)), current];
      setHistoryDepth(history.current.length);
      return next;
    });
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
        // L'historique contient le profil déchiffré en entier : le garder rendrait le
        // verrouillage décoratif, un Ctrl+Z suffisant à tout ramener en mémoire.
        history.current = [];
        setHistoryDepth(0);
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

      addTransaction: (transaction) => {
        // L'identifiant est tiré avant la mise à jour, et non dedans : l'appelant doit
        // pouvoir le rendre à l'utilisateur (« Annuler ») sans attendre le rendu suivant.
        const entryId = id();
        update((p) => ({ ...p, transactions: [...p.transactions, { ...transaction, id: entryId }] }));
        return entryId;
      },
      updateTransaction: (transaction) =>
        update((p) => ({
          ...p,
          transactions: p.transactions.map((entry) => (entry.id === transaction.id ? transaction : entry)),
        })),

      // Un import ajoute des centaines de lignes : les insérer une par une déclencherait
      // autant de recalculs complets de l'analyse.
      addTransactions: (entries) => {
        const created = entries.map((entry) => ({ ...entry, id: id() }));
        update((p) => ({ ...p, transactions: [...p.transactions, ...created] }));
        return created.map((entry) => entry.id);
      },

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

      removeTransactions: (targets) => {
        const removed = new Set(targets);
        update((p) => ({ ...p, transactions: p.transactions.filter((entry) => !removed.has(entry.id)) }));
      },

      addGoal: (goal) =>
        update((p) => ({
          ...p,
          goals: [...p.goals, { ...goal, id: id(), createdAt: new Date().toISOString().slice(0, 10), achieved: false }],
        })),
      updateGoal: (goal) =>
        update((p) => ({ ...p, goals: p.goals.map((entry) => (entry.id === goal.id ? goal : entry)) })),
      removeGoal: (target) => update((p) => ({ ...p, goals: p.goals.filter((entry) => entry.id !== target) })),

      /**
       * Un versement sur objectif est un mouvement d'argent réel, pas un compteur.
       *
       * Il quitte un compte courant et rejoint un compte d'épargne : le solde disponible
       * baisse, l'épargne monte, et le fonds d'urgence en tient compte. Avant, seul le
       * compteur de l'objectif bougeait — il fallait corriger l'épargne à la main, et
       * personne ne le faisait.
       */
      contributeToGoal: (target, amount) =>
        update((p) => {
          const from = p.accounts.find((entry) => !entry.archived && entry.kind === 'checking');
          const to = p.accounts.find((entry) => !entry.archived && entry.kind === 'savings');
          return {
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
                ...(from ? { accountId: from.id } : {}),
                ...(to ? { toAccountId: to.id } : {}),
              },
            ],
          };
        }),

      addDebt: (debt) => update((p) => ({ ...p, debts: [...p.debts, { ...debt, id: id() }] })),
      updateDebt: (debt) =>
        update((p) => ({ ...p, debts: p.debts.map((entry) => (entry.id === debt.id ? debt : entry)) })),
      removeDebt: (target) => update((p) => ({ ...p, debts: p.debts.filter((entry) => entry.id !== target) })),

      addAccount: (account) => update((p) => ({ ...p, accounts: [...p.accounts, { ...account, id: id() }] })),
      updateAccount: (account) =>
        update((p) => ({ ...p, accounts: p.accounts.map((entry) => (entry.id === account.id ? account : entry)) })),
      // Détache aussi tout ce qui désignait le compte : sans cela les écritures gardent
      // un identifiant mort et sortent du suivi sans un mot.
      removeAccount: (target) => update((p) => detachAccount(p, target)),

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

      /*
       * Changer de devise renomme l'unité de tous les montants.
       *
       * L'application ne connaît aucun taux de change : elle ne peut pas convertir. Elle
       * ne peut pas non plus se contenter de changer l'étiquette du profil, ce qu'elle
       * faisait — les montants gardaient leur devise d'origine et le premier calcul
       * levait « Opération entre devises différentes », pendant le rendu, écran blanc,
       * sur un profil déjà réenregistré dans cet état.
       */
      setCurrency: (currency) => update((p) => withCurrency(p, currency)),

      declareIncome: (sourceId, target, amount) =>
        update((p) => {
          const source = p.incomes.find((entry) => entry.id === sourceId);
          // Daté du jour de réception habituel, ou du dernier jour du mois : la date
          // compte pour la trésorerie, et un revenu daté du 1er décalerait la courbe.
          const day = Math.min(source?.dayOfMonth ?? daysInMonth(target), daysInMonth(target));
          const date = formatDate(dateOf(target, day));

          const others = p.transactions.filter(
            (entry) =>
              !(
                entry.kind === 'income' &&
                entry.incomeSourceId === sourceId &&
                containsDate(target, parseDate(entry.date))
              ),
          );

          // Un montant nul est une réponse : « je n'ai rien touché ce mois-ci ». Il est
          // enregistré comme telle plutôt que laissé en attente indéfinie.
          /*
           * Le compte du revenu, à défaut le compte courant le mieux garni.
           *
           * Sans compte, l'écriture comptait dans le budget mais n'augmentait aucun
           * solde : le suivi ne voyait que des sorties, et tous les comptes finissaient
           * à découvert dans l'application sans l'être dans la réalité.
           */
          const fallback = p.accounts
            .filter((entry) => !entry.archived && (entry.kind === 'checking' || entry.kind === 'cash'))
            .reduce<Account | null>(
              (best, entry) =>
                best === null || accountBalance(p, entry).greaterThan(accountBalance(p, best)) ? entry : best,
              null,
            );
          const accountId = source?.accountId ?? fallback?.id;

          const declared = {
            id: id(),
            amount,
            date,
            kind: 'income' as const,
            label: source?.name ?? 'Revenu',
            incomeCategory: source?.category,
            incomeSourceId: sourceId,
            note: 'Montant déclaré pour le mois',
            ...(accountId ? { accountId } : {}),
          };

          return { ...p, transactions: [...others, declared] };
        }),

      addHolding: (holding) => update((p) => ({ ...p, holdings: [...p.holdings, { ...holding, id: id() }] })),
      updateHolding: (holding) =>
        update((p) => ({ ...p, holdings: p.holdings.map((entry) => (entry.id === holding.id ? holding : entry)) })),
      removeHolding: (target) =>
        update((p) => ({ ...p, holdings: p.holdings.filter((entry) => entry.id !== target) })),

      saveCategory: (category) =>
        update((p) => ({
          ...p,
          categories: p.categories.some((entry) => entry.id === category.id)
            ? p.categories.map((entry) => (entry.id === category.id ? category : entry))
            : [...p.categories, category],
        })),

      // Supprimer une catégorie ne doit jamais orpheliner une transaction : tout ce qui y
      // était classé bascule vers la catégorie choisie, y compris les charges et les
      // enveloppes. Sans cela, des montants disparaîtraient des totaux.
      removeCategory: (target, reassignTo) =>
        update((p) => ({
          ...p,
          categories: p.categories.filter((entry) => entry.id !== target),
          transactions: p.transactions.map((entry) =>
            entry.category === target ? { ...entry, category: reassignTo } : entry,
          ),
          recurringExpenses: p.recurringExpenses.map((entry) =>
            entry.category === target ? { ...entry, category: reassignTo } : entry,
          ),
          categoryBudgets: p.categoryBudgets
            .filter((entry) => entry.category !== target)
            .concat(
              p.categoryBudgets
                .filter((entry) => entry.category === target)
                .map((entry) => ({ ...entry, category: reassignTo })),
            ),
          categorizationRules: p.categorizationRules.map((entry) =>
            entry.category === target ? { ...entry, category: reassignTo } : entry,
          ),
        })),

      undo: () => {
        const previous = history.current.pop();
        if (previous) {
          setProfile(previous);
          setHistoryDepth(history.current.length);
        }
      },
      canUndo: historyDepth > 0,

      // Passe par `update` : un import qui écrase tout doit pouvoir se défaire comme
      // n'importe quelle autre action.
      replaceProfile: (next) => update(() => next),

      reset: async () => {
        await clearProfile();
        /*
         * « Cette action est définitive » doit l'être.
         *
         * L'historique survivait à l'effacement : un Ctrl+Z ramenait tout, et l'effet
         * d'enregistrement réécrivait le fichier — **en clair**, `password` ayant été
         * remis à zéro. Quelqu'un qui efface ses données avant de rendre son poste
         * repartait en croyant le fichier supprimé.
         */
        history.current = [];
        setHistoryDepth(0);
        loadFailed.current = false;
        password.current = null;
        setEncrypted(false);
        setLocked(false);
        setProfile(emptyProfile('EUR'));
      },
    };
  }, [profile, analysis, period, ready, error, locked, encrypted, update, historyDepth]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore doit être utilisé à l’intérieur de StoreProvider');
  return value;
}
