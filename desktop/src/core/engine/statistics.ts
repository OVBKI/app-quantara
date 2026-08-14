import { Money, divRound } from '../money';
import type { Currency } from '../money';

/**
 * Statistiques sur des montants.
 *
 * La médiane est préférée à la moyenne partout où un mois exceptionnel ne doit pas
 * fausser la référence : un remboursement de 3 000 € déplace la moyenne, pas la médiane.
 */
export const Statistics = {
  sum(values: readonly Money[], currency: Currency): Money {
    return Money.sum(values, currency);
  },

  mean(values: readonly Money[], currency: Currency): Money {
    if (values.length === 0) return Money.zero(currency);
    return Money.sum(values, currency).dividedBy(BigInt(values.length));
  },

  median(values: readonly Money[], currency: Currency): Money {
    if (values.length === 0) return Money.zero(currency);
    const sorted = [...values].sort((a, b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0));
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle]!;
    const low = sorted[middle - 1]!;
    const high = sorted[middle]!;
    return Money.fromMicros(divRound(low.micros + high.micros, 2n), currency);
  },

  /** Percentile par interpolation linéaire, `ratio` entre 0 et 1. */
  percentile(values: readonly Money[], ratio: number, currency: Currency): Money {
    if (values.length === 0) return Money.zero(currency);
    const sorted = [...values].sort((a, b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0));
    const position = Math.min(Math.max(ratio, 0), 1) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower]!;
    const weight = position - lower;
    const delta = sorted[upper]!.micros - sorted[lower]!.micros;
    return Money.fromMicros(sorted[lower]!.micros + BigInt(Math.round(Number(delta) * weight)), currency);
  },

  standardDeviation(values: readonly Money[], currency: Currency): Money {
    if (values.length < 2) return Money.zero(currency);
    const average = Statistics.mean(values, currency).units;
    const variance =
      values.reduce((total, value) => total + (value.units - average) ** 2, 0) / (values.length - 1);
    return Money.of(Math.sqrt(variance), currency);
  },

  /** Coefficient de variation : mesure l'irrégularité d'un revenu, indépendamment de
   *  son niveau. `null` si la moyenne est nulle. */
  coefficientOfVariation(values: readonly Money[], currency: Currency): number | null {
    const average = Statistics.mean(values, currency);
    if (average.isZero) return null;
    return Statistics.standardDeviation(values, currency).units / Math.abs(average.units);
  },
};
