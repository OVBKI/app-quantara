import { Suspense, lazy, useMemo, useState } from 'react';
import { Money, Percent } from '../core/money';
import { VARIABLE_CATEGORY_IDS, categoryColor, categoryLabel, type ExpenseCategoryId } from '../core/categories';
import { availableBalance, totalInvestmentsBalance, type FinancialProfile } from '../core/model';
import { containsDate, daysInMonth, formatDate, formatYearMonth, parseDate, type YearMonth } from '../core/yearMonth';
import { assessHealth, type HealthLevel } from '../core/engine/health';
import { categorize } from '../core/engine/categorizer';
import type { Insight, InsightSeverity } from '../core/engine/insights';
import { useStore } from '../state/store';
import { Card, Field, MoneyInput, ProgressBar, Tile, parseAmount } from './components';
import { SegmentedRing } from './charts';
import { ENVELOPE_STATE_TONE } from '../core/engine/envelopes';

// Les graphiques arrivent après le reste : le solde et les tuiles n'ont pas à attendre
// qu'une bibliothèque de tracé soit téléchargée pour s'afficher.
const HomeCharts = lazy(() => import('./HomeCharts'));

export type HomeTarget = 'advisor' | 'projections' | 'health';

const HEALTH_COLOR: Record<HealthLevel, string> = {
  good: 'var(--positive)',
  watch: 'var(--warning)',
  alert: 'var(--critical)',
};

/** Ce qui est parti vers un compte de placement ce mois-ci. */
function investedThisMonth(profile: FinancialProfile, period: YearMonth): Money {
  const investmentAccounts = new Set(
    profile.accounts.filter((account) => account.kind === 'investment').map((account) => account.id),
  );
  return Money.sum(
    profile.transactions
      .filter(
        (transaction) =>
          transaction.toAccountId !== undefined &&
          investmentAccounts.has(transaction.toAccountId) &&
          containsDate(period, parseDate(transaction.date)),
      )
      .map((transaction) => transaction.amount),
    profile.currency,
  );
}

const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
  positive: 'var(--positive)',
};


export function HomeScreen({ onNavigate }: { onNavigate?: (screen: HomeTarget) => void }) {
  const { profile, analysis, period } = useStore();
  const { summary, cashFlow, emergencyFund, insights } = analysis;

  const available = availableBalance(profile);
  const invested = totalInvestmentsBalance(profile);
  const health = useMemo(() => assessHealth(analysis), [analysis]);

  // Ce qui est réellement sorti ce mois-ci, épargne exclue : mettre de côté n'est pas
  // dépenser, et le confondre ferait paraître dépensier quelqu'un d'économe.
  const spent = summary.fixedExpenses.plus(summary.variableSpentToDate).plus(summary.debtPayments);
  const spentShare = spent.ratioTo(summary.income);
  const investedShare = investedThisMonth(profile, period).ratioTo(summary.income);

  const cashFlowData = useMemo(
    () => cashFlow.points.map((point) => ({ day: point.day, solde: Number(point.balance.units.toFixed(2)) })),
    [cashFlow],
  );

  const categoryData = useMemo(
    () =>
      summary.categoryTotals
        .filter((total) => total.amount.isPositive)
        .slice(0, 12)
        .map((total) => ({
          key: total.category,
          name: categoryLabel(total.category),
          // La couleur vient de la catégorie, jamais de son rang du mois : « Courses »
          // doit rester de la même couleur qu'elle soit première ou quatrième.
          color: categoryColor(total.category),
          value: Number(total.amount.units.toFixed(2)),
          formatted: total.amount.roundedToUnit.format(),
        })),
    [summary],
  );

  // Aucune source déclarée au mois n'a de montant, et aucun historique ne permet de
  // l'estimer : tout chiffre dérivé du revenu serait une invention.
  const awaitingIncome = summary.incomeDetail.sources.some((entry) => entry.unknown);

  /*
   * Trois anneaux, trois questions : où est passé le revenu, ce qui a été mis de côté,
   * ce qui a été placé. Le dégradé qui les parcourt est décoratif — chaque anneau porte
   * une seule série, il n'y a donc aucune identité à confondre.
   *
   * Une part inconnue affiche « — » plutôt qu'un anneau vide : zéro et « pas encore
   * déclaré » ne veulent pas dire la même chose.
   */
  const rings = [
    {
      label: 'Revenu dépensé',
      note: awaitingIncome ? 'Revenu à déclarer' : `${spent.roundedToUnit.format()} ce mois-ci`,
      value: awaitingIncome ? null : spentShare,
      from: 'var(--magenta)',
      to: 'var(--accent)',
    },
    {
      label: 'Revenu épargné',
      note: `${summary.savingsContributions.roundedToUnit.format()} mis de côté`,
      value: awaitingIncome ? null : summary.savingsRate,
      from: 'var(--accent)',
      to: 'var(--cyan)',
    },
    {
      label: 'Revenu placé',
      note: invested.isPositive ? `${invested.roundedToUnit.format()} au total` : 'Aucun placement suivi',
      value: awaitingIncome ? null : investedShare,
      from: 'var(--cyan)',
      to: 'var(--positive)',
    },
    {
      label: 'Charges fixes',
      note: `${summary.fixedExpenses.roundedToUnit.format()} par mois`,
      value: awaitingIncome ? null : summary.fixedRatio,
      from: 'var(--warning)',
      to: 'var(--magenta)',
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Accueil</h1>
          <p className="page-subtitle">{formatYearMonth(period)}</p>
        </div>
      </header>

      <div className="stack">
        <section className="hero">
          <div className="hero-label">Disponible sur vos comptes</div>
          <div className={`hero-value amount ${available.isNegative ? 'critical' : ''}`}>
            {available.roundedToUnit.format()}
          </div>
          {awaitingIncome && (
            <p className="hero-note warning" style={{ marginTop: 12 }}>
              Revenu du mois pas encore déclaré. Les chiffres ci-dessous ne comptent que vos charges.
            </p>
          )}

          <p className="hero-note">
            {profile.accounts.length === 0 ? (
              <>
                Aucun compte enregistré. Ajoutez-en un dans les Réglages pour voir ce solde.
              </>
            ) : summary.daysRemaining > 0 ? (
              <>
                <strong className="amount">{summary.safeToSpendPerDay.roundedToUnit.format()}</strong> par jour
                jusqu’à la fin du mois. Solde prévu le {daysInMonth(period)} :{' '}
                <strong className="amount">{cashFlow.endOfMonthBalance.roundedToUnit.format()}</strong>.
              </>
            ) : (
              <>Le mois est terminé : ce montant est ce qui reste une fois toutes les charges honorées.</>
            )}
          </p>

          <div className="inline" style={{ marginTop: 16 }}>
            <span className="health-light" style={{ background: HEALTH_COLOR[health.level] }} aria-hidden="true" />
            <strong>{health.headline}</strong>
            {onNavigate && (
              <button type="button" className="button button-small" onClick={() => onNavigate('health')}>
                Voir le détail
              </button>
            )}
          </div>

          {onNavigate && (
            <div className="inline" style={{ marginTop: 14 }}>
              <button type="button" className="button button-primary" onClick={() => onNavigate('advisor')}>
                ✨ Optimiser mon budget
              </button>
              <button type="button" className="button" onClick={() => onNavigate('projections')}>
                Voir les projections
              </button>
            </div>
          )}
        </section>

        <QuickExpense />

        <div className="grid grid-4">
          <Tile
            label="Revenus du mois"
            // Un revenu non déclaré vaut « inconnu », pas zéro : afficher 0 € laisserait
            // croire à un mois sans rentrée d'argent, ce qui est une information fausse.
            value={awaitingIncome ? '—' : summary.income.roundedToUnit.format()}
            tone={awaitingIncome ? undefined : 'positive'}
            note={
              awaitingIncome
                ? 'Montant à déclarer'
                : summary.incomeDetail.sources.some((entry) => entry.provisional)
                  ? 'Estimation d’après vos mois déclarés'
                  : summary.incomeDetail.hasVariableSource
                    ? `Fourchette ${summary.incomeDetail.low.formatCompact()} – ${summary.incomeDetail.high.formatCompact()}`
                    : undefined
            }
          />
          <Tile
            label="Dépenses du mois"
            value={spent.roundedToUnit.format()}
            note={spentShare !== null ? `${Percent.format(spentShare, 'fr-FR', 0)} du revenu` : undefined}
          />
          <Tile
            label="Épargne du mois"
            value={summary.savingsContributions.roundedToUnit.format()}
            tone={summary.savingsContributions.isPositive ? 'positive' : undefined}
            note={summary.savingsRate !== null ? `${Percent.format(summary.savingsRate, 'fr-FR', 0)} du revenu` : undefined}
          />
          <Tile
            label="Reste à répartir"
            value={summary.disposable.roundedToUnit.format()}
            tone={summary.disposable.isNegative ? 'critical' : 'positive'}
            note={summary.disposable.isNegative ? 'Le mois est déficitaire' : 'Après toutes les charges'}
          />
        </div>

        <div className="ring-grid">
          {rings.map((ring) => (
            <div className="ring-card" key={ring.label}>
              <SegmentedRing
                value={ring.value ?? 0}
                center={ring.value === null ? '—' : Percent.format(ring.value, 'fr-FR', 0)}
                from={ring.from}
                to={ring.to}
              />
              <div>
                <div className="ring-label">{ring.label}</div>
                <div className="ring-note">{ring.note}</div>
              </div>
            </div>
          ))}
        </div>

        <Suspense fallback={<div className="card empty">Chargement des graphiques…</div>}>
          <HomeCharts
            cashFlowData={cashFlowData}
            categoryData={categoryData}
            currency={summary.currency}
            cashFlow={cashFlow}
            totalFormatted={summary.variableSpentToDate
              .plus(summary.fixedExpenses)
              .roundedToUnit.formatCompact()}
          />
        </Suspense>

        <Card title="Fonds d’urgence">
          <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="amount" style={{ fontSize: 18, fontWeight: 600 }}>
              {emergencyFund.current.roundedToUnit.format()}
              <span className="muted" style={{ fontWeight: 400 }}>
                {' '}
                sur {emergencyFund.target.roundedToUnit.format()}
              </span>
            </span>
            <span className="badge">{emergencyFund.monthsCovered.toFixed(1)} mois couverts</span>
          </div>
          <ProgressBar
            value={emergencyFund.progress}
            tone={emergencyFund.monthsCovered < 1 ? 'var(--warning)' : 'var(--positive)'}
          />
          <p className="rationale">
            Calculé sur vos dépenses essentielles : {emergencyFund.monthlyNeed.roundedToUnit.format()} par mois.
          </p>
        </Card>

        {summary.envelopes.envelopes.length > 0 && (
          <Card title="Enveloppes du mois">
            {summary.envelopes.envelopes.map((envelope) => (
              <div key={envelope.category} style={{ padding: '9px 0' }}>
                <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontWeight: 520 }}>{envelope.label}</span>
                  <span className="amount tile-note">
                    {envelope.spent.roundedToUnit.format()} / {envelope.planned.roundedToUnit.format()}
                  </span>
                </div>
                <ProgressBar value={envelope.consumed} tone={ENVELOPE_STATE_TONE[envelope.state]} />
              </div>
            ))}
            <p className="rationale" style={{ marginTop: 10 }}>
              La couleur compare ce qui est dépensé au temps écoulé dans le mois.
            </p>
          </Card>
        )}

        <Card title="Ce que je remarque">
          {insights.length === 0 ? (
            <p className="muted">Rien à signaler ce mois-ci.</p>
          ) : (
            insights.map((insight) => <InsightRow key={insight.id} insight={insight} />)
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * Saisie rapide d'une dépense, depuis l'accueil (§5).
 *
 * Deux champs et un bouton, sans fenêtre à ouvrir : la friction de saisie est la première
 * cause d'abandon d'une application de budget, et une dépense qu'on note trois jours plus
 * tard est une dépense qu'on ne note pas. La catégorie est devinée depuis le libellé et
 * reste corrigeable — le formulaire complet vit dans l'onglet Transactions.
 */
function QuickExpense() {
  const { profile, addTransaction } = useStore();
  const currency = profile.currency;

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ExpenseCategoryId>('variable.groceries');
  const [guessed, setGuessed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const parsed = parseAmount(amount, currency);

  function onLabelChange(text: string): void {
    setLabel(text);
    if (text.trim().length < 3) return;
    const match = categorize(text, profile.categorizationRules);
    if (match) {
      setCategory(match.category);
      setGuessed(true);
    }
  }

  function submit(): void {
    if (!parsed || !parsed.isPositive) return;
    addTransaction({
      amount: parsed,
      date: formatDate(new Date()),
      kind: 'expense',
      label: label.trim() || categoryLabel(category),
      category,
    });
    setSaved(`${parsed.roundedTo(2).format()} · ${categoryLabel(category)}`);
    setAmount('');
    setLabel('');
    setGuessed(false);
  }

  return (
    <Card title="Noter une dépense">
      <div className="field-row" style={{ alignItems: 'end' }}>
        <Field label="Montant">
          {() => (
            <MoneyInput
              id="quick-expense-amount"
              value={amount}
              currency={currency}
              onChange={setAmount}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          )}
        </Field>
        <Field label="Libellé">
          {(id) => (
            <input
              id={id}
              value={label}
              onChange={(event) => onLabelChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              placeholder="Courses"
            />
          )}
        </Field>
        <Field label="Catégorie" hint={guessed ? 'Devinée depuis le libellé' : undefined}>
          {(id) => (
            <select
              id={id}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as ExpenseCategoryId);
                setGuessed(false);
              }}
            >
              {VARIABLE_CATEGORY_IDS.map((entry) => (
                <option key={entry} value={entry}>
                  {categoryLabel(entry)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field">
          <button
            type="button"
            className="button button-primary"
            disabled={!parsed || !parsed.isPositive}
            onClick={submit}
          >
            Ajouter
          </button>
        </div>
      </div>
      {saved && (
        <p className="rationale" style={{ marginTop: 2 }} role="status">
          Enregistré : {saved}. Modifiable dans l’onglet Transactions.
        </p>
      )}
    </Card>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  return (
    <div className="insight">
      <span className="insight-dot" style={{ background: SEVERITY_COLOR[insight.severity] }} />
      <div>
        <div className="insight-title">{insight.title}</div>
        <div className="insight-message">{insight.message}</div>
      </div>
    </div>
  );
}
