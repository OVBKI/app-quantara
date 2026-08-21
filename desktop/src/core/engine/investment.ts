import { formatDecimal, Money } from '../money';
import { isHighInterest, type FinancialProfile } from '../model';
import type { EmergencyFundStatus } from './emergencyFund';
import type { MonthlySummary } from './budget';

/**
 * Volet investissement — **éducatif**.
 *
 * Ce module ne recommande aucun produit, ne nomme aucun émetteur, ne cite aucun code
 * ISIN et ne promet aucun rendement. Il décrit des classes d'actifs et vérifie des
 * préalables. Ce choix n'est pas de la prudence rédactionnelle : une recommandation
 * personnalisée portant sur un instrument financier constitue du conseil en
 * investissement, activité réglementée qui suppose un agrément (MiFID II en Europe).
 *
 * Ce que le module fait : dire si les conditions préalables sont réunies, et expliquer
 * ce qu'est chaque grande famille de placements.
 * Ce qu'il ne fait pas : dire quoi acheter, quand, ni combien cela rapportera.
 */

export type ReadinessState = 'blocked' | 'partial' | 'ready';

export interface ReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
  /** Un préalable bloquant n'est pas une recommandation : c'est de l'arithmétique. */
  readonly blocking: boolean;
}

export interface AssetClass {
  readonly name: string;
  readonly horizon: string;
  readonly risk: 'faible' | 'modéré' | 'élevé';
  readonly description: string;
  readonly drawback: string;
}

export interface InvestmentGuidance {
  readonly state: ReadinessState;
  readonly checks: readonly ReadinessCheck[];
  /** Montant que la cascade d'allocation oriente vers l'investissement. */
  readonly indicativeMonthly: Money;
  readonly assetClasses: readonly AssetClass[];
  readonly disclaimer: string;
}

export const RISK_DISCLAIMER =
  'Quantara ne fournit aucun conseil en investissement et ne recommande aucun produit. Les contenus ci-dessous ' +
  'sont éducatifs : ils décrivent des familles de placements, sans en désigner aucun. Tout placement peut ' +
  'perdre de la valeur, y compris la totalité du capital investi, et les performances passées ne préjugent ' +
  'pas des performances futures.';

/**
 * Classes d'actifs, décrites par ce qu'elles sont et par leur principal inconvénient.
 *
 * Chaque description porte son revers : présenter un placement sans son défaut, c'est en
 * faire la promotion.
 */
export const ASSET_CLASSES: readonly AssetClass[] = [
  {
    name: 'Épargne de précaution',
    horizon: 'disponible à tout moment',
    risk: 'faible',
    description:
      'Livrets réglementés et comptes rémunérés. Capital garanti, retrait immédiat. C’est le support du fonds ' +
      'd’urgence, pas un placement de rendement.',
    drawback: 'Le rendement dépasse rarement l’inflation : le pouvoir d’achat s’érode lentement.',
  },
  {
    name: 'Obligations et fonds obligataires',
    horizon: '2 à 5 ans',
    risk: 'modéré',
    description:
      'Prêter à un État ou à une entreprise contre un intérêt. Moins volatil que les actions, avec des revenus ' +
      'plus prévisibles.',
    drawback:
      'La valeur baisse quand les taux montent, et l’émetteur peut faire défaut. « Moins risqué » ne veut pas ' +
      'dire « sans risque ».',
  },
  {
    name: 'Actions et fonds actions',
    horizon: '8 ans et plus',
    risk: 'élevé',
    description:
      'Détenir une part d’entreprises. Historiquement la classe la plus rentable sur longue période, et la plus ' +
      'volatile sur courte période.',
    drawback:
      'Des baisses de 30 à 50 % se sont déjà produites et se reproduiront. Vendre pendant une baisse transforme ' +
      'une perte théorique en perte réelle.',
  },
  {
    name: 'Immobilier',
    horizon: '10 ans et plus',
    risk: 'modéré',
    description:
      'En direct ou via des supports collectifs. Revenus locatifs réguliers, adossés à un actif tangible.',
    drawback:
      'Peu liquide, frais d’entrée élevés, et concentré géographiquement. Revendre prend des mois, parfois à perte.',
  },
  {
    name: 'Enveloppes fiscales',
    horizon: 'variable',
    risk: 'faible',
    description:
      'Ce ne sont pas des placements mais des contenants — assurance-vie, plans d’épargne — dont la fiscalité ' +
      'devient favorable après plusieurs années de détention.',
    drawback:
      'L’avantage fiscal ne compense jamais un mauvais placement, et l’argent y est souvent moins disponible.',
  },
];

/**
 * Conditions préalables.
 *
 * L'ordre n'est pas négociable et ne relève pas d'une opinion : rembourser un crédit à
 * 18 % rapporte 18 % sans risque, ce qu'aucun placement ne garantit. Et un placement se
 * liquide mal, souvent à perte, quand on en a un besoin urgent — d'où le fonds d'urgence
 * en premier.
 */
export function investmentGuidance(
  profile: FinancialProfile,
  summary: MonthlySummary,
  emergencyFund: EmergencyFundStatus,
  indicativeMonthly: Money,
): InvestmentGuidance {
  const highInterest = profile.debts.filter((debt) => debt.active && isHighInterest(debt));
  const highInterestTotal = Money.sum(
    highInterest.map((debt) => debt.outstanding),
    profile.currency,
  );

  const checks: ReadinessCheck[] = [
    {
      id: 'emergencyFund',
      label: 'Fonds d’urgence constitué',
      passed: emergencyFund.remaining.isZero && emergencyFund.target.isPositive,
      detail: emergencyFund.remaining.isZero
        ? `${emergencyFund.current.roundedToUnit.format()} de côté, soit ${formatDecimal(emergencyFund.monthsCovered)} mois de dépenses essentielles.`
        : `Il manque ${emergencyFund.remaining.roundedToUnit.format()} pour atteindre ${emergencyFund.target.roundedToUnit.format()}. ` +
          'Sans cette réserve, le moindre imprévu obligerait à vendre au pire moment.',
      blocking: true,
    },
    {
      id: 'noExpensiveDebt',
      label: 'Aucune dette à taux élevé',
      passed: highInterest.length === 0,
      detail:
        highInterest.length === 0
          ? 'Aucune dette au-dessus de 8 % : rien ne prime sur l’investissement de ce côté.'
          : `${highInterestTotal.roundedToUnit.format()} à rembourser en priorité. Rembourser un crédit à ` +
            `${formatDecimal(Math.max(...highInterest.map((debt) => debt.annualRate)) * 100)} % rapporte ce taux, ` +
            'sans risque — aucun placement ne l’égale à coup sûr.',
      blocking: true,
    },
    {
      id: 'positiveCapacity',
      label: 'Capacité d’épargne positive',
      passed: indicativeMonthly.isPositive,
      detail: indicativeMonthly.isPositive
        ? `${indicativeMonthly.roundedToUnit.format()} par mois pourraient être orientés vers un placement.`
        : 'Votre budget ne dégage rien à placer ce mois-ci. Investir à crédit ou en entamant le fonds d’urgence ' +
          'revient à prendre deux risques au lieu d’un.',
      blocking: true,
    },
    {
      id: 'stableIncome',
      label: 'Revenus suffisamment stables',
      passed: !summary.incomeDetail.hasVariableSource || (summary.incomeDetail.volatility ?? 0) < 0.3,
      detail:
        !summary.incomeDetail.hasVariableSource || (summary.incomeDetail.volatility ?? 0) < 0.3
          ? 'Vos revenus sont assez réguliers pour soutenir des versements programmés.'
          : 'Vos revenus varient fortement. Un versement automatique fixe peut devenir intenable un mois creux : ' +
            'un coussin de lissage vient avant.',
      blocking: false,
    },
  ];

  const blocked = checks.some((check) => check.blocking && !check.passed);
  const allPassed = checks.every((check) => check.passed);

  return {
    state: blocked ? 'blocked' : allPassed ? 'ready' : 'partial',
    checks,
    indicativeMonthly: blocked ? Money.zero(profile.currency) : indicativeMonthly,
    assetClasses: ASSET_CLASSES,
    disclaimer: RISK_DISCLAIMER,
  };
}
