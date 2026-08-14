import { Money, isMoneyJSON, type Currency } from '../core/money';
import { emptyProfile, DEFAULT_PREFERENCES, type FinancialProfile } from '../core/model';

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

/** Un fichier peut venir d'une version antérieure : on complète les champs manquants
 *  plutôt que de laisser l'interface planter sur un `undefined`. */
function normalise(raw: Partial<FinancialProfile>): FinancialProfile {
  const currency: Currency = raw.currency ?? 'EUR';
  const base = emptyProfile(currency);
  return {
    ...base,
    ...raw,
    currency,
    accounts: raw.accounts ?? base.accounts,
    incomes: raw.incomes ?? base.incomes,
    recurringExpenses: raw.recurringExpenses ?? base.recurringExpenses,
    transactions: raw.transactions ?? base.transactions,
    debts: raw.debts ?? base.debts,
    goals: raw.goals ?? base.goals,
    categoryBudgets: raw.categoryBudgets ?? base.categoryBudgets,
    preferences: { ...DEFAULT_PREFERENCES, ...(raw.preferences ?? {}) },
    savingsBalance: raw.savingsBalance ?? Money.zero(currency),
    investmentsBalance: raw.investmentsBalance ?? Money.zero(currency),
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

export async function loadProfile(): Promise<FinancialProfile | null> {
  try {
    if (runningInTauri()) {
      const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const present = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
      if (!present) return null;
      return deserializeProfile(await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData }));
    }
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return stored ? deserializeProfile(stored) : null;
  } catch (error) {
    console.error('Lecture du profil impossible', error);
    throw error;
  }
}

export async function saveProfile(profile: FinancialProfile): Promise<void> {
  const payload = serializeProfile(profile);
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

/** Export manuel : l'utilisateur doit pouvoir récupérer ses données sans nous. */
export function downloadProfile(profile: FinancialProfile): void {
  const blob = new Blob([serializeProfile(profile)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quantara-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
