import { Money } from '../money';
import { parseDate } from '../yearMonth';
import type { FinancialAnalysis } from './analysis';

/**
 * Alertes destinées aux notifications système (§14).
 *
 * Distinctes des constats de l'accueil : un constat s'affiche quand on ouvre
 * l'application, une alerte interrompt. Le seuil pour interrompre quelqu'un est bien plus
 * haut — seul ce qui appelle une action dans les jours qui viennent y a sa place.
 */

export type AlertKind =
  | 'overdraft'
  | 'upcomingDebit'
  | 'envelopeExceeded'
  | 'goalMilestone'
  | 'emergencyFundMilestone'
  | 'incomeDeclaration'
  | 'monthlyReport';

export interface Alert {
  readonly id: string;
  readonly kind: AlertKind;
  readonly title: string;
  readonly body: string;
}

export interface AlertPreferences {
  readonly upcomingDebits: boolean;
  readonly overdraft: boolean;
  readonly envelopes: boolean;
  /** Franchissement d'un palier d'objectif ou du fonds d'urgence. */
  readonly milestones: boolean;
  readonly monthlyReport: boolean;
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  upcomingDebits: true,
  overdraft: true,
  envelopes: true,
  milestones: true,
  monthlyReport: true,
};

/** Une échéance au-delà de ce montant mérite d'être annoncée ; en deçà, c'est du bruit. */
const SIGNIFICANT_DEBIT = 100;
/** Fenêtre d'anticipation : assez pour approvisionner le compte, pas trop pour être oublié. */
const DEBIT_LOOKAHEAD_DAYS = 3;
/** Paliers d'objectif annoncés. Annoncer chaque pour-cent ferait de l'encouragement un
 *  harcèlement ; ces quatre-là marquent de vraies étapes. */
const GOAL_MILESTONES = [0.25, 0.5, 0.75, 1] as const;

/** Le dernier palier franchi, ou `null` avant le premier quart. */
function lastMilestone(progress: number): number | null {
  let reached: number | null = null;
  for (const milestone of GOAL_MILESTONES) {
    if (progress >= milestone) reached = milestone;
  }
  return reached;
}

export function buildAlerts(
  analysis: FinancialAnalysis,
  preferences: AlertPreferences,
  reference: Date = new Date(),
): Alert[] {
  const alerts: Alert[] = [];
  const currency = analysis.profile.currency;

  if (preferences.overdraft && analysis.cashFlow.projectedOverdraft && analysis.cashFlow.lowestBalanceDate) {
    alerts.push({
      id: 'overdraft',
      kind: 'overdraft',
      title: 'Découvert prévu ce mois-ci',
      body:
        `Le solde descendrait à ${analysis.cashFlow.lowestBalance.roundedToUnit.format()} le ` +
        `${analysis.cashFlow.lowestBalanceDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.`,
    });
  }

  if (preferences.upcomingDebits) {
    const limit = new Date(reference);
    limit.setDate(limit.getDate() + DEBIT_LOOKAHEAD_DAYS);

    const upcoming = analysis.cashFlow.events.filter(
      (event) =>
        event.kind !== 'income' &&
        event.date >= reference &&
        event.date <= limit &&
        event.amount.greaterThanOrEqual(Money.of(SIGNIFICANT_DEBIT, currency)),
    );

    if (upcoming.length > 0) {
      const total = Money.sum(
        upcoming.map((event) => event.amount),
        currency,
      );
      alerts.push({
        id: 'upcomingDebits',
        kind: 'upcomingDebit',
        title: `${total.roundedToUnit.format()} à prélever d’ici ${DEBIT_LOOKAHEAD_DAYS} jours`,
        body: upcoming.map((event) => `${event.label} ${event.amount.roundedToUnit.format()}`).join(' · '),
      });
    }
  }

  if (preferences.envelopes) {
    for (const envelope of analysis.summary.envelopes.envelopes) {
      if (envelope.state !== 'exceeded') continue;
      alerts.push({
        id: `envelope.${envelope.category}`,
        kind: 'envelopeExceeded',
        title: `${envelope.label} : enveloppe dépassée`,
        body:
          `${envelope.spent.roundedToUnit.format()} dépensés sur ${envelope.planned.roundedToUnit.format()} prévus, ` +
          `soit ${envelope.remaining.absolute.roundedToUnit.format()} de trop.`,
      });
    }
  }

  if (preferences.milestones) {
    for (const plan of analysis.goalPlans) {
      const milestone = lastMilestone(plan.progress);
      if (milestone === null) continue;
      alerts.push({
        // Le palier fait partie de l'identifiant : franchir les 50 % puis les 75 %
        // donne deux annonces, mais rester à 52 % n'en redonne pas.
        id: `goal.${plan.goal.id}.${Math.round(milestone * 100)}`,
        kind: 'goalMilestone',
        title:
          milestone >= 1
            ? `Objectif « ${plan.goal.name} » atteint`
            : `« ${plan.goal.name} » : ${Math.round(milestone * 100)} % atteints`,
        body:
          milestone >= 1
            ? `${plan.goal.target.roundedToUnit.format()} réunis.`
            : `${plan.goal.current.roundedToUnit.format()} sur ${plan.goal.target.roundedToUnit.format()}, ` +
              `soit ${plan.remaining.roundedToUnit.format()} restants.`,
      });
    }

    // Le fonds d'urgence se raisonne en mois couverts, pas en pourcentage : « trois mois
    // devant soi » se comprend immédiatement, « 50 % de l'objectif » beaucoup moins.
    const covered = Math.floor(analysis.emergencyFund.monthsCovered);
    if (covered >= 1) {
      alerts.push({
        id: `emergencyFund.${covered}`,
        kind: 'emergencyFundMilestone',
        title: `Fonds d’urgence : ${covered} mois couverts`,
        body:
          `${analysis.emergencyFund.current.roundedToUnit.format()} de côté, pour ` +
          `${analysis.emergencyFund.monthlyNeed.roundedToUnit.format()} de dépenses essentielles par mois.`,
      });
    }
  }

  /*
   * Revenu à déclarer.
   *
   * Passe avant le bilan : sans le montant réellement touché, tous les chiffres du mois
   * reposent sur du vide. C'est la seule alerte qui demande une saisie plutôt que de
   * signaler un état.
   */
  if (analysis.summary.incomeDetail.awaitingDeclaration) {
    const sources = analysis.summary.incomeDetail.sources.filter(
      (entry) => entry.declaredMonthly && entry.actual === null,
    );
    if (sources.length > 0) {
      alerts.push({
        id: `incomeDeclaration.${analysis.period.year}-${analysis.period.month}`,
        kind: 'incomeDeclaration',
        title: 'Combien avez-vous touché ce mois-ci ?',
        body:
          sources.length === 1
            ? `${sources[0]!.source.name} attend son montant exact. Sans lui, le budget du mois n’est qu’une supposition.`
            : `${sources.length} revenus attendent leur montant exact pour ce mois.`,
      });
    }
  }

  // Le bilan du mois écoulé, annoncé une fois, en début de mois.
  if (preferences.monthlyReport && reference.getDate() <= 3) {
    alerts.push({
      id: 'monthlyReport',
      kind: 'monthlyReport',
      title: 'Votre bilan du mois est prêt',
      body: 'Onglet Projections : ce qui a changé par rapport au mois précédent.',
    });
  }

  return alerts;
}

/**
 * Empêche une même alerte d'être répétée.
 *
 * La plupart des alertes décrivent une situation qui dure : elles se taisent pour la
 * journée, puis se rappellent tant que la situation persiste. Un palier, lui, ne se
 * franchit qu'une fois — sa signature ne porte donc pas de date, et l'annonce ne revient
 * jamais.
 */
export function alertSignature(alert: Alert, reference: Date = new Date()): string {
  const permanent = alert.kind === 'goalMilestone' || alert.kind === 'emergencyFundMilestone';
  return permanent ? alert.id : `${alert.id}|${reference.toISOString().slice(0, 10)}`;
}

export function parseISODate(value: string): Date {
  return parseDate(value);
}
