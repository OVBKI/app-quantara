/**
 * Montants monétaires.
 *
 * Stockés en micro-unités (10⁻⁶ euro) dans un `bigint`, jamais en `number` :
 * en binaire `0.1 + 0.2 !== 0.3`, et l'écart devient visible dès qu'on additionne
 * quelques centaines de transactions. Six décimales laissent de la marge aux calculs
 * intermédiaires — un loyer hebdomadaire ramené au mois, un ratio appliqué à une
 * enveloppe — avant l'arrondi final au centime.
 *
 * Les opérations entre devises différentes sont une erreur de programmation et lèvent
 * une exception : un profil Quantara est mono-devise.
 */

export type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'CAD';

export const CURRENCIES: readonly Currency[] = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'];

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: 'CHF',
  CAD: 'CA$',
};

/** Nombre de décimales stockées. */
const SCALE = 6;
/** 1 unité monétaire, en micro-unités. */
const UNIT = 1_000_000n;

export type RoundingMode = 'half-even' | 'half-up' | 'down';

/**
 * Division entière arrondie.
 *
 * `half-even` (arrondi bancaire) par défaut : sur une somme de nombreuses lignes il ne
 * dérive pas systématiquement vers le haut, contrairement à l'arrondi commercial.
 */
export function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode = 'half-even'): bigint {
  if (denominator === 0n) throw new Error('Division par zéro');

  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;

  const quotient = a / b;
  const remainder = a % b;
  if (remainder === 0n) return negative ? -quotient : quotient;

  const twiceRemainder = remainder * 2n;
  let rounded = quotient;

  if (mode === 'down') {
    rounded = quotient;
  } else if (twiceRemainder > b) {
    rounded = quotient + 1n;
  } else if (twiceRemainder < b) {
    rounded = quotient;
  } else if (mode === 'half-up') {
    rounded = quotient + 1n;
  } else {
    // Pile au milieu : on va vers le voisin pair.
    rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
  }

  return negative ? -rounded : rounded;
}

function scaledFromNumber(value: number): bigint {
  if (!Number.isFinite(value)) throw new Error(`Valeur non finie : ${value}`);
  // On passe par une chaîne de caractères pour ne pas propager l'imprécision binaire
  // du `number` dans le `bigint`.
  return scaledFromString(value.toFixed(SCALE));
}

function scaledFromString(text: string): bigint {
  const trimmed = text.trim();
  const match = /^(-)?(\d*)(?:[.,](\d*))?$/.exec(trimmed);
  if (!match) throw new Error(`Montant illisible : « ${text} »`);

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') throw new Error(`Montant illisible : « ${text} »`);

  const padded = (fraction + '0'.repeat(SCALE)).slice(0, SCALE);
  const dropped = fraction.slice(SCALE);
  let micros = BigInt(whole || '0') * UNIT + BigInt(padded || '0');

  // Au-delà de la sixième décimale on arrondit plutôt que de tronquer.
  if (dropped.length > 0 && Number(dropped[0]) >= 5) micros += 1n;

  return sign === '-' ? -micros : micros;
}

export interface MoneyJSON {
  readonly __money: string;
  readonly currency: Currency;
}

export function isMoneyJSON(value: unknown): value is MoneyJSON {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MoneyJSON).__money === 'string' &&
    typeof (value as MoneyJSON).currency === 'string'
  );
}

export class Money {
  private constructor(
    readonly micros: bigint,
    readonly currency: Currency,
  ) {}

  // --- Constructions ---

  static zero(currency: Currency = 'EUR'): Money {
    return new Money(0n, currency);
  }

  /** À partir d'un nombre d'unités entières ou décimales : `Money.of(1200)` = 1 200 €. */
  static of(units: number | bigint, currency: Currency = 'EUR'): Money {
    const micros = typeof units === 'bigint' ? units * UNIT : scaledFromNumber(units);
    return new Money(micros, currency);
  }

  /** À partir d'une saisie utilisateur : accepte « 1234,56 » comme « 1234.56 ». */
  static parse(text: string, currency: Currency = 'EUR'): Money {
    return new Money(scaledFromString(text), currency);
  }

  static fromMicros(micros: bigint, currency: Currency = 'EUR'): Money {
    return new Money(micros, currency);
  }

  static fromCents(cents: number | bigint, currency: Currency = 'EUR'): Money {
    return new Money(BigInt(cents) * 10_000n, currency);
  }

  static sum(values: readonly Money[], currency: Currency): Money {
    return values.reduce((total, value) => total.plus(value), Money.zero(currency));
  }

  static min(a: Money, b: Money): Money {
    return a.lessThan(b) ? a : b;
  }

  static max(a: Money, b: Money): Money {
    return a.greaterThan(b) ? a : b;
  }

  /**
   * Comparateur de tri, du plus grand au plus petit.
   *
   * Rend bien **zéro** pour deux montants égaux. Les comparateurs écrits
   * `(a, b) => b.greaterThan(a) ? 1 : -1` n'en rendent jamais : ils affirment à la fois
   * que `a` précède `b` et que `b` précède `a`, ce qui n'est pas un ordre. Sur des
   * montants ex æquo — deux postes à 120 €, deux abonnements au même prix — l'ordre
   * obtenu dépend alors de l'implémentation du tri et peut changer d'un rendu à l'autre.
   */
  static compareDescending(a: Money, b: Money): number {
    if (a.micros === b.micros) return 0;
    return a.micros > b.micros ? -1 : 1;
  }

  // --- Prédicats ---

  get isZero(): boolean {
    return this.micros === 0n;
  }

  get isPositive(): boolean {
    return this.micros > 0n;
  }

  get isNegative(): boolean {
    return this.micros < 0n;
  }

  /** Valeur en unités, pour l'affichage et les graphiques uniquement — jamais pour calculer. */
  get units(): number {
    return Number(this.micros) / Number(UNIT);
  }

  get cents(): number {
    return Number(divRound(this.micros, 10_000n));
  }

  // --- Arithmétique ---

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Opération entre devises différentes (${this.currency} / ${other.currency}) : ` +
          'un profil Quantara est mono-devise.',
      );
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.micros + other.micros, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.micros - other.micros, this.currency);
  }

  /** Multiplication par un facteur sans unité. */
  times(factor: number | bigint): Money {
    if (typeof factor === 'bigint') return new Money(this.micros * factor, this.currency);
    return new Money(divRound(this.micros * scaledFromNumber(factor), UNIT), this.currency);
  }

  /**
   * Multiplication par une fraction exacte — `montant × num ÷ den` en une seule opération.
   *
   * L'ordre compte : `1 200 × (1/12)` passe par 0,083333… et rend 99,9996 ;
   * `1 200 × 1 ÷ 12` rend exactement 100. Toute conversion de périodicité passe par ici.
   */
  timesFraction(numerator: number | bigint, denominator: number | bigint): Money {
    const num = BigInt(numerator);
    const den = BigInt(denominator);
    if (den === 0n) return Money.zero(this.currency);
    return new Money(divRound(this.micros * num, den), this.currency);
  }

  dividedBy(divisor: number | bigint): Money {
    if (typeof divisor === 'bigint') {
      if (divisor === 0n) return Money.zero(this.currency);
      return new Money(divRound(this.micros, divisor), this.currency);
    }
    if (divisor === 0) return Money.zero(this.currency);
    return new Money(divRound(this.micros * UNIT, scaledFromNumber(divisor)), this.currency);
  }

  get negated(): Money {
    return new Money(-this.micros, this.currency);
  }

  get absolute(): Money {
    return new Money(this.micros < 0n ? -this.micros : this.micros, this.currency);
  }

  /** Ramène les montants négatifs à zéro : un reste à vivre négatif ne doit pas se
   *  propager dans une répartition. */
  get clampedToZero(): Money {
    return this.micros < 0n ? Money.zero(this.currency) : this;
  }

  /**
   * Ratio sans unité entre deux montants.
   *
   * `null` si le dénominateur est nul — et non 0, qui se confondrait avec un ratio
   * réellement nul. L'appelant est ainsi forcé de traiter le cas « pas de revenu ».
   */
  ratioTo(other: Money): number | null {
    this.assertSameCurrency(other);
    if (other.micros === 0n) return null;
    return Number(this.micros) / Number(other.micros);
  }

  // --- Comparaisons ---

  equals(other: Money): boolean {
    return this.currency === other.currency && this.micros === other.micros;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.micros < other.micros;
  }

  lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.micros <= other.micros;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.micros > other.micros;
  }

  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.micros >= other.micros;
  }

  // --- Arrondis ---

  roundedTo(decimals = 2, mode: RoundingMode = 'half-even'): Money {
    const factor = 10n ** BigInt(SCALE - decimals);
    return new Money(divRound(this.micros, factor, mode) * factor, this.currency);
  }

  /** Arrondi à l'unité : « 187 € par mois » plutôt que « 187,43 € », faussement précis. */
  get roundedToUnit(): Money {
    return this.roundedTo(0, 'half-up');
  }

  // --- Formatage ---

  format(locale = 'fr-FR', decimals?: number): string {
    const digits = decimals ?? 2;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(this.units);
  }

  /** Format compact pour les tuiles et les axes de graphique : « 12,4 k€ ». */
  formatCompact(locale = 'fr-FR'): string {
    const absolute = Math.abs(this.units);
    const symbol = CURRENCY_SYMBOLS[this.currency];
    if (absolute >= 1_000_000) {
      return `${(this.units / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })} M${symbol}`;
    }
    if (absolute >= 10_000) {
      return `${(this.units / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })} k${symbol}`;
    }
    return this.format(locale, 0);
  }

  toString(): string {
    return this.format();
  }

  // --- Sérialisation ---

  /** Le marqueur `__money` permet au lecteur JSON de reconnaître un montant et de le
   *  reconstruire — sans lui, un montant relu ne serait qu'un objet quelconque. */
  toJSON(): MoneyJSON {
    return { __money: this.micros.toString(), currency: this.currency };
  }

  static fromJSON(value: MoneyJSON): Money {
    return new Money(BigInt(value.__money), value.currency);
  }
}

export const Percent = {
  /** Formate un ratio (0,185) en pourcentage (« 18,5 % »). */
  format(ratio: number | null | undefined, locale = 'fr-FR', decimals = 1): string {
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(ratio);
  },

  /** Variation relative entre deux montants. `null` si la référence est nulle. */
  change(previous: Money, current: Money): number | null {
    if (previous.isZero) return null;
    return Number(current.micros - previous.micros) / Math.abs(Number(previous.micros));
  },
};

/**
 * Un nombre décimal, écrit en français.
 *
 * `toFixed` produit « 3.5 » : le point décimal anglais, au milieu d'une interface en
 * français, à côté de montants qui utilisent la virgule. Trois écrans affichaient ainsi
 * « 3.5 mois couverts » et « 5.00 % » — un détail, mais de ceux qui font douter du reste.
 */
export function formatDecimal(value: number, decimals = 1, locale = 'fr-FR'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
