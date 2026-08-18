import { Money, type Currency } from './money';
import type { Frequency } from './frequency';
import type { ExpenseCategoryId, IncomeCategory } from './categories';
import { categoryInfo } from './categories';
import { containsDate, parseDate, type YearMonth } from './yearMonth';
import type { CategorizationRule } from './engine/categorizer';
import type { IncomePlanningMode } from './engine/income';
import { DEFAULT_ALERT_PREFERENCES, type AlertPreferences } from './engine/alerts';

/** Toutes les entités sont immuables : un état modifié est un nouvel objet, ce qui rend
 *  le rendu React prévisible et le calcul reproductible. */

export type AccountKind = 'checking' | 'savings' | 'investment' | 'cash';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  /**
   * Solde constaté à la date `balanceDate`, et rien d'autre.
   *
   * Le solde courant n'est pas stocké : il se déduit de ce point de départ et des
   * mouvements postérieurs (`accountBalance`). Un solde stocké et mis à jour à la main
   * dérive dès qu'une transaction est corrigée ou supprimée ; un solde déduit se répare
   * tout seul.
   */
  readonly openingBalance: Money;
  /** Date du relevé ci-dessus. Les mouvements antérieurs y sont déjà inclus. */
  readonly balanceDate: string;
  readonly archived?: boolean;
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
  /**
   * Le montant est saisi chaque mois, exactement.
   *
   * Pour un revenu trop irrégulier pour qu'une fourchette veuille dire quoi que ce soit.
   * L'application ne suppose alors rien : elle demande, en fin de mois, ce qui a été
   * réellement touché. Tant que le mois n'est pas déclaré, le revenu est traité comme
   * **inconnu** — pas comme une moyenne déguisée en certitude.
   */
  readonly declaredMonthly?: boolean;
  /** Mois faible. Facultatif : à défaut, le typique moins 20 %. */
  readonly minAmount?: Money;
  /** Mois fort. Facultatif : à défaut, le typique plus 20 %. */
  readonly maxAmount?: Money;
  /** Jour de réception dans le mois. Détermine la forme de la courbe de trésorerie :
   *  payé le 2 ou le 28, le point bas du mois n'est pas du tout le même. Absent, la
   *  prévision retient le 28 — l'hypothèse la moins favorable. */
  readonly dayOfMonth?: number;
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
  /** Compte d'où part l'argent (ou vers lequel il arrive, pour un revenu). */
  readonly accountId?: string;
  /** Compte destinataire d'un virement ou d'un versement d'épargne. Un virement n'est
   *  pas une dépense : il déplace de l'argent, il n'en fait pas disparaître. */
  readonly toAccountId?: string;
  /** Renseigné quand la transaction matérialise une charge déjà déclarée comme
   *  récurrente : elle est alors exclue du variable, sinon elle compterait deux fois. */
  readonly recurringExpenseId?: string;
  readonly incomeSourceId?: string;
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

export type GoalKind =
  | 'emergencyFund'
  | 'purchase'
  | 'travel'
  | 'property'
  | 'education'
  | 'retirement'
  | 'investment'
  | 'project'
  | 'otherGoal';

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

export interface CategoryBudget {
  readonly category: ExpenseCategoryId;
  readonly limit: Money;
}

export type AssetClassId = 'etf' | 'stocks' | 'bonds' | 'funds' | 'realEstate' | 'cashEquivalent' | 'otherAsset';

/**
 * Une ligne de portefeuille.
 *
 * L'application enregistre ce que vous décidez de placer et ce que cela vaut aujourd'hui.
 * Elle ne recommande aucun produit et ne va chercher aucun cours : la valeur actuelle est
 * saisie par vous, à la date que vous voulez.
 */
export interface Holding {
  readonly id: string;
  readonly name: string;
  readonly assetClass: AssetClassId;
  /** Somme réellement versée, hors plus-value. Sert à mesurer l'évolution. */
  readonly invested: Money;
  /** Valeur au dernier relevé. */
  readonly currentValue: Money;
  readonly valuedOn: string;
  readonly accountId?: string;
  readonly note?: string;
}

/**
 * Catégorie définie par l'utilisateur, ou redéfinition d'une catégorie livrée.
 *
 * Le catalogue par défaut couvre le cas courant ; il ne couvre pas tout le monde. Une
 * entrée dont l'`id` reprend celui d'une catégorie livrée la remplace — c'est ainsi qu'on
 * renomme « Courses » en « Alimentation » sans casser les transactions déjà classées.
 */
export interface CustomCategory {
  readonly id: string;
  readonly label: string;
  readonly kind: 'fixed' | 'variable';
  readonly essential: boolean;
  /** 0 = incompressible, 1 = entièrement discrétionnaire. */
  readonly compressibility: number;
  readonly color: string;
  readonly icon: string;
  /** Une catégorie livrée qu'on ne veut pas voir : masquée plutôt que supprimée, pour ne
   *  pas orpheliner les transactions historiques. */
  readonly hidden?: boolean;
}

/** Répartition cible du revenu, en parts. Modifiable, contrôlée à 100 %. */
export interface AllocationTargets {
  /** Actif : le plan suit ces parts. Inactif : la cascade par défaut s'applique. */
  readonly enabled: boolean;
  readonly needs: number;
  readonly savings: number;
  readonly investment: number;
  readonly free: number;
}

export const DEFAULT_ALLOCATION_TARGETS: AllocationTargets = {
  enabled: false,
  needs: 0.5,
  savings: 0.2,
  investment: 0.2,
  free: 0.1,
};

export function allocationTotal(targets: AllocationTargets): number {
  return targets.needs + targets.savings + targets.investment + targets.free;
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
  /** Notifications système. Toutes facultatives, toutes désactivables une par une. */
  readonly alerts: AlertPreferences;
  /** Échelle du texte, de 0,9 à 1,4. L'équivalent de bureau du Dynamic Type d'iOS :
   *  une application de finances personnelles se consulte à tout âge. */
  readonly textScale: number;
  /** La mise en route a été parcourue jusqu'au bout. Sans ce drapeau, un profil dont on
   *  aurait supprimé tous les revenus repartirait dans la mise en route — et une mise en
   *  route entièrement sautée bouclerait indéfiniment. */
  readonly onboardingCompleted: boolean;
  /** Répartition cible du revenu, si l'utilisateur en a défini une. */
  readonly allocationTargets: AllocationTargets;
}

export const DEFAULT_PREFERENCES: BudgetPreferences = {
  incomePlanning: 'prudent',
  emergencyFundMonths: 6,
  smoothIncome: true,
  riskProfile: 'balanced',
  minimumFreeShare: 0.1,
  alerts: DEFAULT_ALERT_PREFERENCES,
  textScale: 1,
  onboardingCompleted: false,
  allocationTargets: DEFAULT_ALLOCATION_TARGETS,
};

export interface FinancialProfile {
  readonly currency: Currency;
  readonly accounts: readonly Account[];
  readonly incomes: readonly IncomeSource[];
  readonly recurringExpenses: readonly RecurringExpense[];
  readonly transactions: readonly Transaction[];
  readonly debts: readonly Debt[];
  readonly goals: readonly Goal[];
  readonly categoryBudgets: readonly CategoryBudget[];
  /** Règles apprises quand l'utilisateur corrige une catégorie : il ne doit pas avoir
   *  à recorriger le même marchand le mois suivant. */
  readonly categorizationRules: readonly CategorizationRule[];
  /** Catégories créées ou redéfinies par l'utilisateur. */
  readonly categories: readonly CustomCategory[];
  readonly holdings: readonly Holding[];
  readonly preferences: BudgetPreferences;
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
    categoryBudgets: [],
    categorizationRules: [],
    categories: [],
    holdings: [],
    preferences: DEFAULT_PREFERENCES,
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

/**
 * Effet d'une transaction sur le solde d'un compte.
 *
 * Une seule table, à un seul endroit. C'est ce qui permet de déduire un solde au lieu de
 * le stocker, et donc de le voir se corriger tout seul quand une transaction est modifiée
 * ou supprimée.
 */
function movementOn(accountId: string, transaction: Transaction): Money | null {
  const currency = transaction.amount.currency;
  const leaves = transaction.accountId === accountId;
  const arrives = transaction.toAccountId === accountId;

  switch (transaction.kind) {
    case 'income':
      return leaves ? transaction.amount : null;
    case 'expense':
    case 'debtPayment':
      return leaves ? Money.zero(currency).minus(transaction.amount) : null;
    case 'savings':
    case 'transfer':
      // Sort d'un compte, entre dans l'autre. Le total du patrimoine ne bouge pas.
      if (leaves) return Money.zero(currency).minus(transaction.amount);
      if (arrives) return transaction.amount;
      return null;
  }
}

/**
 * Solde d'un compte : son relevé, plus les mouvements postérieurs.
 *
 * Les transactions antérieures à `balanceDate` sont ignorées : elles sont déjà comprises
 * dans le relevé. Sans cette règle, importer un an d'historique ferait exploser le solde.
 */
export function accountBalance(
  profile: FinancialProfile,
  account: Account,
  reference: Date = new Date(),
): Money {
  const since = parseDate(account.balanceDate);
  let balance = account.openingBalance;

  for (const transaction of profile.transactions) {
    const date = parseDate(transaction.date);
    if (date <= since || date > reference) continue;
    const movement = movementOn(account.id, transaction);
    if (movement) balance = balance.plus(movement);
  }
  return balance;
}

function balanceOfKinds(
  profile: FinancialProfile,
  kinds: readonly AccountKind[],
  reference: Date,
): Money {
  return Money.sum(
    profile.accounts
      .filter((account) => !account.archived && kinds.includes(account.kind))
      .map((account) => accountBalance(profile, account, reference)),
    profile.currency,
  );
}

/** Argent immédiatement disponible : comptes courants et espèces. */
export function availableBalance(profile: FinancialProfile, reference: Date = new Date()): Money {
  return balanceOfKinds(profile, ['checking', 'cash'], reference);
}

export function totalSavingsBalance(profile: FinancialProfile, reference: Date = new Date()): Money {
  return balanceOfKinds(profile, ['savings'], reference);
}

/**
 * Valeur des placements.
 *
 * Une ligne de portefeuille rattachée à un compte remplace le solde de ce compte : sans
 * cette règle, détailler ses placements les compterait deux fois — l'erreur exacte que
 * l'ancien `savingsBalance` produisait à côté des comptes d'épargne.
 */
export function totalInvestmentsBalance(profile: FinancialProfile, reference: Date = new Date()): Money {
  const detailed = new Set(profile.holdings.map((holding) => holding.accountId).filter(Boolean));
  const fromAccounts = profile.accounts
    .filter((account) => !account.archived && account.kind === 'investment' && !detailed.has(account.id))
    .map((account) => accountBalance(profile, account, reference));
  const fromHoldings = profile.holdings.map((holding) => holding.currentValue);
  return Money.sum([...fromAccounts, ...fromHoldings], profile.currency);
}

/** Total net : disponible + épargne + placements. */
export function netWorth(profile: FinancialProfile, reference: Date = new Date()): Money {
  return Money.sum(
    [
      availableBalance(profile, reference),
      totalSavingsBalance(profile, reference),
      totalInvestmentsBalance(profile, reference),
    ],
    profile.currency,
  );
}
