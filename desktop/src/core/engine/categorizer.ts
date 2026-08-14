import { Money } from '../money';
import type { ExpenseCategoryId } from '../categories';
import type { Frequency } from '../frequency';
import type { Transaction } from '../model';
import { parseDate } from '../yearMonth';
import { Statistics } from './statistics';

export interface CategorizationRule {
  readonly pattern: string;
  readonly category: ExpenseCategoryId;
  readonly subscription?: boolean;
}

export interface CategorizationResult {
  readonly category: ExpenseCategoryId;
  readonly subscription: boolean;
  /** Une règle apprise de l'utilisateur prime toujours sur une règle intégrée. */
  readonly source: 'user' | 'builtin';
}

/**
 * Normalisation d'un libellé bancaire.
 *
 * Les relevés arrivent en majuscules, sans accents, truncqués, avec des numéros
 * d'autorisation et des dates collées au nom du marchand : « CB CARREFOUR MARKET 4589
 * 12/03 ». On ramène tout à une forme comparable avant d'appliquer la moindre règle.
 */
export function normalize(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(CB|CARTE|PAIEMENT|ACHAT|VIR|VIREMENT|PRLV|PRELEVEMENT|FACTURE|RETRAIT)\b/g, ' ')
    .replace(/\d{2}[/.-]\d{2}([/.-]\d{2,4})?/g, ' ')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Règles intégrées.
 *
 * L'ordre compte : « TOTALENERGIES » doit être testé avant « TOTAL », sinon une facture
 * d'électricité serait classée en carburant.
 */
const BUILTIN_RULES: CategorizationRule[] = [
  // Énergie — avant les enseignes dont le nom est un préfixe.
  { pattern: 'TOTALENERGIES', category: 'fixed.electricity' },
  { pattern: 'EDF', category: 'fixed.electricity' },
  { pattern: 'ENGIE', category: 'fixed.gas' },
  { pattern: 'ENI', category: 'fixed.gas' },
  { pattern: 'VEOLIA', category: 'fixed.water' },
  { pattern: 'SUEZ', category: 'fixed.water' },
  { pattern: 'SAUR', category: 'fixed.water' },

  // Courses
  { pattern: 'CARREFOUR', category: 'variable.groceries' },
  { pattern: 'LECLERC', category: 'variable.groceries' },
  { pattern: 'INTERMARCHE', category: 'variable.groceries' },
  { pattern: 'AUCHAN', category: 'variable.groceries' },
  { pattern: 'LIDL', category: 'variable.groceries' },
  { pattern: 'ALDI', category: 'variable.groceries' },
  { pattern: 'CASINO', category: 'variable.groceries' },
  { pattern: 'MONOPRIX', category: 'variable.groceries' },
  { pattern: 'FRANPRIX', category: 'variable.groceries' },
  { pattern: 'SUPER U', category: 'variable.groceries' },
  { pattern: 'HYPER U', category: 'variable.groceries' },
  { pattern: 'CORA', category: 'variable.groceries' },
  { pattern: 'DELHAIZE', category: 'variable.groceries' },
  { pattern: 'COLRUYT', category: 'variable.groceries' },
  { pattern: 'BIOCOOP', category: 'variable.groceries' },
  { pattern: 'PICARD', category: 'variable.groceries' },
  { pattern: 'BOULANGERIE', category: 'variable.groceries' },

  // Restauration
  { pattern: 'MCDONALD', category: 'variable.restaurants' },
  { pattern: 'BURGER KING', category: 'variable.restaurants' },
  { pattern: 'UBER EATS', category: 'variable.restaurants' },
  { pattern: 'DELIVEROO', category: 'variable.restaurants' },
  { pattern: 'JUST EAT', category: 'variable.restaurants' },
  { pattern: 'RESTAURANT', category: 'variable.restaurants' },
  { pattern: 'BRASSERIE', category: 'variable.restaurants' },
  { pattern: 'STARBUCKS', category: 'variable.restaurants' },
  { pattern: 'SUBWAY', category: 'variable.restaurants' },
  { pattern: 'PIZZA', category: 'variable.restaurants' },

  // Carburant et transports
  { pattern: 'TOTAL', category: 'variable.fuel' },
  { pattern: 'ESSO', category: 'variable.fuel' },
  { pattern: 'SHELL', category: 'variable.fuel' },
  { pattern: 'BP ', category: 'variable.fuel' },
  { pattern: 'AVIA', category: 'variable.fuel' },
  { pattern: 'STATION', category: 'variable.fuel' },
  { pattern: 'SNCF', category: 'variable.publicTransport' },
  { pattern: 'RATP', category: 'variable.publicTransport' },
  { pattern: 'NAVIGO', category: 'variable.publicTransport' },
  { pattern: 'UBER', category: 'variable.publicTransport' },
  { pattern: 'BLABLACAR', category: 'variable.publicTransport' },
  { pattern: 'STIB', category: 'variable.publicTransport' },
  { pattern: 'TEC ', category: 'variable.publicTransport' },
  { pattern: 'PEAGE', category: 'variable.fuel' },
  { pattern: 'PARKING', category: 'variable.publicTransport' },

  // Abonnements
  { pattern: 'NETFLIX', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'SPOTIFY', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'DEEZER', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'DISNEY', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'CANAL', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'AMAZON PRIME', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'APPLE COM BILL', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'GOOGLE STORAGE', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'MICROSOFT', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'OPENAI', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'BASIC FIT', category: 'fixed.subscriptions', subscription: true },
  { pattern: 'FITNESS PARK', category: 'fixed.subscriptions', subscription: true },

  // Télécom
  { pattern: 'ORANGE', category: 'fixed.phone' },
  { pattern: 'SFR', category: 'fixed.phone' },
  { pattern: 'BOUYGUES', category: 'fixed.phone' },
  { pattern: 'FREE MOBILE', category: 'fixed.phone' },
  { pattern: 'FREE ', category: 'fixed.internet' },
  { pattern: 'PROXIMUS', category: 'fixed.phone' },
  { pattern: 'VOO', category: 'fixed.internet' },

  // Logement et assurances
  { pattern: 'LOYER', category: 'fixed.rent' },
  { pattern: 'AXA', category: 'fixed.insurance' },
  { pattern: 'MAIF', category: 'fixed.insurance' },
  { pattern: 'MACIF', category: 'fixed.insurance' },
  { pattern: 'MATMUT', category: 'fixed.insurance' },
  { pattern: 'ALLIANZ', category: 'fixed.insurance' },
  { pattern: 'GENERALI', category: 'fixed.insurance' },
  { pattern: 'ASSURANCE', category: 'fixed.insurance' },
  { pattern: 'MUTUELLE', category: 'fixed.insurance' },
  { pattern: 'IMPOT', category: 'fixed.taxes' },
  { pattern: 'DGFIP', category: 'fixed.taxes' },
  { pattern: 'TRESOR PUBLIC', category: 'fixed.taxes' },

  // Santé
  { pattern: 'PHARMACIE', category: 'variable.health' },
  { pattern: 'DOCTEUR', category: 'variable.health' },
  { pattern: 'CABINET MEDICAL', category: 'variable.health' },
  { pattern: 'LABORATOIRE', category: 'variable.health' },
  { pattern: 'DENTISTE', category: 'variable.health' },
  { pattern: 'OPTIC', category: 'variable.health' },

  // Achats divers
  { pattern: 'AMAZON', category: 'variable.household' },
  { pattern: 'FNAC', category: 'variable.leisure' },
  { pattern: 'DECATHLON', category: 'variable.leisure' },
  { pattern: 'CULTURA', category: 'variable.leisure' },
  { pattern: 'CINEMA', category: 'variable.leisure' },
  { pattern: 'UGC', category: 'variable.leisure' },
  { pattern: 'ZARA', category: 'variable.clothing' },
  { pattern: 'H M', category: 'variable.clothing' },
  { pattern: 'UNIQLO', category: 'variable.clothing' },
  { pattern: 'KIABI', category: 'variable.clothing' },
  { pattern: 'IKEA', category: 'variable.household' },
  { pattern: 'LEROY MERLIN', category: 'variable.household' },
  { pattern: 'CASTORAMA', category: 'variable.household' },
  { pattern: 'BRICO', category: 'variable.household' },

  // Enfants et animaux
  { pattern: 'CRECHE', category: 'variable.children' },
  { pattern: 'CENTRE DE LOISIRS', category: 'variable.children' },
  { pattern: 'CANTINE', category: 'variable.children' },
  { pattern: 'VETERINAIRE', category: 'variable.pets' },
  { pattern: 'MAXI ZOO', category: 'variable.pets' },
  { pattern: 'ANIMALERIE', category: 'variable.pets' },

  // Soins personnels
  { pattern: 'COIFFEUR', category: 'variable.personal' },
  { pattern: 'SEPHORA', category: 'variable.personal' },
  { pattern: 'NOCIBE', category: 'variable.personal' },
  { pattern: 'YVES ROCHER', category: 'variable.personal' },
];

/**
 * Catégorisation d'un libellé.
 *
 * Entièrement locale : aucun libellé ne quitte la machine. Un relevé bancaire est une
 * des données les plus intimes qui soient — il révèle la santé, les convictions, les
 * habitudes — et n'a aucune raison d'être envoyé ailleurs pour être trié.
 */
export function categorize(
  label: string,
  userRules: readonly CategorizationRule[] = [],
): CategorizationResult | null {
  const normalized = normalize(label);
  if (normalized.length < 2) return null;

  for (const rule of userRules) {
    if (normalized.includes(normalize(rule.pattern))) {
      return { category: rule.category, subscription: rule.subscription ?? false, source: 'user' };
    }
  }

  for (const rule of BUILTIN_RULES) {
    if (normalized.includes(rule.pattern)) {
      return { category: rule.category, subscription: rule.subscription ?? false, source: 'builtin' };
    }
  }

  return null;
}

export interface DetectedRecurrence {
  readonly label: string;
  readonly averageAmount: Money;
  readonly occurrences: number;
  readonly suggestedFrequency: Frequency;
}

/**
 * Détection des charges récurrentes cachées dans les transactions.
 *
 * Une dépense qui revient à intervalle régulier n'est pas une dépense variable : la
 * traiter comme telle fausse à la fois la projection du mois et le calcul du disponible.
 * On repère les libellés récurrents pour proposer de les convertir en charge déclarée.
 */
export function detectRecurrences(transactions: readonly Transaction[]): DetectedRecurrence[] {
  const groups = new Map<string, Transaction[]>();

  for (const transaction of transactions) {
    if (transaction.kind !== 'expense') continue;
    const key = normalize(transaction.label);
    if (key.length < 3) continue;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  const results: DetectedRecurrence[] = [];

  for (const [label, entries] of groups) {
    if (entries.length < 3) continue;

    const dates = entries.map((entry) => parseDate(entry.date).getTime()).sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let index = 1; index < dates.length; index += 1) {
      intervals.push((dates[index]! - dates[index - 1]!) / 86_400_000);
    }
    if (intervals.length === 0) continue;

    const averageInterval = intervals.reduce((total, value) => total + value, 0) / intervals.length;
    const spread = Math.max(...intervals) - Math.min(...intervals);

    // Un écart trop large entre les intervalles trahit une coïncidence, pas un abonnement.
    if (spread > averageInterval * 0.5) continue;

    const frequency = frequencyFor(averageInterval);
    if (!frequency) continue;

    results.push({
      label,
      averageAmount: Statistics.median(
        entries.map((entry) => entry.amount),
        entries[0]!.amount.currency,
      ),
      occurrences: entries.length,
      suggestedFrequency: frequency,
    });
  }

  return results.sort((a, b) => b.occurrences - a.occurrences);
}

function frequencyFor(days: number): Frequency | null {
  if (days >= 6 && days <= 8) return 'weekly';
  if (days >= 13 && days <= 16) return 'biweekly';
  if (days >= 26 && days <= 35) return 'monthly';
  if (days >= 85 && days <= 95) return 'quarterly';
  if (days >= 175 && days <= 190) return 'semiannual';
  if (days >= 355 && days <= 375) return 'annual';
  return null;
}
