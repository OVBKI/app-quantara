import { useMemo } from 'react';
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
import { Percent } from '../core/money';
import { categoryLabel } from '../core/categories';
import { formatYearMonth } from '../core/yearMonth';
import type { Insight, InsightSeverity } from '../core/engine/insights';
import { useStore } from '../state/store';
import { Card, ProgressBar, Tile } from './components';
import { ENVELOPE_STATE_TONE } from '../core/engine/envelopes';

const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  critical: 'var(--critical)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
  positive: 'var(--positive)',
};

const CHART_COLORS = [
  '#4c9aff',
  '#a371f7',
  '#3fb950',
  '#d29922',
  '#ff7b72',
  '#56d4dd',
  '#e685b5',
  '#8b949e',
];

export function HomeScreen({ onNavigate }: { onNavigate?: (screen: 'advisor' | 'projections') => void }) {
  const { analysis, period } = useStore();
  const { summary, cashFlow, emergencyFund, insights } = analysis;

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
          <div className="hero-label">
            {summary.daysRemaining > 0 ? 'Reste à vivre par jour' : 'Disponible en fin de mois'}
          </div>
          <div className={`hero-value amount ${overspending ? 'critical' : ''}`}>
            {summary.daysRemaining > 0
              ? summary.safeToSpendPerDay.roundedToUnit.format()
              : summary.disposable.roundedToUnit.format()}
          </div>
          <p className="hero-note">
            {summary.daysRemaining > 0 ? (
              <>
                Il reste {summary.daysRemaining} jour{summary.daysRemaining > 1 ? 's' : ''} avant la fin du mois.
                Ce montant tient compte des charges déjà prélevées, de celles à venir et de ce que vous avez
                déjà dépensé.
              </>
            ) : (
              <>Le mois est terminé : ce montant est ce qui reste une fois toutes les charges honorées.</>
            )}
          </p>

          {onNavigate && (
            <div className="inline" style={{ marginTop: 18 }}>
              <button type="button" className="button button-primary" onClick={() => onNavigate('advisor')}>
                ✨ Optimiser mon budget
              </button>
              <button type="button" className="button" onClick={() => onNavigate('projections')}>
                Voir les projections
              </button>
            </div>
          )}
        </section>

        <div className="grid grid-4">
          <Tile
            label="Revenus"
            value={summary.income.roundedToUnit.format()}
            tone="positive"
            note={
              summary.incomeDetail.hasVariableSource
                ? `Fourchette ${summary.incomeDetail.low.formatCompact()} – ${summary.incomeDetail.high.formatCompact()}`
                : undefined
            }
          />
          <Tile
            label="Charges fixes"
            value={summary.fixedExpenses.roundedToUnit.format()}
            note={summary.fixedRatio !== null ? `${Percent.format(summary.fixedRatio, 'fr-FR', 0)} du revenu` : undefined}
          />
          <Tile
            label="Dépenses variables"
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
            label="Disponible"
            value={summary.disposable.roundedToUnit.format()}
            tone={overspending ? 'critical' : 'positive'}
            note={summary.savingsRate !== null ? `Épargné : ${Percent.format(summary.savingsRate, 'fr-FR', 0)}` : undefined}
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
                        {categoryData.map((entry, index) => (
                          <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
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
                  {categoryData.map((entry, index) => (
                    <span className="legend-item" key={entry.name}>
                      <span
                        className="legend-swatch"
                        style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                      />
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
