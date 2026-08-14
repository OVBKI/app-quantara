import { Money } from '../money';
import type { Currency } from '../money';

export interface SimulationPoint {
  readonly month: number;
  readonly contributed: Money;
  readonly interest: Money;
  readonly total: Money;
}

export interface SimulationResult {
  readonly points: readonly SimulationPoint[];
  readonly finalAmount: Money;
  readonly totalContributed: Money;
  readonly totalInterest: Money;
  readonly annualRate: number;
  readonly months: number;
}

export interface Scenario {
  readonly label: string;
  readonly annualRate: number;
  readonly description: string;
  readonly result: SimulationResult;
}

/**
 * Bornes de taux acceptées.
 *
 * Un taux négatif ou à 40 % produirait une projection qui n'informe pas, elle trompe.
 * On borne donc l'entrée plutôt que d'afficher un résultat absurde.
 */
const MIN_RATE = -0.1;
const MAX_RATE = 0.2;
const MAX_MONTHS = 720; // 60 ans

/**
 * Projection à intérêts composés.
 *
 * Les intérêts sont capitalisés mensuellement sur le solde en cours, versement compris :
 * c'est le fonctionnement d'un placement réel, et l'écart avec une formule annuelle
 * simplifiée devient net au-delà de quelques années.
 *
 * Aucun rendement n'est garanti. Cette projection est une hypothèse arithmétique,
 * pas une promesse : un placement peut perdre de la valeur.
 */
export function project(
  monthlyContribution: Money,
  initialAmount: Money,
  annualRate: number,
  months: number,
  currency: Currency,
): SimulationResult {
  const rate = Math.min(Math.max(annualRate, MIN_RATE), MAX_RATE);
  const clampedMonths = Math.min(Math.max(Math.round(months), 0), MAX_MONTHS);
  const monthlyRate = rate / 12;

  const points: SimulationPoint[] = [];
  let balance = initialAmount;
  let contributed = initialAmount;
  let interest = Money.zero(currency);

  for (let month = 1; month <= clampedMonths; month += 1) {
    balance = balance.plus(monthlyContribution);
    contributed = contributed.plus(monthlyContribution);

    const monthInterest = balance.times(monthlyRate);
    balance = balance.plus(monthInterest);
    interest = interest.plus(monthInterest);

    points.push({ month, contributed, interest, total: balance });
  }

  return {
    points,
    finalAmount: balance,
    totalContributed: contributed,
    totalInterest: interest,
    annualRate: rate,
    months: clampedMonths,
  };
}

/** Nombre de mois pour atteindre un montant. `null` si le rythme ne l'atteint jamais. */
export function monthsToReach(
  target: Money,
  monthlyContribution: Money,
  initialAmount: Money,
  annualRate: number,
): number | null {
  if (initialAmount.greaterThanOrEqual(target)) return 0;
  if (!monthlyContribution.isPositive && annualRate <= 0) return null;

  const rate = Math.min(Math.max(annualRate, MIN_RATE), MAX_RATE) / 12;
  let balance = initialAmount;

  for (let month = 1; month <= MAX_MONTHS; month += 1) {
    balance = balance.plus(monthlyContribution);
    balance = balance.plus(balance.times(rate));
    if (balance.greaterThanOrEqual(target)) return month;
  }
  return null;
}

/**
 * Trois scénarios encadrant l'incertitude.
 *
 * Afficher un seul chiffre laisserait croire à une prévision. Trois hypothèses montrent
 * l'ampleur de l'écart possible — et c'est cet écart, plus que la valeur centrale, qui
 * doit guider une décision.
 */
export function scenarios(
  monthlyContribution: Money,
  initialAmount: Money,
  months: number,
  currency: Currency,
): Scenario[] {
  return [
    {
      label: 'Prudent',
      annualRate: 0.02,
      description: 'Épargne réglementée ou fonds sécurisé. Le capital ne baisse pas, mais l’inflation le grignote.',
      result: project(monthlyContribution, initialAmount, 0.02, months, currency),
    },
    {
      label: 'Intermédiaire',
      annualRate: 0.04,
      description: 'Allocation mixte. Des années négatives sont normales ; c’est la moyenne longue qui compte.',
      result: project(monthlyContribution, initialAmount, 0.04, months, currency),
    },
    {
      label: 'Dynamique',
      annualRate: 0.07,
      description: 'Forte exposition aux actions. Des baisses de 30 % ou plus se sont déjà produites, et se reproduiront.',
      result: project(monthlyContribution, initialAmount, 0.07, months, currency),
    },
  ];
}

export const RISK_DISCLAIMER =
  'Ces projections sont des hypothèses arithmétiques, pas des prévisions. Les rendements passés ne ' +
  'préjugent pas des rendements futurs, et un placement peut perdre de la valeur. Quantara ne recommande ' +
  'aucun produit financier : ces ordres de grandeur servent uniquement à comprendre l’effet du temps et ' +
  'des versements réguliers.';

/**
 * Effet de l'inflation.
 *
 * 100 000 € dans vingt ans n'achètent pas ce que 100 000 € achètent aujourd'hui. Sans
 * cette conversion, une projection longue paraît deux fois plus flatteuse qu'elle ne l'est.
 */
export function inRealTerms(amount: Money, months: number, annualInflation = 0.02): Money {
  const years = months / 12;
  return amount.times(1 / (1 + annualInflation) ** years);
}
