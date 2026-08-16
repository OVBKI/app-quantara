import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Money, Percent } from '../core/money';
import { VARIABLE_CATEGORY_IDS, categoryColor, categoryLabel, type ExpenseCategoryId } from '../core/categories';
import { availableBalance, totalInvestmentsBalance, type FinancialProfile } from '../core/model';
import { containsDate, daysInMonth, formatDate, formatYearMonth, parseDate, type YearMonth } from '../core/yearMonth';
import { assessHealth, type HealthLevel } from '../core/engine/health';
import { categorize } from '../core/engine/categorizer';
import type { Insight, InsightSeverity } from '../core/engine/insights';
import { useStore } from '../state/store';
import { Card, Field, MoneyInput, ProgressBar, Tile, parseAmount } from './components';
import { ENVELOPE_STATE_TONE } from '../core/engine/envelopes';

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
        .slice(0, 8)
        .map((total) => ({
          name: categoryLabel(total.category),
          // La couleur vient de la catégorie, jamais de son rang du mois : « Courses »
          // doit rester de la même couleur qu'elle soit première ou quatrième.
          color: categoryColor(total.category),
          value: Number(total.amount.units.toFixed(2)),
        })),
    [summary],
  );

  const overspending = summary.disposable.isNegative;

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
          <p className="hero-note">
            {profile.accounts.length === 0 ? (
              <>
                Aucun compte enregistré. Ajoutez-en un dans les Réglages : c’est ce solde qui répond à la
                première question — combien ai-je, maintenant.
              </>
            ) : summary.daysRemaining > 0 ? (
              <>
                Soit <strong className="amount">{summary.safeToSpendPerDay.roundedToUnit.format()}</strong> par
                jour jusqu’à la fin du mois, une fois provisionnées les échéances à venir. Solde prévu au{' '}
                {daysInMonth(period)} :{' '}
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
            value={summary.income.roundedToUnit.format()}
            tone="positive"
            note={
              summary.incomeDetail.hasVariableSource
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
            label="Placé"
            value={invested.roundedToUnit.format()}
            note={investedShare !== null ? `${Percent.format(investedShare, 'fr-FR', 0)} du revenu ce mois-ci` : 'Aucun placement suivi'}
          />
        </div>

        <div className="grid grid-3">
          <Tile
            label="Charges fixes"
            value={summary.fixedExpenses.roundedToUnit.format()}
            note={summary.fixedRatio !== null ? `${Percent.format(summary.fixedRatio, 'fr-FR', 0)} du revenu` : undefined}
          />
          <Tile
            label="Dépenses variables prévues"
            value={summary.variableReserved.roundedToUnit.format()}
            note={
              summary.variablePlanned.isPositive
                ? `${summary.envelopes.totalSpent.roundedToUnit.format()} dépensés sur ${summary.variablePlanned.roundedToUnit.format()} d’enveloppes`
                : summary.variableProjectionMethod === 'runRate'
                  ? `Projeté d’après ${summary.variableSpentToDate.roundedToUnit.format()} en ${summary.daysElapsed} jours`
                  : summary.variableProjectionMethod === 'history'
                    ? 'Estimé d’après les mois précédents'
                    : 'Constaté'
            }
          />
          <Tile
            label="Reste à répartir"
            value={summary.disposable.roundedToUnit.format()}
            tone={overspending ? 'critical' : 'positive'}
            note={overspending ? 'Le mois est déficitaire' : 'Après toutes les charges du mois'}
          />
        </div>

        <div className="grid grid-2">
          <Card title="Trésorerie du mois">
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashFlowData} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="soldeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" stroke="var(--text-tertiary)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--text-tertiary)" fontSize={11} tickLine={false} width={62} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                    }}
                    labelFormatter={(day) => `Jour ${day}`}
                    formatter={(value) => [`${Number(value ?? 0).toLocaleString('fr-FR')} ${summary.currency}`, 'Solde']}
                  />
                  <Area
                    type="monotone"
                    dataKey="solde"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#soldeFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="rationale">
              {cashFlow.projectedOverdraft && cashFlow.lowestBalanceDate ? (
                <span className="critical">
                  Creux à {cashFlow.lowestBalance.roundedToUnit.format()} le{' '}
                  {cashFlow.lowestBalanceDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} :
                  c’est ce point bas qui provoque un découvert, pas le solde de fin de mois.
                </span>
              ) : (
                <>
                  Point bas prévu : {cashFlow.lowestBalance.roundedToUnit.format()}. Le solde tient compte des
                  échéances à leur date réelle, pas d’une moyenne mensuelle.
                </>
              )}
            </p>
          </Card>

          <Card title="Répartition des dépenses">
            {categoryData.length === 0 ? (
              <p className="muted">Aucune dépense enregistrée pour ce mois.</p>
            ) : (
              <>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={88}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {categoryData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface-raised)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          color: 'var(--text)',
                        }}
                        formatter={(value) => `${Number(value ?? 0).toLocaleString('fr-FR')} ${summary.currency}`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="legend">
                  {categoryData.map((entry) => (
                    <span className="legend-item" key={entry.name}>
                      <span className="legend-swatch" style={{ background: entry.color }} />
                      {entry.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

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
            La cible se calcule sur vos dépenses <strong>essentielles</strong> (
            {emergencyFund.monthlyNeed.roundedToUnit.format()} par mois), pas sur votre train de vie complet :
            en cas de coup dur, les loisirs s’arrêtent, le loyer non.
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
              La couleur compare la part consommée à la part du mois écoulée : dépenser 60 % de son budget
              courses n’a pas le même sens le 5 et le 25.
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
          {(id) => (
            <MoneyInput
              id={id}
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
