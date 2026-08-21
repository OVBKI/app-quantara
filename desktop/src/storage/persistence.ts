import { CURRENCIES, Money, isMoneyJSON, type Currency } from '../core/money';
import {
  allocationTotal,
  DEFAULT_PREFERENCES,
  type Account,
  type AllocationTargets,
  type FinancialProfile,
} from '../core/model';
import { decrypt, encrypt, isEncryptedEnvelope } from '../security/vault';

const FILE_NAME = 'quantara-profile.json';
const LOCAL_STORAGE_KEY = 'quantara.profile';
const FORMAT_VERSION = 1;

interface Envelope {
  readonly version: number;
  readonly savedAt: string;
  readonly profile: unknown;
}

/** Les montants sont reconstruits en objets `Money` : relus en nombres, ils
 *  reprendraient l'imprécision binaire qu'on a passé le moteur à éviter. */
function reviver(_key: string, value: unknown): unknown {
  return isMoneyJSON(value) ? Money.fromJSON(value) : value;
}

export function serializeProfile(profile: FinancialProfile): string {
  const envelope: Envelope = {
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    profile,
  };
  return JSON.stringify(envelope, null, 2);
}

export function deserializeProfile(raw: string): FinancialProfile {
  /*
   * Un fichier tronqué — coupure de courant pendant une écriture — remontait le
   * `SyntaxError` brut du moteur JavaScript, en anglais, au milieu de l'interface. Le
   * message prévu juste en dessous ne servait jamais.
   */
  let parsed: Envelope;
  try {
    parsed = JSON.parse(raw, reviver) as Envelope;
  } catch {
    throw new Error('Fichier de sauvegarde illisible : structure inattendue.');
  }
  if (typeof parsed !== 'object' || parsed === null || !('profile' in parsed)) {
    throw new Error('Fichier de sauvegarde illisible : structure inattendue.');
  }
  if (parsed.version > FORMAT_VERSION) {
    throw new Error(
      `Ce fichier vient d'une version plus récente de Quantara (format ${parsed.version}). ` +
        'Mettez l’application à jour avant de l’ouvrir.',
    );
  }
  return normalise(parsed.profile);
}

/**
 * Forme d'un profil enregistré par une version antérieure.
 *
 * Ces champs n'existent plus dans le modèle : ils sont convertis en comptes à la lecture,
 * une fois, puis disparaissent du fichier au prochain enregistrement.
 */
interface LegacyFields {
  readonly savingsBalance?: Money;
  readonly investmentsBalance?: Money;
}

/**
 * Parts de répartition venues d'une version antérieure.
 *
 * L'ancienne forme portait une part « besoins » prélevée sur le revenu brut ; la nouvelle
 * partage ce qui reste une fois les charges payées, en quatre parts nommées autrement.
 * Les deux ne se convertissent pas : un profil ancien repart des valeurs par défaut,
 * plutôt que d'hériter d'un total qui ne fait plus 100 % et ferait basculer le partage
 * dans la cascade sans que rien ne l'explique.
 */
function migrateAllocationTargets(raw: unknown): AllocationTargets {
  const defaults = DEFAULT_PREFERENCES.allocationTargets;
  if (typeof raw !== 'object' || raw === null) return defaults;

  const candidate = raw as Partial<AllocationTargets>;
  const merged: AllocationTargets = {
    enabled: candidate.enabled ?? defaults.enabled,
    security: candidate.security ?? defaults.security,
    savings: candidate.savings ?? defaults.savings,
    investment: candidate.investment ?? defaults.investment,
    free: candidate.free ?? defaults.free,
  };
  if (Math.abs(allocationTotal(merged) - 1) > 0.005) {
    return { ...defaults, enabled: merged.enabled };
  }
  return merged;
}

/** `balance` était l'ancien nom, et il ne portait pas de date. */
type LegacyAccount = Omit<Account, 'openingBalance' | 'balanceDate'> & {
  readonly openingBalance?: Money;
  readonly balanceDate?: string;
  readonly balance?: Money;
};

/**
 * Migration des soldes vers les comptes.
 *
 * Avant, l'épargne vivait à deux endroits : un champ `savingsBalance` et les comptes de
 * type épargne, dont la somme était comptée deux fois. Les deux deviennent des comptes,
 * seule source de vérité. Le relevé est daté d'aujourd'hui : les transactions déjà
 * enregistrées sont donc réputées comprises dans le solde, ce qui évite de les
 * décompter une seconde fois.
 */
function migrateAccounts(raw: Partial<FinancialProfile> & LegacyFields, currency: Currency): Account[] {
  const today = new Date().toISOString().slice(0, 10);
  const existing = (raw.accounts ?? []) as readonly LegacyAccount[];
  const accounts: Account[] = existing.map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    // `balance` est l'ancien nom du champ ; `openingBalance` le nouveau.
    openingBalance: account.openingBalance ?? account.balance ?? Money.zero(currency),
    balanceDate: account.balanceDate ?? today,
    ...(account.archived ? { archived: true } : {}),
  }));

  if (raw.savingsBalance?.isPositive) {
    accounts.push({
      id: 'migrated-savings',
      name: 'Épargne',
      kind: 'savings',
      openingBalance: raw.savingsBalance,
      balanceDate: today,
    });
  }
  if (raw.investmentsBalance?.isPositive) {
    accounts.push({
      id: 'migrated-investments',
      name: 'Placements',
      kind: 'investment',
      openingBalance: raw.investmentsBalance,
      balanceDate: today,
    });
  }
  return accounts;
}

/**
 * Relabellisation d'une devise.
 *
 * Un profil Quantara est mono-devise et l'application ne connaît aucun taux de change :
 * changer de devise ne convertit rien, cela **renomme** l'unité. C'est le seul choix
 * honnête — convertir exigerait des taux inventés, et refuser laisserait un fichier
 * incohérent faire lever le moteur au premier calcul, écran blanc à la clé.
 *
 * Le parcours reconstruit des objets simples : aucune clé n'est écrite dynamiquement sur
 * un objet existant, donc rien à craindre d'un `__proto__` présent dans le fichier.
 */
function relabelCurrency(value: unknown, currency: Currency): unknown {
  if (value instanceof Money) {
    return value.currency === currency ? value : Money.fromMicros(value.micros, currency);
  }
  if (Array.isArray(value)) return value.map((entry) => relabelCurrency(entry, currency));
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor') continue;
      result[key] = relabelCurrency(entry, currency);
    }
    return result;
  }
  return value;
}

export function withCurrency(profile: FinancialProfile, currency: Currency): FinancialProfile {
  return { ...(relabelCurrency(profile, currency) as FinancialProfile), currency };
}

/** Un nombre utilisable, ou la valeur par défaut : `null` et `NaN` valent « absent ». */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function money(value: unknown, currency: Currency): Money {
  return value instanceof Money ? value : Money.zero(currency);
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

const TODAY = (): string => new Date().toISOString().slice(0, 10);

/**
 * Complétion entité par entité.
 *
 * L'ancienne version ne complétait que les collections de tête. Or les moteurs filtrent
 * sur des champs **de l'entité** — `active`, `achieved`, `priority`. Un fichier écrit
 * avant l'introduction de `active` perdait ainsi d'un coup tous ses revenus, toutes ses
 * charges et toutes ses dettes : présents dans le fichier, invisibles dans l'application.
 * Chaque champ obligatoire reçoit donc ici une valeur, et les entités sans identifiant
 * sont écartées plutôt que gardées à moitié.
 */
function normalise(input: unknown): FinancialProfile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Fichier de sauvegarde illisible : structure inattendue.');
  }

  const raw = input as Partial<FinancialProfile> & LegacyFields & Record<string, unknown>;
  const currency: Currency = CURRENCIES.includes(raw.currency as Currency) ? (raw.currency as Currency) : 'EUR';
  const today = TODAY();

  const identified = <T extends { id?: unknown }>(entries: readonly unknown[]): T[] =>
    entries.filter((entry): entry is T => typeof entry === 'object' && entry !== null && typeof (entry as T).id === 'string');

  const profile: FinancialProfile = {
    currency,
    accounts: migrateAccounts(raw, currency).map((account) => ({
      ...account,
      name: text(account.name, 'Compte'),
      kind: (['checking', 'savings', 'investment', 'cash'] as const).includes(account.kind) ? account.kind : 'checking',
      openingBalance: money(account.openingBalance, currency),
      balanceDate: text(account.balanceDate, today),
    })),

    incomes: identified<Record<string, unknown> & { id: string }>(list(raw.incomes)).map((entry) => ({
      id: entry.id,
      name: text(entry.name, 'Revenu'),
      amount: money(entry.amount, currency),
      frequency: (entry.frequency as FinancialProfile['incomes'][number]['frequency']) ?? 'monthly',
      category: (entry.category as FinancialProfile['incomes'][number]['category']) ?? 'salary',
      variable: bool(entry.variable, false),
      ...(entry.declaredMonthly !== undefined ? { declaredMonthly: bool(entry.declaredMonthly, false) } : {}),
      ...(entry.minAmount instanceof Money ? { minAmount: entry.minAmount } : {}),
      ...(entry.maxAmount instanceof Money ? { maxAmount: entry.maxAmount } : {}),
      ...(typeof entry.dayOfMonth === 'number' ? { dayOfMonth: entry.dayOfMonth } : {}),
      ...(typeof entry.accountId === 'string' ? { accountId: entry.accountId } : {}),
      ...(typeof entry.startDate === 'string' ? { startDate: entry.startDate } : {}),
      ...(typeof entry.endDate === 'string' ? { endDate: entry.endDate } : {}),
      // Le drapeau est postérieur aux premiers fichiers : son absence veut dire « actif ».
      active: bool(entry.active, true),
    })),

    recurringExpenses: identified<Record<string, unknown> & { id: string }>(list(raw.recurringExpenses)).map((entry) => ({
      id: entry.id,
      name: text(entry.name, 'Charge'),
      amount: money(entry.amount, currency),
      frequency: (entry.frequency as FinancialProfile['recurringExpenses'][number]['frequency']) ?? 'monthly',
      category: (entry.category as FinancialProfile['recurringExpenses'][number]['category']) ?? 'fixed.otherFixed',
      dayOfMonth: Math.min(Math.max(num(entry.dayOfMonth, 1), 1), 31),
      subscription: bool(entry.subscription, false),
      ...(entry.essentialOverride !== undefined ? { essentialOverride: bool(entry.essentialOverride, false) } : {}),
      ...(typeof entry.startDate === 'string' ? { startDate: entry.startDate } : {}),
      ...(typeof entry.endDate === 'string' ? { endDate: entry.endDate } : {}),
      active: bool(entry.active, true),
    })),

    transactions: identified<Record<string, unknown> & { id: string }>(list(raw.transactions))
      // Une écriture sans montant ni date n'est pas réparable : la garder ferait lever le
      // moteur bien plus tard, loin de la lecture du fichier.
      .filter((entry) => entry.amount instanceof Money && typeof entry.date === 'string')
      .map((entry) => ({
        ...(entry as unknown as FinancialProfile['transactions'][number]),
        amount: money(entry.amount, currency),
        kind: (entry.kind as FinancialProfile['transactions'][number]['kind']) ?? 'expense',
        label: text(entry.label, ''),
      })),

    debts: identified<Record<string, unknown> & { id: string }>(list(raw.debts)).map((entry) => ({
      id: entry.id,
      name: text(entry.name, 'Dette'),
      kind: (entry.kind as FinancialProfile['debts'][number]['kind']) ?? 'otherDebt',
      outstanding: money(entry.outstanding, currency),
      annualRate: num(entry.annualRate, 0),
      monthlyPayment: money(entry.monthlyPayment, currency),
      active: bool(entry.active, true),
    })),

    goals: identified<Record<string, unknown> & { id: string }>(list(raw.goals)).map((entry, index) => ({
      id: entry.id,
      name: text(entry.name, 'Objectif'),
      kind: (entry.kind as FinancialProfile['goals'][number]['kind']) ?? 'otherGoal',
      target: money(entry.target, currency),
      current: money(entry.current, currency),
      ...(typeof entry.targetDate === 'string' ? { targetDate: entry.targetDate } : {}),
      ...(entry.monthlyContribution instanceof Money ? { monthlyContribution: entry.monthlyContribution } : {}),
      // Sans priorité, l'ordre du fichier fait foi : un `NaN` rendrait le tri indéfini.
      priority: num(entry.priority, index + 1),
      createdAt: text(entry.createdAt, today),
      achieved: bool(entry.achieved, false),
    })),

    categoryBudgets: list(raw.categoryBudgets)
      .filter(
        (entry): entry is FinancialProfile['categoryBudgets'][number] =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { category?: unknown }).category === 'string' &&
          (entry as { limit?: unknown }).limit instanceof Money,
      )
      .map((entry) => ({ ...entry, limit: money(entry.limit, currency) })),

    categorizationRules: list(raw.categorizationRules).filter(
      (entry): entry is FinancialProfile['categorizationRules'][number] =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { pattern?: unknown }).pattern === 'string',
    ),

    categories: identified<Record<string, unknown> & { id: string }>(list(raw.categories)).map((entry) => ({
      id: entry.id,
      label: text(entry.label, entry.id),
      kind: entry.kind === 'fixed' ? 'fixed' : 'variable',
      essential: bool(entry.essential, false),
      compressibility: Math.min(Math.max(num(entry.compressibility, 0.5), 0), 1),
      color: text(entry.color, 'var(--series-1)'),
      icon: text(entry.icon, '•'),
      ...(entry.hidden !== undefined ? { hidden: bool(entry.hidden, false) } : {}),
    })),

    holdings: identified<Record<string, unknown> & { id: string }>(list(raw.holdings)).map((entry) => ({
      id: entry.id,
      name: text(entry.name, 'Ligne'),
      assetClass: (entry.assetClass as FinancialProfile['holdings'][number]['assetClass']) ?? 'otherAsset',
      invested: money(entry.invested, currency),
      currentValue: money(entry.currentValue, currency),
      valuedOn: text(entry.valuedOn, today),
      ...(typeof entry.accountId === 'string' ? { accountId: entry.accountId } : {}),
      ...(typeof entry.note === 'string' ? { note: entry.note } : {}),
    })),

    preferences: {
      ...DEFAULT_PREFERENCES,
      incomePlanning: (raw.preferences?.incomePlanning as typeof DEFAULT_PREFERENCES.incomePlanning) ?? DEFAULT_PREFERENCES.incomePlanning,
      emergencyFundMonths: num(raw.preferences?.emergencyFundMonths, DEFAULT_PREFERENCES.emergencyFundMonths),
      smoothIncome: bool(raw.preferences?.smoothIncome, DEFAULT_PREFERENCES.smoothIncome),
      riskProfile: (raw.preferences?.riskProfile as typeof DEFAULT_PREFERENCES.riskProfile) ?? DEFAULT_PREFERENCES.riskProfile,
      minimumFreeShare: num(raw.preferences?.minimumFreeShare, DEFAULT_PREFERENCES.minimumFreeShare),
      textScale: num(raw.preferences?.textScale, DEFAULT_PREFERENCES.textScale),
      alerts: { ...DEFAULT_PREFERENCES.alerts, ...(raw.preferences?.alerts ?? {}) },
      allocationTargets: migrateAllocationTargets(raw.preferences?.allocationTargets),
      allocationAccounts: {
        ...DEFAULT_PREFERENCES.allocationAccounts,
        ...(raw.preferences?.allocationAccounts ?? {}),
      },
      // Le drapeau est postérieur aux premiers fichiers : un profil qui porte déjà des
      // données a forcément été mis en route, et ne doit pas y être renvoyé.
      onboardingCompleted:
        bool(raw.preferences?.onboardingCompleted, false) ||
        (list(raw.incomes).length > 0 ||
          list(raw.recurringExpenses).length > 0 ||
          list(raw.transactions).length > 0 ||
          list(raw.accounts).length > 0),
    },
  };

  // Dernier filet : un fichier dont les montants portent une autre devise que le profil
  // ne doit pas faire lever le moteur au premier calcul.
  return withCurrency(profile, currency);
}

/**
 * Emplacement de stockage.
 *
 * Dans la fenêtre Tauri, un fichier JSON dans le dossier de données de l'application ;
 * dans un navigateur (développement), le stockage local. Le format est identique, si
 * bien qu'un profil se déplace de l'un à l'autre par copier-coller.
 */
function runningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function readRaw(): Promise<string | null> {
  if (runningInTauri()) {
    const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const present = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
    if (!present) return null;
    return readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData });
  }
  return window.localStorage.getItem(LOCAL_STORAGE_KEY);
}

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'profile'; profile: FinancialProfile }
  /** Le fichier existe mais est chiffré : il faut le mot de passe pour aller plus loin. */
  | { kind: 'encrypted' };

export async function loadStored(): Promise<LoadResult> {
  const raw = await readRaw();
  if (!raw) return { kind: 'empty' };

  const parsed: unknown = JSON.parse(raw);
  if (isEncryptedEnvelope(parsed)) return { kind: 'encrypted' };

  return { kind: 'profile', profile: deserializeProfile(raw) };
}

export async function unlockStored(password: string): Promise<FinancialProfile> {
  const raw = await readRaw();
  if (!raw) throw new Error('Aucun profil enregistré.');

  const parsed: unknown = JSON.parse(raw);
  if (!isEncryptedEnvelope(parsed)) return deserializeProfile(raw);

  return deserializeProfile(await decrypt(parsed, password));
}

export async function saveProfile(profile: FinancialProfile, password: string | null = null): Promise<void> {
  const clear = serializeProfile(profile);
  const payload = password ? JSON.stringify(await encrypt(clear, password), null, 2) : clear;
  if (runningInTauri()) {
    const { writeTextFile, mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    if (!(await exists('', { baseDir: BaseDirectory.AppData }))) {
      await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });
    }
    await writeTextFile(FILE_NAME, payload, { baseDir: BaseDirectory.AppData });
    return;
  }
  window.localStorage.setItem(LOCAL_STORAGE_KEY, payload);
}

export async function clearProfile(): Promise<void> {
  if (runningInTauri()) {
    const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    if (await exists(FILE_NAME, { baseDir: BaseDirectory.AppData })) {
      await remove(FILE_NAME, { baseDir: BaseDirectory.AppData });
    }
    return;
  }
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

/** L'export est toujours en clair : il sert à récupérer ses données, pas à les archiver
 *  en sécurité. À l'utilisateur de le ranger où il faut — et l'interface le rappelle. */
export function downloadProfile(profile: FinancialProfile): void {
  const blob = new Blob([serializeProfile(profile)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quantara-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
