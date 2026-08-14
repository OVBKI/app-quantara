import { useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Money, Percent } from '../core/money';
import { categoryLabel } from '../core/categories';
import { addMonths, formatYearMonth } from '../core/yearMonth';
import { RISK_DISCLAIMER, inRealTerms, scenarios } from '../core/engine/simulation';
import { buildMonthlyReport } from '../core/engine/monthlyReport';
import { useStore } from '../state/store';
import { Card, Field, MoneyInput, parseAmount } from './components';

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
        <SimulationCard />
        <MonthlyReportCard />
      </div>
    </>
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
