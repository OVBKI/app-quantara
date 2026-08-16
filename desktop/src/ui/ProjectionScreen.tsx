import { useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Money, Percent } from '../core/money';
import { categoryLabel } from '../core/categories';
import { addMonths, daysInMonth, formatYearMonth } from '../core/yearMonth';
import { availableBalance } from '../core/model';
import { allocatedTo } from '../core/engine/allocation';
import { RISK_DISCLAIMER, inRealTerms, scenarios } from '../core/engine/simulation';
import { buildMonthlyReport } from '../core/engine/monthlyReport';
import { useStore } from '../state/store';
import { Card, Field, MoneyInput, Tile, parseAmount } from './components';

export function ProjectionScreen() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Projections</h1>
          <p className="page-subtitle">L’effet du temps sur une épargne régulière, et le bilan du mois écoulé</p>
        </div>
      </header>

      <div className="stack">
        <ForecastCard />
        <SimulationCard />
        <MonthlyReportCard />
      </div>
    </>
  );
}

/**
 * Prévision du mois en cours.
 *
 * Une seule lecture, de haut en bas : ce qui entre, ce qui sort, ce qui est mis de côté,
 * ce qui reste — et le solde que cela donne au dernier jour. Les montants viennent tous
 * du même calcul que le reste de l'application, si bien que cet écran ne peut pas
 * contredire l'accueil.
 *
 * La distinction qui compte : « prévu » n'est pas « constaté ». Les charges fixes sont
 * connues, les dépenses variables sont estimées, et l'écran le dit ligne par ligne
 * plutôt que de présenter le tout avec la même assurance.
 */
function ForecastCard() {
  const { profile, analysis, period } = useStore();
  const { summary, cashFlow, allocation } = analysis;

  const plannedSavings = allocatedTo(allocation, 'emergencyFund')
    .plus(allocatedTo(allocation, 'goals'))
    .plus(allocatedTo(allocation, 'safetyBuffer'));
  const plannedInvestment = allocatedTo(allocation, 'investment');
  const free = allocatedTo(allocation, 'freeMoney');

  interface ForecastLine {
    readonly label: string;
    readonly amount: Money;
    readonly note: string;
    readonly tone?: string;
    readonly sign: '+' | '−';
  }

  const lines: ForecastLine[] = ([
    {
      label: 'Revenus prévus',
      amount: summary.income,
      sign: '+',
      tone: 'positive',
      note: summary.incomeDetail.hasVariableSource
        ? `Hypothèse ${summary.incomeDetail.low.formatCompact()} – ${summary.incomeDetail.high.formatCompact()} selon le mois`
        : 'Montant connu',
    },
    {
      label: 'Charges fixes',
      amount: summary.fixedExpenses,
      sign: '−',
      note: 'Connues : loyer, énergie, assurances, abonnements',
    },
    {
      label: 'Dépenses variables',
      amount: summary.variableReserved,
      sign: '−',
      note:
        summary.variablePlanned.isPositive
          ? `Vos enveloppes, dont ${summary.envelopes.totalSpent.roundedToUnit.format()} déjà dépensés`
          : summary.variableProjectionMethod === 'runRate'
            ? `Estimation d’après le rythme observé sur ${summary.daysElapsed} jours`
            : summary.variableProjectionMethod === 'history'
              ? 'Estimation d’après les mois précédents'
              : 'Constaté',
    },
    {
      label: 'Remboursements',
      amount: summary.debtPayments,
      sign: '−',
      note: 'Mensualités de crédits en cours',
    },
    {
      label: 'Épargne prévue',
      amount: plannedSavings,
      sign: '−',
      note: 'Fonds d’urgence et objectifs, selon votre plan',
    },
    {
      label: 'Investissement prévu',
      amount: plannedInvestment,
      sign: '−',
      note: 'Une fois la sécurité assurée',
    },
  ] satisfies ForecastLine[]).filter((line) => line.amount.isPositive);

  return (
    <Card title={`Prévision — ${formatYearMonth(period)}`}>
      <p className="section-note">
        Ce que devrait donner le mois si rien d’inattendu ne survient. Les charges fixes sont connues ; les
        dépenses variables sont une estimation, et c’est écrit en face de chaque ligne.
      </p>

      {lines.map((line) => (
        <div className="row" key={line.label} style={{ alignItems: 'flex-start' }}>
          <div className="row-main">
            <div className="row-title">{line.label}</div>
            <div className="row-subtitle">{line.note}</div>
          </div>
          <div className={`row-amount amount ${line.tone ?? ''}`}>
            {line.sign} {line.amount.roundedToUnit.format()}
          </div>
        </div>
      ))}

      <div className="row" style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
        <div className="row-main">Reste libre</div>
        <div className={`row-amount amount ${free.isPositive ? 'positive' : ''}`}>
          {free.roundedToUnit.format()}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Tile
          label={`Solde estimé au ${daysInMonth(period)} ${formatYearMonth(period).split(' ')[0]}`}
          value={cashFlow.endOfMonthBalance.roundedToUnit.format()}
          tone={cashFlow.endOfMonthBalance.isNegative ? 'critical' : 'positive'}
          note={`Depuis ${availableBalance(profile).roundedToUnit.format()} aujourd’hui`}
        />
        <Tile
          label="Point bas du mois"
          value={cashFlow.lowestBalance.roundedToUnit.format()}
          tone={cashFlow.projectedOverdraft ? 'critical' : undefined}
          note={
            cashFlow.lowestBalanceDate
              ? `Le ${cashFlow.lowestBalanceDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
              : 'Aucune tension prévue'
          }
        />
      </div>

      {cashFlow.projectedOverdraft && (
        <p className="rationale critical" style={{ marginTop: 12 }}>
          Le solde passerait sous zéro avant la fin du mois. C’est le point bas qui provoque un découvert, pas
          le solde final — lequel est ici {cashFlow.endOfMonthBalance.roundedToUnit.format()}.
        </p>
      )}
    </Card>
  );
}

function SimulationCard() {
  const { profile, analysis } = useStore();
  const currency = profile.currency;

  const [monthly, setMonthly] = useState(() => String(analysis.capacity.roundedToUnit.units || 200));
  const [years, setYears] = useState('10');
  const [initial, setInitial] = useState('');

  const parsedMonthly = parseAmount(monthly, currency) ?? Money.zero(currency);
  const parsedInitial = parseAmount(initial, currency) ?? Money.zero(currency);
  const months = Math.min(Math.max(Number(years) || 0, 1), 50) * 12;

  const results = useMemo(
    () => scenarios(parsedMonthly, parsedInitial, months, currency),
    [parsedMonthly, parsedInitial, months, currency],
  );

  const chartData = useMemo(() => {
    const [prudent, middle, dynamic] = results;
    if (!prudent || !middle || !dynamic) return [];
    return prudent.result.points
      .filter((point) => point.month % 6 === 0)
      .map((point, index) => ({
        annee: Number((point.month / 12).toFixed(1)),
        prudent: Number(point.total.units.toFixed(0)),
        intermediaire: Number((middle.result.points[index * 6 + 5]?.total.units ?? 0).toFixed(0)),
        dynamique: Number((dynamic.result.points[index * 6 + 5]?.total.units ?? 0).toFixed(0)),
        verse: Number(point.contributed.units.toFixed(0)),
      }));
  }, [results]);

  const middle = results[1];

  return (
    <Card title="Si j’épargne régulièrement">
      <div className="field-row">
        <Field label="Versement mensuel">
          {(id) => <MoneyInput id={id} value={monthly} currency={currency} onChange={setMonthly} />}
        </Field>
        <Field label="Déjà placé">
          {(id) => <MoneyInput id={id} value={initial} currency={currency} onChange={setInitial} />}
        </Field>
        <Field label="Durée (années)">
          {(id) => (
            <input id={id} type="number" min={1} max={50} value={years} onChange={(event) => setYears(event.target.value)} />
          )}
        </Field>
      </div>

      <div style={{ height: 260, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <XAxis
              dataKey="annee"
              stroke="var(--text-tertiary)"
              fontSize={11}
              tickLine={false}
              label={{ value: 'années', position: 'insideBottomRight', fill: 'var(--text-tertiary)', fontSize: 11 }}
            />
            <YAxis stroke="var(--text-tertiary)" fontSize={11} tickLine={false} width={70} />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text)',
              }}
              formatter={(value) => `${Number(value ?? 0).toLocaleString('fr-FR')} ${currency}`}
              labelFormatter={(annee) => `${annee} an${Number(annee) > 1 ? 's' : ''}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="verse" name="Versé" stroke="var(--text-tertiary)" strokeDasharray="4 4" dot={false} />
            <Line type="monotone" dataKey="prudent" name="Prudent (2 %)" stroke="#3fb950" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="intermediaire" name="Intermédiaire (4 %)" stroke="#4c9aff" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="dynamique" name="Dynamique (7 %)" stroke="#a371f7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {results.map((scenario) => (
          <div key={scenario.label} className="card" style={{ background: 'var(--bg)' }}>
            <div className="tile-label">{scenario.label}</div>
            <div className="tile-value amount">{scenario.result.finalAmount.roundedToUnit.format()}</div>
            <div className="tile-note">
              dont {scenario.result.totalInterest.roundedToUnit.format()} d’intérêts
            </div>
            <p className="rationale" style={{ marginTop: 8 }}>
              {scenario.description}
            </p>
          </div>
        ))}
      </div>

      {middle && (
        <p className="rationale" style={{ marginTop: 14 }}>
          Vous auriez versé {middle.result.totalContributed.roundedToUnit.format()} de votre poche. En euros
          d’aujourd’hui, les {middle.result.finalAmount.roundedToUnit.format()} de l’hypothèse intermédiaire
          représenteraient environ{' '}
          <strong className="amount">{inRealTerms(middle.result.finalAmount, months).roundedToUnit.format()}</strong> —
          l’inflation ronge le pouvoir d’achat, et une projection longue paraît toujours plus flatteuse qu’elle ne l’est.
        </p>
      )}

      <p className="rationale" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        ⚠ {RISK_DISCLAIMER}
      </p>
    </Card>
  );
}

function MonthlyReportCard() {
  const { profile, analysis } = useStore();
  const previousPeriod = addMonths(analysis.period, -1);
  const report = useMemo(
    () => buildMonthlyReport(profile, previousPeriod, analysis.reference),
    [profile, previousPeriod, analysis.reference],
  );

  const verdictLabel =
    report.verdict === 'better' ? 'En amélioration' : report.verdict === 'worse' ? 'En recul' : 'Stable';
  const verdictTone =
    report.verdict === 'better' ? 'positive' : report.verdict === 'worse' ? 'critical' : 'muted';

  return (
    <Card
      title={`Bilan de ${formatYearMonth(previousPeriod)}`}
      action={<span className={`badge ${verdictTone}`}>{verdictLabel}</span>}
    >
      {report.current.income.isZero && report.current.totalExpenses.isZero ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Aucune donnée pour {formatYearMonth(previousPeriod)}. Le bilan devient utile après un mois complet
          d’utilisation.
        </p>
      ) : (
        <>
          {report.highlights.map((highlight) => (
            <p key={highlight} style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}>
              {highlight}
            </p>
          ))}

          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <div>
              <div className="tile-label">Revenus</div>
              <div className="amount" style={{ fontWeight: 600 }}>
                {report.current.income.roundedToUnit.format()}
              </div>
              <div className="tile-note">{changeLabel(report.incomeChange)}</div>
            </div>
            <div>
              <div className="tile-label">Dépenses</div>
              <div className="amount" style={{ fontWeight: 600 }}>
                {report.current.totalExpenses.roundedToUnit.format()}
              </div>
              <div className="tile-note">{changeLabel(report.expenseChange)}</div>
            </div>
            <div>
              <div className="tile-label">Épargne</div>
              <div className="amount" style={{ fontWeight: 600 }}>
                {report.current.savingsContributions.roundedToUnit.format()}
              </div>
              <div className="tile-note">{changeLabel(report.savingsChange)}</div>
            </div>
          </div>

          {(report.increases.length > 0 || report.decreases.length > 0) && (
            <div className="grid grid-2" style={{ marginTop: 18 }}>
              <div>
                <div className="card-title">En hausse</div>
                {report.increases.length === 0 ? (
                  <p className="muted">Aucune catégorie en hausse.</p>
                ) : (
                  report.increases.map((delta) => (
                    <div className="row" key={delta.category}>
                      <div className="row-main">
                        <div className="row-title">{categoryLabel(delta.category)}</div>
                        <div className="row-subtitle">
                          {delta.previous.roundedToUnit.format()} → {delta.current.roundedToUnit.format()}
                        </div>
                      </div>
                      <div className="row-amount amount critical">+{delta.delta.roundedToUnit.format()}</div>
                    </div>
                  ))
                )}
              </div>
              <div>
                <div className="card-title">En baisse</div>
                {report.decreases.length === 0 ? (
                  <p className="muted">Aucune catégorie en baisse.</p>
                ) : (
                  report.decreases.map((delta) => (
                    <div className="row" key={delta.category}>
                      <div className="row-main">
                        <div className="row-title">{categoryLabel(delta.category)}</div>
                        <div className="row-subtitle">
                          {delta.previous.roundedToUnit.format()} → {delta.current.roundedToUnit.format()}
                        </div>
                      </div>
                      <div className="row-amount amount positive">{delta.delta.roundedToUnit.format()}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function changeLabel(change: number | null): string {
  if (change === null) return 'pas de comparaison possible';
  const sign = change > 0 ? '+' : '';
  return `${sign}${Percent.format(change, 'fr-FR', 0)} vs mois précédent`;
}
