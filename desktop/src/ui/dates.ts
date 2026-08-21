import { parseDate } from '../core/yearMonth';

/**
 * Affichage des dates.
 *
 * Une date stockée est une chaîne « 2026-03-05 ». La passer à `new Date()` l'interprète
 * comme minuit UTC : à l'ouest de Greenwich elle recule d'un jour, et l'écran affiche la
 * veille de ce qui est enregistré. Tout passe donc par `parseDate`, qui la construit en
 * heure locale — et rien n'affiche jamais la chaîne brute, qui ne se lit pas.
 */

function asDate(value: string | Date): Date {
  return typeof value === 'string' ? parseDate(value) : value;
}

/** « 5 mars » — pour une date proche, dont l'année va de soi. */
export function formatDay(value: string | Date): string {
  return asDate(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** « 5 mars 2026 » — dès que l'année peut différer de l'année en cours. */
export function formatFullDay(value: string | Date): string {
  return asDate(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** « jeu. 5 mars » — pour une liste de mouvements, où le jour de semaine aide à se repérer. */
export function formatWeekday(value: string | Date): string {
  return asDate(value).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
}

/** « jeudi 5 mars » — en tête d'un groupe de la liste, où la place ne manque pas. */
export function formatLongWeekday(value: string | Date): string {
  return asDate(value).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
