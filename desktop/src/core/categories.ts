/**
 * Catégories du cahier des charges.
 *
 * Chaque catégorie porte deux informations que les moteurs exploitent :
 * `essential` (peut-on la couper sans mettre le foyer en difficulté ?) et,
 * pour les dépenses variables, `compressibility` (marge de manœuvre réaliste,
 * de 0 = incompressible à 1 = entièrement discrétionnaire).
 */

export type IncomeCategory =
  | 'salary'
  | 'freelance'
  | 'benefits'
  | 'rental'
  | 'investment'
  | 'pension'
  | 'bonus'
  | 'otherIncome';

export type FixedExpenseCategory =
  | 'rent'
  | 'mortgage'
  | 'electricity'
  | 'water'
  | 'gas'
  | 'internet'
  | 'phone'
  | 'insurance'
  | 'subscriptions'
  | 'childcare'
  | 'schooling'
  | 'loanRepayment'
  | 'taxes'
  | 'otherFixed';

export type VariableExpenseCategory =
  | 'groceries'
  | 'restaurants'
  | 'fuel'
  | 'publicTransport'
  | 'leisure'
  | 'clothing'
  | 'health'
  | 'household'
  | 'gifts'
  | 'travel'
  | 'education'
  | 'children'
  | 'pets'
  | 'personal'
  | 'otherVariable';

/** Identifiant stable, utilisé en base et dans les échanges. Ne jamais le renommer. */
/**
 * Identifiant stable d'une catégorie.
 *
 * Les catégories livrées portent un identifiant connu à la compilation ; celles créées
 * par l'utilisateur, non. Le type reste donc ouvert (`string`), au prix de
 * l'exhaustivité — c'est le prix à payer pour que « Jardinage » existe.
 */
export type BuiltinCategoryId = `fixed.${FixedExpenseCategory}` | `variable.${VariableExpenseCategory}`;
export type ExpenseCategoryId = BuiltinCategoryId | (string & {});

export interface CategoryInfo {
  readonly id: ExpenseCategoryId;
  readonly kind: 'fixed' | 'variable';
  readonly label: string;
  readonly essential: boolean;
  /** 0 = incompressible, 1 = entièrement discrétionnaire. */
  readonly compressibility: number;
  readonly debtRelated: boolean;
  /** Couleur d'affichage, stable dans le temps : l'œil apprend une couleur, il ne faut
   *  pas la lui changer d'un mois à l'autre. */
  readonly color: string;
  readonly icon: string;
  readonly custom: boolean;
  readonly hidden: boolean;
}

export const INCOME_LABELS: Record<IncomeCategory, string> = {
  salary: 'Salaire',
  freelance: 'Activité indépendante',
  benefits: 'Aides et allocations',
  rental: 'Revenus locatifs',
  investment: 'Revenus de placements',
  pension: 'Pension ou retraite',
  bonus: 'Prime ou bonus',
  otherIncome: 'Autre revenu',
};

export const INCOME_CATEGORIES = Object.keys(INCOME_LABELS) as IncomeCategory[];

/** Ce qui distingue une catégorie livrée d'une autre. La couleur et l'icône sont
 *  attribuées plus bas, à partir de la palette. */
interface CategorySeed {
  readonly label: string;
  readonly essential: boolean;
  readonly compressibility?: number;
  readonly debtRelated?: boolean;
}

const FIXED: Record<FixedExpenseCategory, CategorySeed> = {
  rent: { label: 'Loyer', essential: true, debtRelated: false },
  mortgage: { label: 'Crédit immobilier', essential: true, debtRelated: true },
  electricity: { label: 'Électricité', essential: true, debtRelated: false },
  water: { label: 'Eau', essential: true, debtRelated: false },
  gas: { label: 'Gaz', essential: true, debtRelated: false },
  internet: { label: 'Internet', essential: true, debtRelated: false },
  phone: { label: 'Téléphone', essential: true, debtRelated: false },
  insurance: { label: 'Assurances', essential: true, debtRelated: false },
  subscriptions: { label: 'Abonnements', essential: false, debtRelated: false },
  childcare: { label: 'Garde d’enfants', essential: true, debtRelated: false },
  schooling: { label: 'Frais de scolarité', essential: true, debtRelated: false },
  loanRepayment: { label: 'Remboursement de prêt', essential: true, debtRelated: true },
  taxes: { label: 'Impôts et taxes', essential: true, debtRelated: false },
  otherFixed: { label: 'Autre charge fixe', essential: false, debtRelated: false },
};

const VARIABLE: Record<VariableExpenseCategory, CategorySeed> = {
  groceries: { label: 'Courses', essential: true, compressibility: 0.25 },
  restaurants: { label: 'Restaurants', essential: false, compressibility: 0.8 },
  fuel: { label: 'Carburant', essential: true, compressibility: 0.2 },
  publicTransport: { label: 'Transports', essential: true, compressibility: 0.15 },
  leisure: { label: 'Loisirs', essential: false, compressibility: 0.7 },
  clothing: { label: 'Vêtements', essential: false, compressibility: 0.6 },
  health: { label: 'Santé', essential: true, compressibility: 0.05 },
  household: { label: 'Maison', essential: false, compressibility: 0.5 },
  gifts: { label: 'Cadeaux', essential: false, compressibility: 0.7 },
  travel: { label: 'Voyages', essential: false, compressibility: 0.9 },
  education: { label: 'Formation', essential: false, compressibility: 0.3 },
  // Les dépenses d'enfants sont essentielles, et pratiquement incompressibles : les
  // proposer à la coupe dans l'optimisation serait un conseil qu'on ne suit jamais.
  children: { label: 'Enfants', essential: true, compressibility: 0.1 },
  pets: { label: 'Animaux', essential: true, compressibility: 0.15 },
  personal: { label: 'Dépenses personnelles', essential: false, compressibility: 0.6 },
  otherVariable: { label: 'Autre dépense', essential: false, compressibility: 0.5 },
};

/**
 * Palette des catégories.
 *
 * Assignée une fois pour toutes, par catégorie et non par rang : « Courses » garde la
 * même couleur quel que soit son classement du mois. Teintes distinguables, y compris
 * pour une déficience de la vision des couleurs — et jamais porteuses seules d'un sens,
 * le libellé accompagne toujours la pastille.
 */
const PALETTE = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

/**
 * Couleur par défaut d'une catégorie.
 *
 * Les huit teintes tournent au-delà de la huitième catégorie, et c'est assumé : aucun
 * graphique n'affiche plus de six parts — le reste se replie sur « Autre » — si bien
 * que deux catégories de même teinte ne se retrouvent pratiquement jamais côte à côte.
 * Et quand cela arrive, chaque part porte son libellé : la couleur n'est jamais seule
 * à distinguer.
 */
function paletteFor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? 'var(--text-tertiary)';
}

const BUILTIN_ICONS: Record<string, string> = {
  'fixed.rent': '🏠', 'fixed.mortgage': '🏦', 'fixed.electricity': '💡', 'fixed.water': '💧',
  'fixed.gas': '🔥', 'fixed.internet': '🌐', 'fixed.phone': '📱', 'fixed.insurance': '🛡️',
  'fixed.subscriptions': '🔁', 'fixed.childcare': '🧸', 'fixed.schooling': '🎓',
  'fixed.loanRepayment': '💳', 'fixed.taxes': '🏛️', 'fixed.otherFixed': '📄',
  'variable.groceries': '🛒', 'variable.restaurants': '🍽️', 'variable.fuel': '⛽',
  'variable.publicTransport': '🚆', 'variable.leisure': '🎬', 'variable.clothing': '👕',
  'variable.health': '⚕️', 'variable.household': '🧰', 'variable.gifts': '🎁',
  'variable.travel': '✈️', 'variable.education': '📚', 'variable.children': '👶',
  'variable.pets': '🐾', 'variable.personal': '💇', 'variable.otherVariable': '•',
};

export const BUILTIN_CATEGORIES: Record<string, CategoryInfo> = Object.fromEntries(
  [
    ...Object.entries(FIXED).map(
      ([key, seed]) => [`fixed.${key}`, seed, 'fixed'] as const,
    ),
    ...Object.entries(VARIABLE).map(
      ([key, seed]) => [`variable.${key}`, seed, 'variable'] as const,
    ),
  ].map(([id, seed, kind], index) => [
    id,
    {
      id,
      kind,
      label: seed.label,
      essential: seed.essential,
      compressibility: kind === 'fixed' ? 0 : (seed.compressibility ?? 0.5),
      debtRelated: seed.debtRelated ?? false,
      color: paletteFor(index),
      icon: BUILTIN_ICONS[id] ?? '•',
      custom: false,
      hidden: false,
    } satisfies CategoryInfo,
  ]),
);

/**
 * Catalogue effectif : les catégories livrées, complétées et redéfinies par celles de
 * l'utilisateur.
 *
 * C'est un registre de module, alimenté par le magasin avant chaque calcul. Les moteurs
 * n'ont ainsi pas à recevoir le profil pour connaître le libellé d'une catégorie — au
 * prix d'un état global, assumé pour de la donnée de référence qui ne change qu'à la
 * modification du profil.
 */
let registry: Record<string, CategoryInfo> = { ...BUILTIN_CATEGORIES };

export interface CategoryDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: 'fixed' | 'variable';
  readonly essential: boolean;
  readonly compressibility: number;
  readonly color: string;
  readonly icon: string;
  readonly hidden?: boolean;
}

export function applyCategories(custom: readonly CategoryDefinition[]): void {
  const next: Record<string, CategoryInfo> = { ...BUILTIN_CATEGORIES };
  for (const entry of custom) {
    const base = BUILTIN_CATEGORIES[entry.id];
    next[entry.id] = {
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      essential: entry.essential,
      compressibility: entry.kind === 'fixed' ? 0 : entry.compressibility,
      debtRelated: base?.debtRelated ?? false,
      color: entry.color,
      icon: entry.icon,
      custom: base === undefined,
      hidden: entry.hidden ?? false,
    };
  }
  registry = next;
}

export const FIXED_CATEGORY_IDS = Object.keys(FIXED).map(
  (key) => `fixed.${key}` as ExpenseCategoryId,
);

export const VARIABLE_CATEGORY_IDS = Object.keys(VARIABLE).map(
  (key) => `variable.${key}` as ExpenseCategoryId,
);

/**
 * Description d'une catégorie.
 *
 * Ne lève jamais : une catégorie inconnue — supprimée d'un profil, ou lue depuis un
 * fichier plus récent — renvoie une entrée neutre. Faire planter l'affichage d'un budget
 * parce qu'un libellé manque serait une réaction disproportionnée.
 */
export function categoryInfo(id: ExpenseCategoryId): CategoryInfo {
  const info = registry[id];
  if (info) return info;
  return {
    id,
    kind: String(id).startsWith('fixed.') ? 'fixed' : 'variable',
    label: 'Catégorie supprimée',
    essential: false,
    compressibility: 0.5,
    debtRelated: false,
    color: 'var(--text-tertiary)',
    icon: '•',
    custom: true,
    hidden: false,
  };
}

/** Toutes les catégories utilisables, catalogue livré et créations comprises. */
export function allCategories(): CategoryInfo[] {
  return Object.values(registry).filter((entry) => !entry.hidden);
}

export function visibleCategoryIds(kind?: 'fixed' | 'variable'): ExpenseCategoryId[] {
  return allCategories()
    .filter((entry) => (kind ? entry.kind === kind : true))
    .map((entry) => entry.id);
}

export function categoryColor(id: ExpenseCategoryId): string {
  return categoryInfo(id).color;
}

export function categoryLabel(id: ExpenseCategoryId): string {
  return categoryInfo(id).label;
}

/**
 * Nature d'une catégorie, d'après le registre vivant.
 *
 * L'ancienne version testait le préfixe `fixed.` de l'identifiant. Une catégorie créée
 * par l'utilisateur porte un identifiant `custom.…` : elle était donc déclarée variable
 * quoi qu'il arrive, y compris quand elle se disait fixe — deux sources de vérité
 * contradictoires pour la même question.
 */
