import { Money, Percent } from '../money';
import { activeDebts } from '../model';
import { highInterestDebts } from './debt';
import type { FinancialAnalysis } from './analysis';

/**
 * Repère de santé financière.
 *
 * Six critères simples, chacun vert, orange ou rouge, et un état d'ensemble donné par le
 * plus mauvais d'entre eux. Volontairement pas de note sur 100 : un score unique donne
 * l'illusion de la précision et n'indique jamais quoi faire, alors qu'un critère au rouge
 * désigne l'action.
 *
 * Ce n'est pas un diagnostic. Les seuils sont des conventions courantes, pas des vérités,
 * et ils sont écrits ici pour pouvoir être discutés.
 */

export type HealthLevel = 'good' | 'watch' | 'alert';

export interface HealthCriterion {
  readonly id: string;
  readonly label: string;
  readonly level: HealthLevel;
  /** Ce que dit le chiffre, en clair. */
  readonly detail: string;
  /** Ce qu'il y a à faire quand ce n'est pas au vert. `null` si tout va bien. */
  readonly action: string | null;
}

export interface HealthReport {
  readonly level: HealthLevel;
  readonly headline: string;
  readonly criteria: readonly HealthCriterion[];
}

const LEVEL_ORDER: Record<HealthLevel, number> = { good: 0, watch: 1, alert: 2 };

const HEADLINES: Record<HealthLevel, string> = {
  good: 'Situation saine',
  watch: 'À surveiller',
  alert: 'Point de vigilance',
};

function worst(levels: readonly HealthLevel[]): HealthLevel {
  return levels.reduce<HealthLevel>(
    (highest, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[highest] ? level : highest),
    'good',
  );
}

function percent(value: number | null): string {
  return value === null ? '—' : Percent.format(value, 'fr-FR', 0);
}

export function assessHealth(analysis: FinancialAnalysis): HealthReport {
  const { summary, emergencyFund } = analysis;
  const criteria: HealthCriterion[] = [];

  // 1. Vivre en deçà de ses revenus. Le reste ne compte pas si celui-ci est au rouge.
  criteria.push({
    id: 'disposable',
    label: 'Dépenses face aux revenus',
    level: summary.disposable.isNegative ? 'alert' : summary.disposable.isZero ? 'watch' : 'good',
    detail: summary.disposable.isNegative
      ? `Il manque ${summary.disposable.absolute.roundedToUnit.format()} pour boucler le mois.`
      : `Il reste ${summary.disposable.roundedToUnit.format()} après toutes les charges.`,
    action: summary.disposable.isNegative
      ? 'Réduire une dépense variable, ou renégocier une charge fixe : aucun autre poste ne peut progresser tant que le mois est déficitaire.'
      : null,
  });

  // 2. Fonds d'urgence : trois mois est le seuil couramment retenu, un mois le minimum.
  const months = emergencyFund.monthsCovered;
  criteria.push({
    id: 'emergencyFund',
    label: 'Fonds d’urgence',
    level: months >= 3 ? 'good' : months >= 1 ? 'watch' : 'alert',
    detail: `${months.toFixed(1)} mois de dépenses essentielles couverts.`,
    action:
      months >= 3
        ? null
        : 'Un imprévu se règle sinon par un découvert ou un crédit, tous deux plus coûteux que l’épargne qu’ils remplacent.',
  });

  // 3. Taux d'épargne. 10 % est un repère répandu ; 5 % vaut mieux que rien.
  const rate = summary.savingsRate;
  criteria.push({
    id: 'savingsRate',
    label: 'Taux d’épargne',
    level: rate === null ? 'watch' : rate >= 0.1 ? 'good' : rate >= 0.05 ? 'watch' : 'alert',
    detail: `${percent(rate)} du revenu mis de côté ce mois-ci.`,
    action: rate !== null && rate >= 0.1 ? null : 'Un virement automatique le jour de la paie épargne sans y penser.',
  });

  // 4. Poids des charges fixes. Au-delà de la moitié du revenu, la marge de manœuvre
  //    disparaît : aucune dépense variable ne peut plus être ajustée utilement.
  const fixed = summary.fixedRatio;
  criteria.push({
    id: 'fixedLoad',
    label: 'Poids des charges fixes',
    level: fixed === null ? 'watch' : fixed <= 0.5 ? 'good' : fixed <= 0.65 ? 'watch' : 'alert',
    detail: `${percent(fixed)} du revenu part en charges fixes.`,
    action:
      fixed !== null && fixed <= 0.5
        ? null
        : 'Ce sont les postes les plus lourds — logement, assurances, abonnements — qui offrent les vraies économies.',
  });

  // 5. Enveloppes tenues.
  const exceeded = summary.envelopes.envelopes.filter((envelope) => envelope.state === 'exceeded');
  const atRisk = summary.envelopes.envelopes.filter((envelope) => envelope.state === 'atRisk');
  criteria.push({
    id: 'envelopes',
    label: 'Budgets par catégorie',
    level: exceeded.length > 0 ? 'alert' : atRisk.length > 0 ? 'watch' : 'good',
    detail:
      summary.envelopes.envelopes.length === 0
        ? 'Aucune enveloppe définie.'
        : exceeded.length > 0
          ? `${exceeded.length} enveloppe${exceeded.length > 1 ? 's' : ''} dépassée${exceeded.length > 1 ? 's' : ''}.`
          : atRisk.length > 0
            ? `${atRisk.length} enveloppe${atRisk.length > 1 ? 's' : ''} consommée${atRisk.length > 1 ? 's' : ''} plus vite que le mois.`
            : 'Toutes les enveloppes sont tenues.',
    action: exceeded.length > 0 || atRisk.length > 0 ? 'Ajuster le plafond, ou la dépense — mais pas laisser l’écart courir.' : null,
  });

  // 6. Dettes coûteuses. Au-delà de 8 %, rembourser rapporte plus que placer.
  const expensive = Money.sum(
    highInterestDebts(activeDebts(analysis.profile)).map((debt) => debt.outstanding),
    analysis.profile.currency,
  );
  criteria.push({
    id: 'debt',
    label: 'Dettes coûteuses',
    level: expensive.isZero ? 'good' : 'alert',
    detail: expensive.isZero
      ? 'Aucune dette au-delà de 8 % l’an.'
      : `${expensive.roundedToUnit.format()} restant dû à taux élevé.`,
    action: expensive.isZero ? null : 'Chaque euro remboursé rapporte le taux du crédit, sans risque.',
  });

  const level = worst(criteria.map((criterion) => criterion.level));
  return { level, headline: HEADLINES[level], criteria };
}
