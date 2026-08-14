import { Money, Percent } from '../money';
import { categoryLabel } from '../categories';
import { activeDebts, type FinancialProfile } from '../model';
import { formatYearMonth } from '../yearMonth';
import type { FinancialAnalysis } from '../engine/analysis';
import { optimize } from '../engine/optimization';
import { canIAfford } from '../engine/affordability';
import { RISK_DISCLAIMER, monthsToReach, project } from '../engine/simulation';

/**
 * Assistant financier.
 *
 * Entièrement déterministe et local : chaque phrase produite ici est construite à partir
 * d'un montant calculé par les moteurs, jamais inventée. C'est la garantie que le
 * cahier des charges demandait — « ne jamais inventer de données financières » — obtenue
 * par construction plutôt que par consigne.
 *
 * Conséquence assumée : l'assistant ne répond qu'aux questions qu'il sait traiter, et le
 * dit franchement quand ce n'est pas le cas. Mieux vaut un « je ne sais pas » qu'une
 * réponse plausible et fausse sur l'argent de quelqu'un.
 */

export interface AnswerFigure {
  readonly label: string;
  readonly value: string;
}

export interface AdvisorAnswer {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly figures: readonly AnswerFigure[];
  /** Hypothèses retenues et données manquantes — énoncées, jamais tues. */
  readonly caveats: readonly string[];
}

export interface SuggestedQuestion {
  readonly id: string;
  readonly label: string;
}

export const SUGGESTED_QUESTIONS: readonly SuggestedQuestion[] = [
  { id: 'where', label: 'Où part mon argent ?' },
  { id: 'save', label: 'Combien puis-je épargner ce mois-ci ?' },
  { id: 'emergency', label: 'Quand mon fonds d’urgence sera-t-il complet ?' },
  { id: 'reduce', label: 'Comment réduire mes dépenses ?' },
  { id: 'health', label: 'Mon budget est-il sain ?' },
  { id: 'debt', label: 'Quand serai-je débarrassé de mes dettes ?' },
  { id: 'afford', label: 'Puis-je me permettre une dépense de 500 € ?' },
  { id: 'grow', label: 'Que deviendraient 200 € par mois pendant 10 ans ?' },
  { id: 'income', label: 'Comment gérer un revenu irrégulier ?' },
  { id: 'trading', label: 'Mon activité de trading est-elle rentable ?' },
];

interface Intent {
  readonly id: string;
  readonly keywords: readonly string[];
}

const INTENTS: readonly Intent[] = [
  { id: 'where', keywords: ['ou part', 'où part', 'reparti', 'réparti', 'depense le plus', 'dépense le plus', 'poste'] },
  { id: 'save', keywords: ['epargner', 'épargner', 'mettre de cote', 'mettre de côté', 'capacite', 'capacité'] },
  { id: 'emergency', keywords: ['urgence', 'matelas', 'securite', 'sécurité', 'reserve', 'réserve'] },
  { id: 'reduce', keywords: ['reduire', 'réduire', 'economiser', 'économiser', 'optimiser', 'moins depenser'] },
  { id: 'health', keywords: ['sain', 'sante', 'santé', 'situation', 'bilan', 'ca va', 'ça va'] },
  { id: 'debt', keywords: ['dette', 'credit', 'crédit', 'rembourser', 'emprunt'] },
  { id: 'afford', keywords: ['permettre', 'acheter', 'puis-je', 'peux-je', 'peux je', 'abordable'] },
  { id: 'grow', keywords: ['placer', 'investir', 'devenir', 'deviendrai', 'rendement', 'interet', 'intérêt', 'dans 10 ans'] },
  { id: 'income', keywords: ['irregulier', 'irrégulier', 'variable', 'fluctue', 'varie', 'freelance', 'pas fixe', 'salaire varie'] },
  { id: 'trading', keywords: ['trading', 'trader', 'propfirm', 'prop firm', 'compte finance', 'compte financé', 'challenge', 'payout', 'versement'] },
];

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Premier montant cité dans la question — « puis-je me permettre 1 200 € ? ». */
function extractAmount(question: string): number | null {
  const match = /(\d[\d\s  ]*(?:[.,]\d{1,2})?)/.exec(question.replace(/\s/g, ' '));
  if (!match) return null;
  const value = Number(match[1]!.replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Nombre d'années cité — « pendant 10 ans ». */
function extractYears(question: string): number | null {
  const match = /(\d{1,2})\s*(ans?|annees?|années?)/.exec(normalise(question));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function detectIntent(question: string): string | null {
  const text = normalise(question);
  for (const intent of INTENTS) {
    if (intent.keywords.some((keyword) => text.includes(normalise(keyword)))) return intent.id;
  }
  return null;
}

/** Ce qui manque pour que la réponse soit fiable. Signalé, jamais deviné. */
export function missingData(profile: FinancialProfile, analysis: FinancialAnalysis): string[] {
  const gaps: string[] = [];
  if (profile.incomes.length === 0) gaps.push('Aucun revenu déclaré : tous les ratios sont incalculables.');
  if (profile.accounts.length === 0) {
    gaps.push('Aucun solde de compte renseigné : la projection de trésorerie part de zéro et ne détecte pas un découvert réel.');
  }
  if (profile.recurringExpenses.length === 0) gaps.push('Aucune charge récurrente : le disponible est surestimé.');
  if (analysis.summary.essentialExpenses.isZero) {
    gaps.push('Aucune dépense essentielle identifiée : le fonds d’urgence ne peut pas être dimensionné.');
  }
  if (profile.transactions.length < 10) {
    gaps.push('Moins de dix transactions enregistrées : la projection des dépenses variables reste grossière.');
  }
  return gaps;
}

export function ask(question: string, analysis: FinancialAnalysis): AdvisorAnswer {
  const intent = detectIntent(question);
  const profile = analysis.profile;
  const gaps = missingData(profile, analysis);

  switch (intent) {
    case 'where':
      return whereDoesMoneyGo(analysis, gaps);
    case 'save':
      return howMuchCanISave(analysis, gaps);
    case 'emergency':
      return emergencyFundAnswer(analysis, gaps);
    case 'reduce':
      return howToReduce(analysis, gaps);
    case 'health':
      return budgetHealth(analysis, gaps);
    case 'debt':
      return debtAnswer(analysis, gaps);
    case 'afford':
      return affordAnswer(question, analysis, gaps);
    case 'grow':
      return growAnswer(question, analysis, gaps);
    case 'income':
      return volatileIncomeAnswer(analysis, gaps);
    case 'trading':
      return tradingAnswer(analysis, gaps);
    default:
      return fallback(analysis);
  }
}

export function answerFor(id: string, analysis: FinancialAnalysis): AdvisorAnswer {
  const question = SUGGESTED_QUESTIONS.find((entry) => entry.id === id)?.label ?? '';
  return ask(question, analysis);
}

// --- Réponses ---

function whereDoesMoneyGo(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const { summary } = analysis;
  const top = summary.categoryTotals.slice(0, 5);

  if (top.length === 0) {
    return {
      title: 'Aucune dépense enregistrée ce mois-ci',
      paragraphs: ['Ajoutez vos charges récurrentes et vos transactions pour que je puisse répondre.'],
      figures: [],
      caveats,
    };
  }

  return {
    title: `Vos dépenses de ${formatYearMonth(summary.period)}`,
    paragraphs: [
      `Sur ${summary.totalExpenses.roundedToUnit.format()} de dépenses, ` +
        `${top[0]!.amount.roundedToUnit.format()} partent en ${categoryLabel(top[0]!.category).toLowerCase()} — ` +
        `${Percent.format(top[0]!.share, 'fr-FR', 0)} du total.`,
      `Vos charges fixes représentent ${summary.fixedExpenses.roundedToUnit.format()}, soit ` +
        `${Percent.format(summary.fixedRatio, 'fr-FR', 0)} de vos revenus. C’est la part sur laquelle vous ne ` +
        'pouvez pas agir d’un mois à l’autre.',
    ],
    figures: top.map((total) => ({
      label: categoryLabel(total.category),
      value: `${total.amount.roundedToUnit.format()} · ${Percent.format(total.share, 'fr-FR', 0)}`,
    })),
    caveats,
  };
}

function howMuchCanISave(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const { summary, capacity, profile } = analysis;
  const freeShare = profile.preferences.minimumFreeShare;

  if (summary.disposable.isNegative) {
    return {
      title: 'Rien ce mois-ci — votre budget est déficitaire',
      paragraphs: [
        `Vos charges (${summary.totalExpenses.roundedToUnit.format()}) dépassent vos revenus ` +
          `(${summary.income.roundedToUnit.format()}) de ${summary.disposable.absolute.roundedToUnit.format()}. ` +
          'Épargner dans cette situation reviendrait à creuser le découvert.',
        'La priorité est de ramener les charges sous les revenus. Demandez-moi comment réduire vos dépenses.',
      ],
      figures: [
        { label: 'Revenus', value: summary.income.roundedToUnit.format() },
        { label: 'Charges', value: summary.totalExpenses.roundedToUnit.format() },
        { label: 'Écart', value: summary.disposable.roundedToUnit.format() },
      ],
      caveats,
    };
  }

  return {
    title: `${capacity.roundedToUnit.format()} par mois`,
    paragraphs: [
      `Après vos charges fixes (${summary.fixedExpenses.roundedToUnit.format()}), vos remboursements ` +
        `(${summary.debtPayments.roundedToUnit.format()}) et vos dépenses variables projetées ` +
        `(${summary.variableProjected.roundedToUnit.format()}), il reste ` +
        `${summary.disposable.roundedToUnit.format()}.`,
      `Je ne propose pas d’épargner la totalité : ${Math.round(freeShare * 100)} % restent libres, ` +
        'sans quoi le plan casse au premier imprévu et cesse d’être suivi. D’où les ' +
        `${capacity.roundedToUnit.format()} annoncés.`,
    ],
    figures: [
      { label: 'Disponible', value: summary.disposable.roundedToUnit.format() },
      { label: 'Part laissée libre', value: `${Math.round(freeShare * 100)} %` },
      { label: 'Capacité d’épargne', value: capacity.roundedToUnit.format() },
    ],
    caveats,
  };
}

function emergencyFundAnswer(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const { emergencyFund, capacity } = analysis;

  if (emergencyFund.remaining.isZero && emergencyFund.target.isPositive) {
    return {
      title: 'Il est déjà complet',
      paragraphs: [
        `${emergencyFund.current.roundedToUnit.format()} de côté couvrent ` +
          `${emergencyFund.monthsCovered.toFixed(1)} mois de dépenses essentielles. ` +
          'Le surplus peut désormais aller vers vos objectifs de long terme.',
      ],
      figures: [
        { label: 'Épargne', value: emergencyFund.current.roundedToUnit.format() },
        { label: 'Cible', value: emergencyFund.target.roundedToUnit.format() },
      ],
      caveats,
    };
  }

  const months = emergencyFund.monthsToTarget;

  return {
    title:
      months === null
        ? 'Impossible à dater : votre capacité d’épargne est nulle'
        : `Dans ${months} mois au rythme actuel`,
    paragraphs: [
      `Il manque ${emergencyFund.remaining.roundedToUnit.format()} pour atteindre ` +
        `${emergencyFund.target.roundedToUnit.format()}, soit ` +
        `${analysis.profile.preferences.emergencyFundMonths} mois de dépenses essentielles ` +
        `(${emergencyFund.monthlyNeed.roundedToUnit.format()} par mois).`,
      months === null
        ? 'Sans capacité d’épargne, aucune date ne peut être avancée. Réduire une charge, même de 50 €, remet le compteur en marche.'
        : `À ${capacity.roundedToUnit.format()} par mois, la cible est atteinte en ${months} mois. ` +
          'Cette date suppose que vos revenus et vos charges restent stables.',
    ],
    figures: [
      { label: 'Actuel', value: emergencyFund.current.roundedToUnit.format() },
      { label: 'Restant', value: emergencyFund.remaining.roundedToUnit.format() },
      { label: 'Couverture', value: `${emergencyFund.monthsCovered.toFixed(1)} mois` },
    ],
    caveats,
  };
}

function howToReduce(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const result = optimize(analysis.profile, analysis.summary, analysis.period, analysis.reference);
  const top = result.suggestions.filter((entry) => entry.monthlySaving.isPositive).slice(0, 3);

  if (top.length === 0) {
    return {
      title: 'Je ne vois pas de piste chiffrable',
      paragraphs: [
        'Aucune de vos catégories ne s’écarte nettement de vos habitudes, et vos abonnements ne pèsent pas ' +
          'assez pour valoir un arbitrage. C’est plutôt bon signe.',
        result.historyMonths < 3
          ? 'Cela dit, je manque d’historique : avec trois mois de données, la comparaison devient bien plus fiable.'
          : 'Si vous cherchez malgré tout à dégager davantage, l’effort portera sur des postes essentiels, avec un vrai coût en confort.',
      ],
      figures: [],
      caveats,
    };
  }

  return {
    title: `${result.totalMonthly.roundedToUnit.format()} par mois, soit ${result.totalAnnual.roundedToUnit.format()} par an`,
    paragraphs: [
      'Voici les pistes les plus rentables, comparées à vos propres habitudes plutôt qu’à une moyenne nationale :',
      ...top.map((entry) => `${entry.title} — ${entry.detail}`),
    ],
    figures: top.map((entry) => ({
      label: entry.title.split(' :')[0] ?? entry.title,
      value: `${entry.monthlySaving.roundedToUnit.format()} /mois`,
    })),
    caveats: [
      ...caveats,
      'Ces montants supposent que vous suiviez chaque piste jusqu’au bout. Ce sont des ordres de grandeur, pas des économies acquises.',
    ],
  };
}

function budgetHealth(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const { summary, emergencyFund } = analysis;
  const signals: string[] = [];

  if (summary.fixedRatio !== null) {
    signals.push(
      summary.fixedRatio > 0.5
        ? `Vos charges fixes absorbent ${Percent.format(summary.fixedRatio, 'fr-FR', 0)} de vos revenus : au-delà de la moitié, la marge de manœuvre devient très faible.`
        : `Vos charges fixes représentent ${Percent.format(summary.fixedRatio, 'fr-FR', 0)} de vos revenus, ce qui laisse de la marge.`,
    );
  }

  const debtRatio = summary.debtPayments.ratioTo(summary.income);
  if (debtRatio !== null && debtRatio > 0) {
    signals.push(
      debtRatio > 0.33
        ? `Vos remboursements pèsent ${Percent.format(debtRatio, 'fr-FR', 0)} du revenu, au-dessus du tiers considéré comme seuil d’alerte.`
        : `Vos remboursements pèsent ${Percent.format(debtRatio, 'fr-FR', 0)} du revenu, sous le seuil d’alerte du tiers.`,
    );
  }

  signals.push(
    emergencyFund.monthsCovered < 1
      ? `Votre épargne couvre ${emergencyFund.monthsCovered.toFixed(1)} mois de dépenses essentielles. C’est le point faible principal.`
      : `Votre épargne couvre ${emergencyFund.monthsCovered.toFixed(1)} mois de dépenses essentielles.`,
  );

  if (summary.savingsRate !== null) {
    signals.push(`Votre taux d’épargne du mois s’établit à ${Percent.format(summary.savingsRate, 'fr-FR', 0)}.`);
  }

  const critical = analysis.insights.filter((insight) => insight.severity === 'critical').length;

  return {
    title:
      critical > 0
        ? 'Des points demandent une action rapide'
        : summary.disposable.isPositive
          ? 'Votre budget est équilibré'
          : 'Votre budget est tendu',
    paragraphs: signals,
    figures: [
      { label: 'Revenus', value: summary.income.roundedToUnit.format() },
      { label: 'Charges', value: summary.totalExpenses.roundedToUnit.format() },
      { label: 'Disponible', value: summary.disposable.roundedToUnit.format() },
    ],
    caveats,
  };
}

function debtAnswer(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const debts = activeDebts(analysis.profile);
  const plan = analysis.debtPlan;

  if (debts.length === 0) {
    return {
      title: 'Vous n’avez aucune dette enregistrée',
      paragraphs: ['Si vous en avez une, ajoutez-la dans les réglages : elle change l’ordre des priorités du plan.'],
      figures: [],
      caveats,
    };
  }

  if (plan.totalMonths === null) {
    return {
      title: 'Aux mensualités actuelles, une dette ne se rembourse jamais',
      paragraphs: [
        'Pour au moins une de vos dettes, les intérêts mensuels dépassent la mensualité : le capital ne baisse pas, il augmente.',
        'Augmenter la mensualité, même modestement, est la seule issue — ou renégocier le taux.',
      ],
      figures: debts.map((debt) => ({
        label: debt.name,
        value: `${debt.outstanding.roundedToUnit.format()} à ${(debt.annualRate * 100).toFixed(1)} %`,
      })),
      caveats,
    };
  }

  return {
    title: `Dans ${plan.totalMonths} mois`,
    paragraphs: [
      `En remboursant d’abord ${plan.steps[0]?.debt.name ?? 'la dette au taux le plus élevé'} puis en réaffectant ` +
        'chaque mensualité libérée à la suivante, tout est soldé en ' +
        `${plan.totalMonths} mois.`,
      `Cette réaffectation vous fait économiser ${plan.interestSaved.roundedToUnit.format()} d’intérêts ` +
        'par rapport au paiement minimum sans réaffectation.',
    ],
    figures: plan.steps.map((step) => ({
      label: `${step.order}. ${step.debt.name}`,
      value: step.monthsToPayoff === null ? 'non soldée' : `${step.monthsToPayoff} mois`,
    })),
    caveats: [...caveats, 'Le calendrier suppose des mensualités constantes et aucun nouvel emprunt.'],
  };
}

function affordAnswer(question: string, analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const value = extractAmount(question);
  if (value === null) {
    return {
      title: 'Quel montant ?',
      paragraphs: ['Précisez une somme — par exemple « puis-je me permettre 500 € ? » — et je regarde l’effet sur votre mois.'],
      figures: [],
      caveats,
    };
  }

  const amount = Money.of(value, analysis.profile.currency);
  const answer = canIAfford(amount, analysis.summary, analysis.emergencyFund, analysis.cashFlow, analysis.capacity);

  return {
    title: answer.headline,
    paragraphs: [...answer.reasons],
    figures: [
      { label: 'Montant', value: amount.roundedToUnit.format() },
      { label: 'Restant après', value: answer.remainingAfter.roundedToUnit.format() },
      ...(answer.monthsToSaveFor !== null
        ? [{ label: 'À épargner en', value: `${answer.monthsToSaveFor} mois` }]
        : []),
    ],
    caveats,
  };
}

function growAnswer(question: string, analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const amount = extractAmount(question);
  const years = extractYears(question) ?? 10;
  const monthly = Money.of(amount ?? analysis.capacity.roundedToUnit.units, analysis.profile.currency);
  const months = years * 12;
  const currency = analysis.profile.currency;

  const prudent = project(monthly, Money.zero(currency), 0.02, months, currency);
  const middle = project(monthly, Money.zero(currency), 0.04, months, currency);
  const dynamic = project(monthly, Money.zero(currency), 0.07, months, currency);

  return {
    title: `Entre ${prudent.finalAmount.roundedToUnit.format()} et ${dynamic.finalAmount.roundedToUnit.format()} après ${years} ans`,
    paragraphs: [
      `${monthly.roundedToUnit.format()} par mois pendant ${years} ans représentent ` +
        `${middle.totalContributed.roundedToUnit.format()} de versements. Le reste vient des intérêts composés.`,
      `Dans l’hypothèse intermédiaire de 4 % par an, vous obtiendriez ` +
        `${middle.finalAmount.roundedToUnit.format()}, dont ${middle.totalInterest.roundedToUnit.format()} ` +
        'd’intérêts. L’écart entre les trois hypothèses est considérable : c’est cet écart, et non la valeur ' +
        'centrale, qui doit guider une décision.',
      `Avant d’envisager un placement, deux conditions : un fonds d’urgence complet ` +
        `(${analysis.emergencyFund.remaining.isZero ? 'c’est votre cas' : `il vous manque ${analysis.emergencyFund.remaining.roundedToUnit.format()}`}) ` +
        'et aucune dette à taux élevé. Un placement se liquide mal, souvent à perte, quand on en a un besoin urgent.',
    ],
    figures: [
      { label: 'Prudent (2 %)', value: prudent.finalAmount.roundedToUnit.format() },
      { label: 'Intermédiaire (4 %)', value: middle.finalAmount.roundedToUnit.format() },
      { label: 'Dynamique (7 %)', value: dynamic.finalAmount.roundedToUnit.format() },
      { label: 'Versé au total', value: middle.totalContributed.roundedToUnit.format() },
    ],
    caveats: [...caveats, RISK_DISCLAIMER],
  };
}

function volatileIncomeAnswer(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const detail = analysis.summary.incomeDetail;

  if (!detail.hasVariableSource) {
    return {
      title: 'Vos revenus sont déclarés comme fixes',
      paragraphs: [
        'Si ce n’est pas le cas, cochez « revenu irrégulier » sur la source concernée dans l’écran Budget, et ' +
          'indiquez votre mois faible et votre mois fort. Le plan se calera alors sur le bas de la fourchette.',
      ],
      figures: [{ label: 'Revenu mensuel', value: detail.typical.roundedToUnit.format() }],
      caveats,
    };
  }

  return {
    title: `Planifier sur ${detail.low.roundedToUnit.format()}, pas sur ${detail.high.roundedToUnit.format()}`,
    paragraphs: [
      `Vos revenus vont de ${detail.low.roundedToUnit.format()} à ${detail.high.roundedToUnit.format()}, ` +
        `autour d’un mois typique à ${detail.typical.roundedToUnit.format()}. ` +
        (detail.sources.some((source) => source.historyMonths >= 3)
          ? 'Cette fourchette vient de vos mois réellement encaissés, pas d’une estimation.'
          : 'Cette fourchette vient de ce que vous avez déclaré ; elle s’affinera dès trois mois de revenus saisis.'),
      'La règle est simple : engagez-vous sur le mois faible. Un loyer, un crédit ou un abonnement pris au ' +
        'niveau du mois fort devient intenable dès le premier creux, alors qu’un plan calé sur le bas transforme ' +
        'les bons mois en surplus — une bonne nouvelle plutôt qu’un rattrapage.',
      `Un compte tampon d’environ ${analysis.smoothingBuffer.roundedToUnit.format()} absorberait trois mois ` +
        'creux : les bons mois y déposent l’excédent, les mauvais y puisent. Il ne remplace pas le fonds ' +
        'd’urgence, qui couvre les accidents ; il couvre l’irrégularité, ce qui n’est pas la même chose.',
    ],
    figures: [
      { label: 'Mois faible', value: detail.low.roundedToUnit.format() },
      { label: 'Mois typique', value: detail.typical.roundedToUnit.format() },
      { label: 'Mois fort', value: detail.high.roundedToUnit.format() },
      { label: 'Tampon conseillé', value: analysis.smoothingBuffer.roundedToUnit.format() },
    ],
    caveats,
  };
}

/**
 * Rentabilité réelle de l'activité de trading.
 *
 * La question tient en une soustraction que peu de gens font : versements encaissés moins
 * épreuves payées. Les versements se retiennent, les frais s'oublient — et c'est ce qui
 * fait qu'une activité déficitaire peut sembler rentable pendant des mois.
 */
function tradingAnswer(analysis: FinancialAnalysis, caveats: string[]): AdvisorAnswer {
  const trading = analysis.summary.trading;

  if (!trading || trading.attemptsStarted === 0) {
    return {
      title: 'Aucun compte de trading enregistré',
      paragraphs: [
        'Ajoutez vos comptes dans l’onglet Trading — le prix de chaque épreuve, sa phase, et les versements ' +
          'reçus. Je pourrai alors vous dire ce que l’activité rapporte réellement, frais compris.',
      ],
      figures: [],
      caveats,
    };
  }

  const net = trading.lifetimeNet;

  return {
    title: net.isNegative
      ? `Non : ${net.roundedToUnit.format()} depuis le début`
      : `Oui : +${net.roundedToUnit.format()} depuis le début`,
    paragraphs: [
      `${trading.lifetimePayouts.roundedToUnit.format()} de versements encaissés, ` +
        `${trading.lifetimeFees.roundedToUnit.format()} d’épreuves payées sur ${trading.attemptsStarted} ` +
        `tentative${trading.attemptsStarted > 1 ? 's' : ''}. La différence est le seul chiffre qui répond à ` +
        'la question — les versements seuls ne la posent même pas.',
      trading.passRate !== null
        ? `${trading.fundedAccounts} compte${trading.fundedAccounts > 1 ? 's' : ''} financé${trading.fundedAccounts > 1 ? 's' : ''} ` +
          `sur ${trading.fundedAccounts + trading.failedAccounts} épreuves terminées, soit ` +
          `${Percent.format(trading.passRate, 'fr-FR', 0)} de réussite.` +
          (trading.costPerFundedAccount
            ? ` Chaque compte financé revient à ${trading.costPerFundedAccount.roundedToUnit.format()}, échecs compris.`
            : '')
        : 'Aucune épreuve terminée pour l’instant : le taux de réussite n’est pas encore calculable.',
      trading.payouts.monthsWithPayout > 0
        ? `Sur les douze derniers mois, ${trading.payouts.monthsWithPayout} ` +
          `${trading.payouts.monthsWithPayout > 1 ? 'ont' : 'a'} donné lieu à un versement, ` +
          `d’un montant médian de ${trading.payouts.median.roundedToUnit.format()}. Votre plus longue série ` +
          `sans versement a duré ${trading.payouts.longestDrySpell} mois — c’est la durée que vos charges ` +
          'fixes doivent pouvoir traverser sans cette rentrée.'
        : 'Aucun versement reçu sur les douze derniers mois.',
      `Les ${trading.allocatedCapital.roundedToUnit.format()} de capital géré n’entrent dans aucun calcul de ` +
        'patrimoine ici : c’est un mandat révocable, pas un avoir. Votre exposition financière se limite au ' +
        'prix des épreuves.',
    ],
    figures: [
      { label: 'Versements reçus', value: trading.lifetimePayouts.roundedToUnit.format() },
      { label: 'Épreuves payées', value: trading.lifetimeFees.roundedToUnit.format() },
      { label: 'Net', value: net.roundedToUnit.format() },
      {
        label: 'Retenu au budget',
        value: analysis.summary.incomeDetail.trading?.planned.roundedToUnit.format() ?? '—',
      },
    ],
    caveats: [
      ...caveats,
      analysis.summary.incomeDetail.trading?.plannable
        ? 'Le budget retient le premier quintile de vos versements, mois sans versement compris.'
        : 'Le budget ne compte aucun revenu de trading tant que six mois de versements n’ont pas été observés. ' +
          'Un compte financé se perd sur une seule séance : y adosser une charge fixe, c’est risquer de devoir ' +
          'la payer un mois où le compte n’existe plus.',
      'Je ne formule aucune recommandation sur votre stratégie ni sur les marchés : je compte ce que vous avez ' +
        'saisi, rien de plus.',
    ],
  };
}

function fallback(analysis: FinancialAnalysis): AdvisorAnswer {
  return {
    title: 'Je ne sais pas répondre à cette question',
    paragraphs: [
      'Je ne réponds qu’à partir de vos chiffres, calculés par les moteurs de l’application. Quand une question ' +
        'sort de ce périmètre, je préfère le dire plutôt que produire une réponse plausible et fausse.',
      'Voici ce que je sais traiter : la répartition de vos dépenses, votre capacité d’épargne, votre fonds ' +
        'd’urgence, les pistes de réduction, la santé de votre budget, vos dettes, une dépense envisagée, ' +
        'la gestion d’un revenu irrégulier, la rentabilité réelle de votre activité de trading, et l’effet ' +
        'du temps sur une épargne régulière.',
    ],
    figures: [
      { label: 'Disponible ce mois-ci', value: analysis.summary.disposable.roundedToUnit.format() },
      { label: 'Capacité d’épargne', value: analysis.capacity.roundedToUnit.format() },
    ],
    caveats: [],
  };
}

export { monthsToReach };
