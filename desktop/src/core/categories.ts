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
  | 'otherVariable';

/** Identifiant stable, utilisé en base et dans les échanges. Ne jamais le renommer. */
export type ExpenseCategoryId = `fixed.${FixedExpenseCategory}` | `variable.${VariableExpenseCategory}`;

export interface CategoryInfo {
  readonly id: ExpenseCategoryId;
  readonly kind: 'fixed' | 'variable';
  readonly label: string;
  readonly essential: boolean;
  /** 0 = incompressible, 1 = entièrement discrétionnaire. */
  readonly compressibility: number;
  readonly debtRelated: boolean;
}

export const INCOME_LABELS: Record<IncomeCategory, string> = {
  salary: 'Salaire',
  freelance: 'Activité indépendante',
  benefits: 'Aides et allocations',
  rental: 'Revenus locatifs',
  investment: 'Revenus de placements',
  pension: 'Pension ou retraite',
  otherIncome: 'Autre revenu',
};

export const INCOME_CATEGORIES = Object.keys(INCOME_LABELS) as IncomeCategory[];

const FIXED: Record<FixedExpenseCategory, Omit<CategoryInfo, 'id' | 'kind' | 'compressibility'>> = {
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

const VARIABLE: Record<VariableExpenseCategory, Omit<CategoryInfo, 'id' | 'kind' | 'debtRelated'>> = {
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
  otherVariable: { label: 'Autre dépense', essential: false, compressibility: 0.5 },
};

export const CATEGORIES: Record<ExpenseCategoryId, CategoryInfo> = Object.fromEntries([
  ...Object.entries(FIXED).map(([key, value]) => {
    const id = `fixed.${key}` as ExpenseCategoryId;
    return [id, { ...value, id, kind: 'fixed' as const, compressibility: 0 }];
  }),
  ...Object.entries(VARIABLE).map(([key, value]) => {
    const id = `variable.${key}` as ExpenseCategoryId;
    return [id, { ...value, id, kind: 'variable' as const, debtRelated: false }];
  }),
]) as Record<ExpenseCategoryId, CategoryInfo>;

export const FIXED_CATEGORY_IDS = Object.keys(FIXED).map(
  (key) => `fixed.${key}` as ExpenseCategoryId,
);

export const VARIABLE_CATEGORY_IDS = Object.keys(VARIABLE).map(
  (key) => `variable.${key}` as ExpenseCategoryId,
);

export const ALL_CATEGORY_IDS: ExpenseCategoryId[] = [...FIXED_CATEGORY_IDS, ...VARIABLE_CATEGORY_IDS];

export function categoryInfo(id: ExpenseCategoryId): CategoryInfo {
  const info = CATEGORIES[id];
  if (!info) throw new Error(`Catégorie inconnue : ${id}`);
  return info;
}

export function categoryLabel(id: ExpenseCategoryId): string {
  return categoryInfo(id).label;
}

export function isFixedCategory(id: ExpenseCategoryId): boolean {
  return id.startsWith('fixed.');
}
