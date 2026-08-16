import { useMemo, useState } from 'react';
import { Money, Percent } from '../core/money';
import { categoryLabel } from '../core/categories';
import { addMonths, daysInMonth, formatYearMonth } from '../core/yearMonth';
import { availableBalance } from '../core/model';
import { allocatedTo } from '../core/engine/allocation';
import { RISK_DISCLAIMER, inRealTerms, scenarios } from '../core/engine/simulation';
import { buildMonthlyReport } from '../core/engine/monthlyReport';
import { useStore } from '../state/store';
import { Card, Field, MoneyInput, Tile, parseAmount } from './components';
import { BarList, MultiTrend, foldSlices, type Slice } from './charts';

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

  // Un point par an : à l'échelle de dix ans, un point par mois ne se lit pas et ne
  // dit rien de plus.
  const chart = useMemo(() => {
    const [prudent, middle, dynamic] = results;
    if (!prudent || !middle || !dynamic) return null;

    const yearly = prudent.result.points.filter((point) => point.month % 12 === 0);
    const pick = (scenario: typeof prudent, index: number) =>
      Number(scenario.result.points[index * 12]?.total.units.toFixed(0) ?? 0);

    return {
      labels: yearly.map((point) => `${point.month / 12}`),
      series: [
        {
          key: 'verse',
          label: 'Versé, sans rendement',
          color: 'var(--text-tertiary)',
          reference: true,
          values: yearly.map((point) => Number(point.contributed.units.toFixed(0))),
        },
        {
          key: 'prudent',
          label: prudent.label,
          color: 'var(--series-3)',
          values: yearly.map((_, index) => pick(prudent, index)),
        },
        {
          key: 'intermediaire',
          label: middle.label,
          color: 'var(--series-1)',
          values: yearly.map((_, index) => pick(middle, index)),
        },
        {
          key: 'dynamique',
          label: dynamic.label,
          color: 'var(--series-7)',
          values: yearly.map((_, index) => pick(dynamic, index)),
        },
      ],
    };
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

      {chart && (
        <div style={{ marginTop: 8 }}>
          <MultiTrend
            series={chart.series}
            labels={chart.labels}
            height={250}
            formatValue={(value) =>
              `${Math.round(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}`
            }
          />
          <p className="figure-hint">
            Le trait pointillé est la somme que vous aurez versée, sans aucun rendement. L’écart entre lui et
            les courbes est l’effet du temps — et rien ne le garantit : ce sont des hypothèses, pas des
            promesses. Une seule échelle verticale, pour que les quatre courbes restent comparables.
          </p>
        </div>
      )}

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
            <div className="grid grid-2" style={{ marginTop: 20 }}>
              <div>
                <div className="card-title">En hausse</div>
                {report.increases.length === 0 ? (
                  <p className="muted">Aucune catégorie en hausse.</p>
                ) : (
                  <BarList
                    slices={foldSlices(
                      report.increases.map(
                        (delta): Slice => ({
                          key: delta.category,
                          label: categoryLabel(delta.category),
                          value: Number(delta.delta.units.toFixed(2)),
                          // Les hausses portent la couleur d'un état, pas d'une série :
                          // ici la couleur veut dire « ça monte », pas « c'est Courses ».
                          color: 'var(--serious)',
                          formatted: `+${delta.delta.roundedToUnit.format()}`,
                        }),
                      ),
                      4,
                    )}
                    showShare={false}
                  />
                )}
              </div>
              <div>
                <div className="card-title">En baisse</div>
                {report.decreases.length === 0 ? (
                  <p className="muted">Aucune catégorie en baisse.</p>
                ) : (
                  <BarList
                    slices={foldSlices(
                      report.decreases.map(
                        (delta): Slice => ({
                          key: delta.category,
                          label: categoryLabel(delta.category),
                          value: Math.abs(Number(delta.delta.units.toFixed(2))),
                          color: 'var(--positive)',
                          formatted: delta.delta.roundedToUnit.format(),
                        }),
                      ),
                      4,
                    )}
                    showShare={false}
                  />
                )}
              </div>
            </div>
          )}

          <p className="figure-hint">
            La longueur des barres compare les écarts entre eux, pas les montants dépensés : c’est le
            mouvement d’un mois à l’autre qui est en question ici.
          </p>
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
