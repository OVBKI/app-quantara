import { Money } from './money';

/**
 * Périodicité d'un flux récurrent.
 *
 * Le cœur de la normalisation budgétaire : toute somme récurrente est ramenée à un
 * équivalent mensuel via son nombre d'occurrences annuelles, jamais via une
 * approximation « un mois = 30 jours », qui dérive de six jours par an.
 */
export type Frequency =
  | 'daily'
  | 'weekly'
  | 'biweekly' // toutes les deux semaines (26 fois par an, ≠ bimensuel)
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'oneOff'; // ponctuel : compte pour le mois de sa date, jamais lissé

export const FREQUENCIES: readonly Frequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'oneOff',
];

/** Nombre d'occurrences par an. `null` pour un flux ponctuel, qui n'est pas récurrent. */
export function occurrencesPerYear(frequency: Frequency): number | null {
  switch (frequency) {
    case 'daily':
      return 365;
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'semiannual':
      return 2;
    case 'annual':
      return 1;
    case 'oneOff':
      return null;
  }
}

/**
 * Équivalent mensuel d'un montant récurrent.
 *
 * Exemples du cahier des charges :
 * - assurance annuelle 1 200 € → 1 200 × 1 ÷ 12 = 100 €/mois
 * - salaire mensuel 3 000 €    → 3 000 × 12 ÷ 12 = 3 000 €/mois
 *
 * La multiplication précède la division : c'est ce qui rend le résultat exact.
 */
export function monthlyEquivalent(amount: Money, frequency: Frequency): Money {
  const occurrences = occurrencesPerYear(frequency);
  if (occurrences === null) return Money.zero(amount.currency);
  return amount.timesFraction(occurrences, 12);
}

export function annualEquivalent(amount: Money, frequency: Frequency): Money {
  const occurrences = occurrencesPerYear(frequency);
  if (occurrences === null) return Money.zero(amount.currency);
  return amount.times(occurrences);
}

export function isRecurring(frequency: Frequency): boolean {
  return frequency !== 'oneOff';
}

/** Nombre de jours approximatif entre deux occurrences — sert à placer les échéances
 *  non mensuelles dans la projection de trésorerie. */
export function approximateDayInterval(frequency: Frequency): number | null {
  const occurrences = occurrencesPerYear(frequency);
  if (occurrences === null) return null;
  return 365 / occurrences;
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
  biweekly: 'Toutes les deux semaines',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  semiannual: 'Semestriel',
  annual: 'Annuel',
  oneOff: 'Ponctuel',
};
