import type { AllocationPart } from '../core/model';

/**
 * Habillage des quatre parts du partage automatique.
 *
 * Une couleur et une phrase par part, définies une seule fois : la même part garde sa
 * teinte du tableau de bord à l'écran Budget. Une couleur qui change d'un écran à l'autre
 * force à relire la légende à chaque fois, et finit par la faire ignorer.
 */
export const ALLOCATION_PART_COLORS: Record<AllocationPart, string> = {
  security: 'var(--series-1)',
  savings: 'var(--series-2)',
  investment: 'var(--series-3)',
  free: 'var(--series-4)',
};

export const ALLOCATION_PART_HINTS: Record<AllocationPart, string> = {
  security: 'De quoi encaisser un imprévu sans emprunter : panne, franchise, mois creux.',
  savings: 'Vos objectifs : vacances, apport, projet.',
  investment: 'Placement long terme. Un placement peut perdre de la valeur.',
  free: 'Sans affectation. De quoi vivre le mois sans puiser ailleurs.',
};

/** Le seau du moteur correspondant à chaque part. */
export const ALLOCATION_PART_BUCKETS = {
  security: 'emergencyFund',
  savings: 'goals',
  investment: 'investment',
  free: 'freeMoney',
} as const;
