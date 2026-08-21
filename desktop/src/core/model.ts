import { Money, type Currency } from './money';
import type { Frequency } from './frequency';
import type { ExpenseCategoryId, IncomeCategory } from './categories';
import { categoryInfo } from './categories';
import {
  endOfMonth,
  parseDate,
  startOfMonth,
  yearMonthKey,
  yearMonthOf,
  type YearMonth,
} from './yearMonth';
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
  /** Compte sur lequel ce revenu est versé. Sans lui, un encaissement confirmé
   *  n'augmente aucun solde — l'écriture existe, mais elle flotte. */
  readonly accountId?: string;
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
  /** Mois (`AAAA-MM`) dont cette écriture matérialise le partage automatique. Sert à
   *  reconnaître un partage déjà appliqué, et à le défaire d'un seul geste. */
  readonly allocationMonth?: string;
  /** Part du partage à l'origine de l'écriture. */
  readonly allocationPart?: AllocationPart;
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

/**
 * Découpage automatique de ce qui reste.
 *
 * Les charges — fixes, variables, remboursements — sont paramétrées par l'utilisateur.
 * Ce qui subsiste une fois qu'elles sont couvertes se partage en quatre parts, dans des
 * proportions choisies une fois pour toutes. Chaque mois, le partage se refait tout seul
 * sur le disponible réel.
 *
 * Les parts s'appliquent au **reste**, jamais au revenu brut : « 25 % » veut alors dire
 * un quart de ce qui est effectivement libre, et non un quart d'une somme dont l'essentiel
 * est déjà engagé.
 */
export interface AllocationTargets {
  /** Actif : le reste est partagé selon ces parts. Inactif : la cascade par priorité. */
  readonly enabled: boolean;
  /** Matelas pour les imprévus. */
  readonly security: number;
  /** Objectifs : vacances, apport, projet. */
  readonly savings: number;
  readonly investment: number;
  /** Ce qui reste pour vivre, sans affectation. */
  readonly free: number;
}

export const ALLOCATION_PART_LABELS: Record<keyof Omit<AllocationTargets, 'enabled'>, string> = {
  security: 'Argent de sécurité',
  savings: 'Épargne',
  investment: 'Investir',
  free: 'Argent libre',
};

export const DEFAULT_ALLOCATION_TARGETS: AllocationTargets = {
  // Actif par défaut : le partage automatique est le comportement attendu, pas une
  // option à découvrir.
  enabled: true,
  security: 0.3,
  savings: 0.25,
  investment: 0.2,
  free: 0.25,
};

export function allocationTotal(targets: AllocationTargets): number {
  return targets.security + targets.savings + targets.investment + targets.free;
}

export type AllocationPart = keyof Omit<AllocationTargets, 'enabled'>;

export const ALLOCATION_PARTS: readonly AllocationPart[] = ['security', 'savings', 'investment', 'free'];

/**
 * Déplacement d'une part, les autres suivant.
 *
 * Régler quatre curseurs pour retomber sur 100 % est un exercice, pas un réglage. On
 * déplace donc une part et les trois autres se réajustent proportionnellement : le total
 * reste exact par construction, et l'utilisateur n'a jamais à faire l'addition.
 *
 * Le calcul se fait en points entiers de pourcentage. En flottant, quatre parts « qui
 * font 100 % » finissent par 0,9999999 et le partage bascule silencieusement dans la
 * cascade par priorité.
 */
export function rebalanceAllocation(
  targets: AllocationTargets,
  part: AllocationPart,
  share: number,
): AllocationTargets {
  const moved = Math.max(0, Math.min(100, Math.round(share * 100)));
  const others = ALLOCATION_PARTS.filter((key) => key !== part);
  const pool = 100 - moved;
  const currentTotal = others.reduce((sum, key) => sum + Math.round(targets[key] * 100), 0);

  /*
   * Répartition du reste par plus forts restes.
   *
   * Arrondir chaque part indépendamment puis donner le solde à la dernière produisait des
   * parts **négatives** : si les deux premières montaient d'un point chacune, la dernière
   * payait les deux. Une part négative traversait ensuite tout le moteur et le partage
   * proposait de virer plus d'argent qu'il n'en existait.
   *
   * Ici on plancher-arrondit d'abord — donc jamais au-dessus du disponible — puis on
   * distribue les points restants un par un, aux parts dont la décimale perdue était la
   * plus grande. Le total est exact et rien ne peut passer sous zéro.
   */
  const shares = others.map((key) => {
    const weight = currentTotal > 0 ? Math.round(targets[key] * 100) / currentTotal : 1 / others.length;
    const exact = pool * weight;
    return { key, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let distributed = shares.reduce((sum, share) => sum + share.floor, 0);
  const ordered = [...shares].sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; distributed < pool; index += 1) {
    ordered[index % ordered.length]!.floor += 1;
    distributed += 1;
  }

  const points: Record<string, number> = { [part]: moved };
  for (const share of shares) points[share.key] = share.floor;

  return {
    enabled: targets.enabled,
    security: (points.security ?? 0) / 100,
    savings: (points.savings ?? 0) / 100,
    investment: (points.investment ?? 0) / 100,
    free: (points.free ?? 0) / 100,
  };
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
  /** Comptes retenus pour exécuter le partage. */
  readonly allocationAccounts: AllocationAccounts;
}

/**
 * Où atterrit chaque part.
 *
 * Aucune contrainte de nature : l'épargne peut aller sur une assurance-vie, la part
 * d'investissement sur un livret le temps de constituer une somme, la sécurité sur un
 * second compte courant. Quantara propose un compte plausible ; c'est l'utilisateur qui
 * tranche, et son choix est retenu pour les mois suivants.
 *
 * Les identifiants peuvent devenir caducs — un compte se supprime. La résolution retombe
 * alors sur la proposition par défaut plutôt que d'échouer.
 */
export interface AllocationAccounts {
  /** Compte d'où part l'argent. Absent : le compte courant le mieux garni. */
  readonly source?: string;
  readonly security?: string;
  readonly savings?: string;
  readonly investment?: string;
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
  allocationAccounts: {},
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

/**
 * Une charge ou un revenu était-il en vigueur **pendant** un mois donné ?
 *
 * Le critère est le chevauchement, pas une date ponctuelle : un abonnement résilié le
 * 12 mars a bien été payé en mars, et un loyer qui débute le 20 juin concerne le budget de
 * juin. Poser la question sur un seul jour aurait fait disparaître l'un ou l'autre.
 *
 * C'est ce qui rend l'historique stable. Les dates de début et de fin existaient déjà,
 * mais n'étaient évaluées qu'à la date du jour : le budget de mars dernier était calculé
 * avec les charges d'aujourd'hui, si bien qu'une hausse de loyer repeignait tout le passé.
 */
function isActiveDuring(entry: { startDate?: string; endDate?: string }, period: YearMonth): boolean {
  if (entry.startDate && parseDate(entry.startDate) > endOfMonth(period)) return false;
  if (entry.endDate && parseDate(entry.endDate) < startOfMonth(period)) return false;
  return true;
}

export function activeIncomes(profile: FinancialProfile, reference: Date): IncomeSource[] {
  return profile.incomes.filter((income) => income.active && isActiveOn(income, reference));
}

export function activeRecurringExpenses(profile: FinancialProfile, reference: Date): RecurringExpense[] {
  return profile.recurringExpenses.filter((expense) => expense.active && isActiveOn(expense, reference));
}

/** Les revenus en vigueur pendant `period`. À préférer dès qu'un mois est affiché. */
export function incomesFor(profile: FinancialProfile, period: YearMonth): IncomeSource[] {
  return profile.incomes.filter((income) => income.active && isActiveDuring(income, period));
}

/** Les charges récurrentes en vigueur pendant `period`. */
export function recurringExpensesFor(profile: FinancialProfile, period: YearMonth): RecurringExpense[] {
  return profile.recurringExpenses.filter((expense) => expense.active && isActiveDuring(expense, period));
}

export function activeDebts(profile: FinancialProfile): Debt[] {
  return profile.debts.filter((debt) => debt.active && debt.outstanding.isPositive);
}

export function activeGoals(profile: FinancialProfile): Goal[] {
  return [...profile.goals].filter((goal) => !goal.achieved).sort((a, b) => a.priority - b.priority);
}

/**
 * Index des écritures par mois.
 *
 * `transactionsIn` était un parcours complet de la liste, et il est appelé des dizaines de
 * fois pour afficher un seul écran : un budget, six mois d'historique, une comparaison sur
 * douze mois, une médiane sur six. Sur cinq ans d'usage assidu, cela faisait des dizaines
 * de milliers d'éléments parcourus pour un rendu.
 *
 * La clé est le profil lui-même. Il est immuable — chaque modification en produit un
 * nouveau — si bien qu'un index périmé est impossible par construction : un profil
 * différent est un autre objet, donc une autre entrée. La `WeakMap` laisse au ramasse-
 * miettes le soin d'oublier les anciens.
 */
const monthIndexes = new WeakMap<FinancialProfile, Map<string, Transaction[]>>();
const NO_TRANSACTIONS: readonly Transaction[] = [];

function monthIndex(profile: FinancialProfile): Map<string, Transaction[]> {
  const cached = monthIndexes.get(profile);
  if (cached) return cached;

  const index = new Map<string, Transaction[]>();
  for (const transaction of profile.transactions) {
    const key = yearMonthKey(yearMonthOf(parseDate(transaction.date)));
    const bucket = index.get(key);
    if (bucket) bucket.push(transaction);
    else index.set(key, [transaction]);
  }
  monthIndexes.set(profile, index);
  return index;
}

/** Les écritures d'un mois, dans l'ordre où elles ont été enregistrées. Le tableau est
 *  partagé : `readonly` pour que le compilateur interdise de le modifier sur place. */
export function transactionsIn(profile: FinancialProfile, period: YearMonth): readonly Transaction[] {
  return monthIndex(profile).get(yearMonthKey(period)) ?? NO_TRANSACTIONS;
}

/** Retire une clé d'un objet sans écrire `undefined` : le champ disparaît vraiment, y
 *  compris à l'enregistrement. */
function without<T extends object, K extends keyof T>(value: T, key: K): T {
  if (!(key in value)) return value;
  const { [key]: _removed, ...rest } = value;
  return rest as T;
}

/**
 * Suppression d'un compte, avec tout ce qui le désigne.
 *
 * Retirer la ligne du tableau des comptes ne suffit pas : les écritures continuaient de
 * porter son identifiant. Elles n'entraient plus dans aucun solde — le compte n'existe
 * plus — et échappaient aussi à « Écritures sans compte », qui ne cherchait que l'absence
 * totale de compte. L'argent quittait le suivi sans un mot.
 *
 * Tout est détaché en un seul endroit : écritures, source de revenu à créditer, ligne de
 * portefeuille, et compte de destination d'une part de la répartition. Un appelant ne peut
 * pas en oublier un.
 */
export function detachAccount(profile: FinancialProfile, accountId: string): FinancialProfile {
  const allocationAccounts = Object.fromEntries(
    Object.entries(profile.preferences.allocationAccounts).filter(([, id]) => id !== accountId),
  ) as AllocationAccounts;

  return {
    ...profile,
    accounts: profile.accounts.filter((entry) => entry.id !== accountId),
    transactions: profile.transactions.map((transaction) => {
      let updated = transaction;
      if (updated.accountId === accountId) updated = without(updated, 'accountId');
      if (updated.toAccountId === accountId) updated = without(updated, 'toAccountId');
      return updated;
    }),
    incomes: profile.incomes.map((income) =>
      income.accountId === accountId ? without(income, 'accountId') : income,
    ),
    holdings: profile.holdings.map((holding) =>
      holding.accountId === accountId ? without(holding, 'accountId') : holding,
    ),
    preferences: { ...profile.preferences, allocationAccounts },
  };
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
 * Une charge est-elle un abonnement ?
 *
 * La case « C'est un abonnement » **ou** la catégorie « Abonnements ». Deux modules
 * répondaient différemment : l'écran Abonnements retenait les deux critères, la tuile du
 * Budget seulement la case. Une charge rangée dans la bonne catégorie mais dont la case
 * n'avait pas été cochée figurait donc à un endroit et pas à l'autre, pour le même mois.
 *
 * Le critère large est le bon : choisir la catégorie « Abonnements » est déjà une
 * déclaration d'intention, et oublier la case n'a pas à coûter une ligne dans la liste.
 */
export function isSubscription(expense: RecurringExpense): boolean {
  return expense.subscription || expense.category === 'fixed.subscriptions';
}

/**
 * Effet d'une transaction sur le solde d'un compte.
 *
 * Une seule table, à un seul endroit. C'est ce qui permet de déduire un solde au lieu de
 * le stocker, et donc de le voir se corriger tout seul quand une transaction est modifiée
 * ou supprimée.
 */
export function movementOn(accountId: string, transaction: Transaction): Money | null {
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
/**
 * Écritures triées par date, avec leur date déjà analysée.
 *
 * `accountBalance` parcourait toute la liste et analysait la date de chaque écriture pour
 * n'en retenir qu'une poignée — celles postérieures au relevé. La prévision de trésorerie
 * l'appelle une fois par jour et par compte : sur cinq ans d'usage, cela faisait plusieurs
 * centaines de milliers d'analyses de date pour afficher un écran.
 *
 * Même clé que l'index par mois, et pour la même raison : le profil est immuable, donc un
 * index périmé est impossible.
 */
interface DatedTransaction {
  readonly at: number;
  readonly transaction: Transaction;
}

const datedIndexes = new WeakMap<FinancialProfile, readonly DatedTransaction[]>();

function datedTransactions(profile: FinancialProfile): readonly DatedTransaction[] {
  const cached = datedIndexes.get(profile);
  if (cached) return cached;

  const dated = profile.transactions
    .map((transaction) => ({ at: parseDate(transaction.date).getTime(), transaction }))
    .sort((a, b) => a.at - b.at);
  datedIndexes.set(profile, dated);
  return dated;
}

/** Première écriture strictement postérieure à `time`. Recherche dichotomique : la liste
 *  est triée, il n'y a aucune raison de la parcourir. */
function firstAfter(dated: readonly DatedTransaction[], time: number): number {
  let low = 0;
  let high = dated.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (dated[middle]!.at <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function accountBalance(
  profile: FinancialProfile,
  account: Account,
  reference: Date = new Date(),
): Money {
  const since = parseDate(account.balanceDate).getTime();
  const until = reference.getTime();
  const dated = datedTransactions(profile);
  let balance = account.openingBalance;

  for (let index = firstAfter(dated, since); index < dated.length; index += 1) {
    const entry = dated[index]!;
    if (entry.at > until) break;
    const movement = movementOn(account.id, entry.transaction);
    if (movement) balance = balance.plus(movement);
  }
  return balance;
}

/**
 * Comptes dont la valeur est donnée par des lignes de portefeuille.
 *
 * Leur solde ne compte plus nulle part ailleurs : ce sont les lignes qui font foi. La
 * règle vaut quelle que soit la **nature** du compte — un compte peut être requalifié
 * après coup dans les Réglages, et n'exclure que les comptes de type « placement »
 * laissait la ligne s'ajouter au solde du livret au lieu de le remplacer : le patrimoine
 * doublait.
 */
function accountsValuedByHoldings(profile: FinancialProfile): Set<string> {
  return new Set(
    profile.holdings.map((holding) => holding.accountId).filter((id): id is string => id !== undefined),
  );
}

function balanceOfKinds(
  profile: FinancialProfile,
  kinds: readonly AccountKind[],
  reference: Date,
): Money {
  const detailed = accountsValuedByHoldings(profile);
  return Money.sum(
    profile.accounts
      .filter((account) => !account.archived && kinds.includes(account.kind) && !detailed.has(account.id))
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
  const detailed = accountsValuedByHoldings(profile);
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
