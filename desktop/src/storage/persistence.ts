import { Money, isMoneyJSON, type Currency } from '../core/money';
import { emptyProfile, DEFAULT_PREFERENCES, type Account, type FinancialProfile } from '../core/model';
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

export function deserializeProfile(text: string): FinancialProfile {
  const parsed = JSON.parse(text, reviver) as Envelope;
  if (typeof parsed !== 'object' || parsed === null || !('profile' in parsed)) {
    throw new Error('Fichier de sauvegarde illisible : structure inattendue.');
  }
  if (parsed.version > FORMAT_VERSION) {
    throw new Error(
      `Ce fichier vient d'une version plus récente de Quantara (format ${parsed.version}). ` +
        'Mettez l’application à jour avant de l’ouvrir.',
    );
  }
  return normalise(parsed.profile as Partial<FinancialProfile>);
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

/** Un fichier peut venir d'une version antérieure : on complète les champs manquants
 *  plutôt que de laisser l'interface planter sur un `undefined`. */
function normalise(input: Partial<FinancialProfile>): FinancialProfile {
  const raw = input as Partial<FinancialProfile> & LegacyFields;
  const currency: Currency = raw.currency ?? 'EUR';
  const base = emptyProfile(currency);
  return {
    ...base,
    ...raw,
    currency,
    accounts: migrateAccounts(raw, currency),
    incomes: raw.incomes ?? base.incomes,
    recurringExpenses: raw.recurringExpenses ?? base.recurringExpenses,
    transactions: raw.transactions ?? base.transactions,
    debts: raw.debts ?? base.debts,
    goals: raw.goals ?? base.goals,
    categoryBudgets: raw.categoryBudgets ?? base.categoryBudgets,
    categorizationRules: raw.categorizationRules ?? base.categorizationRules,
    categories: raw.categories ?? base.categories,
    holdings: raw.holdings ?? base.holdings,
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...(raw.preferences ?? {}),
      alerts: { ...DEFAULT_PREFERENCES.alerts, ...(raw.preferences?.alerts ?? {}) },
      allocationTargets: {
        ...DEFAULT_PREFERENCES.allocationTargets,
        ...(raw.preferences?.allocationTargets ?? {}),
      },
      // Le drapeau est postérieur aux premiers fichiers : un profil qui porte déjà des
      // données a forcément été mis en route, et ne doit pas y être renvoyé.
      onboardingCompleted:
        raw.preferences?.onboardingCompleted ??
        ((raw.incomes?.length ?? 0) > 0 || (raw.recurringExpenses?.length ?? 0) > 0),
    },
  };
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
