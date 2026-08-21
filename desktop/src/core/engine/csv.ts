import { Money, type Currency } from '../money';
import { formatDate } from '../yearMonth';
import type { Transaction } from '../model';
import { categorize, type CategorizationRule } from './categorizer';

export interface ImportedRow {
  readonly date: string;
  readonly label: string;
  readonly amount: Money;
  readonly kind: 'expense' | 'income';
}

export interface ImportReport {
  readonly transactions: readonly Omit<Transaction, 'id'>[];
  readonly imported: number;
  readonly skipped: number;
  readonly duplicates: number;
  readonly errors: readonly string[];
  readonly detectedSeparator: string;
  readonly detectedColumns: { date: number; label: number; amount: number; credit?: number };
}

/**
 * Découpage d'une ligne CSV.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque : les guillemets doublés à l'intérieur
 * d'un champ cité (`"DUPONT ""JEAN"""`) sont le seul cas subtil, et il tient en dix lignes.
 */
export function splitLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === separator && !quoted) {
      fields.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Le séparateur retenu est celui qui découpe le plus régulièrement les premières lignes. */
export function detectSeparator(lines: readonly string[]): string {
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestScore = 0;

  for (const candidate of candidates) {
    const counts = lines.slice(0, 5).map((line) => splitLine(line, candidate).length);
    const minimum = Math.min(...counts);
    if (minimum < 2) continue;
    const consistent = counts.every((count) => count === counts[0]);
    const score = minimum * (consistent ? 2 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Lecture d'un montant.
 *
 * Trois conventions coexistent dans les exports bancaires francophones :
 * « 1 234,56 », « 1,234.56 » et « 1234.56 ». Se tromper de convention transforme
 * mille euros en un euro — l'erreur est silencieuse et dévastatrice, donc on tranche
 * explicitement d'après la position du dernier séparateur.
 */
export function parseAmountField(raw: string): number | null {
  const cleaned = raw
    .replace(/[\s ]/g, '')
    .replace(/[€$£]/g, '')
    .replace(/^\+/, '');
  if (cleaned === '' || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-') || /^\(.*\)$/.test(cleaned);
  const digits = cleaned.replace(/[-()]/g, '');

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = digits;
  } else if (lastComma > lastDot) {
    // La virgule est le séparateur décimal : les points sont des milliers.
    normalized = digits.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = digits.replace(/,/g, '');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Reconnaît « 05/03/2026 », « 2026-03-05 » et « 05.03.26 ». */
export function parseDateField(raw: string): string | null {
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text);
  if (french) {
    const day = french[1]!.padStart(2, '0');
    const month = french[2]!.padStart(2, '0');
    const rawYear = french[3]!;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month}-${day}`;
  }

  return null;
}

const DATE_HEADERS = ['date', 'date operation', 'date valeur', 'date comptable'];
const LABEL_HEADERS = ['libelle', 'libellé', 'description', 'intitule', 'intitulé', 'nature', 'motif', 'detail'];
const AMOUNT_HEADERS = ['montant', 'amount', 'valeur', 'debit', 'débit'];
const CREDIT_HEADERS = ['credit', 'crédit'];

function findColumn(headers: readonly string[], candidates: readonly string[]): number {
  const normalized = headers.map((header) =>
    header.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(),
  );
  for (const candidate of candidates) {
    const target = candidate.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const index = normalized.findIndex((header) => header === target);
    if (index !== -1) return index;
  }
  for (const candidate of candidates) {
    const target = candidate.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const index = normalized.findIndex((header) => header.includes(target));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Import d'un relevé.
 *
 * Le fichier n'est jamais transmis : il est lu et analysé sur la machine. Les doublons
 * sont écartés sur le triplet date + libellé + montant, ce qui permet de réimporter un
 * relevé qui chevauche le précédent sans dupliquer un mois entier.
 */
export function importCsv(
  content: string,
  currency: Currency,
  existing: readonly Transaction[] = [],
  userRules: readonly CategorizationRule[] = [],
): ImportReport {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.length < 2) {
    return {
      transactions: [],
      imported: 0,
      skipped: 0,
      duplicates: 0,
      errors: ['Le fichier ne contient pas assez de lignes pour être un relevé.'],
      detectedSeparator: ';',
      detectedColumns: { date: -1, label: -1, amount: -1 },
    };
  }

  const separator = detectSeparator(lines);
  const headers = splitLine(lines[0]!, separator);

  const dateColumn = findColumn(headers, DATE_HEADERS);
  const labelColumn = findColumn(headers, LABEL_HEADERS);
  const amountColumn = findColumn(headers, AMOUNT_HEADERS);
  const creditColumn = findColumn(headers, CREDIT_HEADERS);

  const errors: string[] = [];
  if (dateColumn === -1) errors.push('Colonne de date introuvable. En-têtes attendus : date, date operation…');
  if (labelColumn === -1) errors.push('Colonne de libellé introuvable. En-têtes attendus : libellé, description…');
  if (amountColumn === -1) errors.push('Colonne de montant introuvable. En-têtes attendus : montant, débit…');

  if (errors.length > 0) {
    return {
      transactions: [],
      imported: 0,
      skipped: lines.length - 1,
      duplicates: 0,
      errors,
      detectedSeparator: separator,
      detectedColumns: { date: dateColumn, label: labelColumn, amount: amountColumn },
    };
  }

  const seen = new Set(
    existing.map((transaction) => `${transaction.date}|${transaction.label}|${transaction.amount.micros}`),
  );

  const transactions: Omit<Transaction, 'id'>[] = [];
  let skipped = 0;
  let duplicates = 0;

  for (const line of lines.slice(1)) {
    const fields = splitLine(line, separator);
    const date = parseDateField(fields[dateColumn] ?? '');
    const label = (fields[labelColumn] ?? '').trim();

    let value = parseAmountField(fields[amountColumn] ?? '');
    // Certains relevés séparent débit et crédit en deux colonnes.
    if ((value === null || value === 0) && creditColumn !== -1) {
      const credit = parseAmountField(fields[creditColumn] ?? '');
      if (credit !== null && credit !== 0) value = Math.abs(credit);
    }

    if (!date || label === '' || value === null || value === 0) {
      skipped += 1;
      continue;
    }

    // Un crédit vaut crédit s'il porte un montant : beaucoup de relevés français
      // remplissent les deux colonnes, dont l'une à « 0,00 ». Tester la seule présence
      // d'un nombre faisait passer chaque débit pour un revenu — 45 € de courses
      // devenaient 45 € encaissés, soit 90 € d'écart sur une ligne.
      const creditValue = creditColumn !== -1 ? parseAmountField(fields[creditColumn] ?? '') : null;
      const isIncome = creditColumn !== -1 ? value > 0 && creditValue !== null && creditValue > 0 : value > 0;
    const amount = Money.of(Math.abs(value), currency);
    const key = `${date}|${label}|${amount.micros}`;

    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const guessed = isIncome ? null : categorize(label, userRules);

    transactions.push({
      date,
      label,
      amount,
      kind: isIncome ? 'income' : 'expense',
      category: guessed?.category,
      note: 'Importé',
    });
  }

  return {
    transactions,
    imported: transactions.length,
    skipped,
    duplicates,
    errors,
    detectedSeparator: separator,
    detectedColumns: {
      date: dateColumn,
      label: labelColumn,
      amount: amountColumn,
      credit: creditColumn === -1 ? undefined : creditColumn,
    },
  };
}

/** Export au même format, pour que l'aller-retour soit possible. */
export function exportCsv(transactions: readonly Transaction[]): string {
  const rows = transactions.map((transaction) =>
    [
      transaction.date,
      `"${transaction.label.replace(/"/g, '""')}"`,
      transaction.kind === 'income' ? '' : (-transaction.amount.units).toFixed(2).replace('.', ','),
      transaction.kind === 'income' ? transaction.amount.units.toFixed(2).replace('.', ',') : '',
      transaction.category ?? '',
    ].join(';'),
  );
  return ['Date;Libellé;Débit;Crédit;Catégorie', ...rows].join('\n');
}

export { formatDate };
