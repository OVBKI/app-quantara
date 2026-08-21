/**
 * Repère de période mensuelle.
 *
 * Un mois budgétaire n'est pas « 30 jours glissants » : c'est un mois civil, avec sa
 * longueur propre. Tous les calculs de trésorerie s'appuient sur cette longueur réelle.
 */
export interface YearMonth {
  readonly year: number;
  readonly month: number; // 1 à 12
}

export function yearMonth(year: number, month: number): YearMonth {
  return { year, month };
}

export function yearMonthOf(date: Date): YearMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function yearMonthKey(period: YearMonth): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

export function yearMonthEquals(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

export function addMonths(period: YearMonth, count: number): YearMonth {
  const zeroBased = period.year * 12 + (period.month - 1) + count;
  return { year: Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
}

/** Nombre de mois de `from` (inclus) à `to` (exclu). Négatif si `to` précède `from`. */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/** Les `count` derniers mois, du plus ancien au plus récent, `period` inclus. */
export function lastMonths(period: YearMonth, count: number): YearMonth[] {
  const months: YearMonth[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) months.push(addMonths(period, -offset));
  return months;
}

export function daysInMonth(period: YearMonth): number {
  return new Date(period.year, period.month, 0).getDate();
}

/** Date du jour `day` dans la période, ramenée au dernier jour si le mois est plus court
 *  (un prélèvement le 31 tombe le 28 février). */
export function dateOf(period: YearMonth, day: number): Date {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(period));
  return new Date(period.year, period.month - 1, clamped);
}

export function startOfMonth(period: YearMonth): Date {
  return new Date(period.year, period.month - 1, 1);
}

export function endOfMonth(period: YearMonth): Date {
  return new Date(period.year, period.month - 1, daysInMonth(period), 23, 59, 59, 999);
}

export function containsDate(period: YearMonth, date: Date): boolean {
  return date.getFullYear() === period.year && date.getMonth() + 1 === period.month;
}

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function formatYearMonth(period: YearMonth): string {
  const name = MONTH_NAMES[period.month - 1] ?? '';
  return `${name} ${period.year}`;
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Conversion d'une date stockée.
 *
 * Une date au format « 2026-03-05 » est interprétée par `new Date()` comme minuit UTC :
 * à l'ouest de Greenwich, elle recule d'un jour et la transaction change de mois. On la
 * construit donc explicitement en heure locale.
 */
export function parseDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

/** Format de stockage : « 2026-03-05 », sans heure ni fuseau. */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
