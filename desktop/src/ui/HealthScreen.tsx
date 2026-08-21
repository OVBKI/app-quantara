import { useMemo, useState } from 'react';
import { Percent } from '../core/money';
import { COMPARISON_LABELS, compareSpending, type ComparisonWindow } from '../core/engine/comparison';
import { assessHealth, type HealthLevel } from '../core/engine/health';
import { useStore } from '../state/store';
import { Card, EmptyState } from './components';
import { BarList, Donut, Legend, foldSlices, type Slice } from './charts';

const LEVEL_COLOR: Record<HealthLevel, string> = {
  good: 'var(--positive)',
  watch: 'var(--warning)',
  alert: 'var(--critical)',
};

const LEVEL_LABEL: Record<HealthLevel, string> = {
  good: 'Bon',
  watch: 'À surveiller',
  alert: 'Attention',
};

const WINDOWS: ComparisonWindow[] = ['previousMonth', 'threeMonths', 'sixMonths', 'year'];

/**
 * Santé financière et analyse des dépenses.
 *
 * Six critères, chacun vert / orange / rouge, et l'état d'ensemble donné par le plus
 * mauvais. Pas de note sur 100 : un score unique paraît précis, ne dit jamais quoi faire,
 * et se laisse contempler. Un critère au rouge, lui, désigne l'action.
 *
 * Ce n'est pas un diagnostic financier. Les seuils retenus sont des conventions
 * répandues, écrites dans le code pour pouvoir être discutées.
 */
export function HealthScreen() {
  const { profile, analysis, period } = useStore();
  const [window, setWindow] = useState<ComparisonWindow>('threeMonths');

  const health = useMemo(() => assessHealth(analysis), [analysis]);
  const comparison = useMemo(() => compareSpending(profile, period, window), [profile, period, window]);

  // Les parts affichées sont plafonnées à six, le reste replié : au-delà, les tranches
  // deviennent trop fines pour être lues et deux teintes finissent par se ressembler.
  const slices = useMemo(
    () =>
      foldSlices(
        comparison.categories
          .filter((entry) => entry.current.isPositive)
          .map(
            (entry): Slice => ({
              key: entry.category,
              label: entry.label,
              value: Number(entry.current.units.toFixed(2)),
              color: entry.color,
              formatted: entry.current.roundedToUnit.format(),
            }),
          ),
      ),
    [comparison],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Ma situation</h1>
          <p className="page-subtitle">Six repères simples, et où part l’argent</p>
        </div>
      </header>

      <div className="stack">
        <section className="hero">
          <div className="inline">
            <span
              className="health-light"
              style={{ background: LEVEL_COLOR[health.level], width: 16, height: 16 }}
              aria-hidden="true"
            />
            <span className="hero-label" style={{ margin: 0 }}>
              {health.headline}
            </span>
          </div>
          <p className="hero-note" style={{ marginTop: 10 }}>
            L’état d’ensemble reprend le plus mauvais des six critères, pas leur moyenne. Ce sont des repères
            courants, pas un verdict.
          </p>
        </section>

        <Card title="Les six critères">
          {health.criteria.map((criterion) => (
            <div className="row" key={criterion.id} style={{ alignItems: 'flex-start' }}>
              <span
                className="health-light"
                style={{ background: LEVEL_COLOR[criterion.level], marginTop: 5 }}
                aria-hidden="true"
              />
              <div className="row-main">
                <div className="row-title">
                  {criterion.label}
                  <span
                    className="badge"
                    style={{
                      marginLeft: 8,
                      background: 'transparent',
                      color: LEVEL_COLOR[criterion.level],
                      border: `1px solid ${LEVEL_COLOR[criterion.level]}`,
                    }}
                  >
                    {LEVEL_LABEL[criterion.level]}
                  </span>
                </div>
                <div className="row-subtitle">{criterion.detail}</div>
                {criterion.action && <p className="rationale">→ {criterion.action}</p>}
              </div>
            </div>
          ))}
        </Card>

        <Card title="Où part l’argent">
          <p className="section-note">Comparé à une moyenne, pas à un seul mois.</p>

          <div className="chip-row">
            {WINDOWS.map((entry) => (
              <button
                key={entry}
                type="button"
                className="chip"
                aria-pressed={window === entry}
                onClick={() => setWindow(entry)}
              >
                {COMPARISON_LABELS[entry]}
              </button>
            ))}
          </div>

          {comparison.monthsObserved === 0 ? (
            <EmptyState
              title="Pas encore d’historique"
              message="Il faut au moins un mois précédent contenant des dépenses pour comparer. Importez un relevé, ou revenez le mois prochain."
            />
          ) : (
            <>
              <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span>
                  <strong className="amount">{comparison.currentTotal.roundedToUnit.format()}</strong> ce mois-ci
                </span>
                <span className={comparison.delta.isPositive ? 'warning' : 'positive'}>
                  {comparison.delta.isPositive ? '+' : ''}
                  {comparison.delta.roundedToUnit.format()}
                  {comparison.change !== null && ` (${Percent.format(comparison.change, 'fr-FR', 0)})`}
                </span>
              </div>

              <div className="donut-layout" style={{ marginBottom: 18 }}>
                <Donut
                  slices={slices}
                  centerValue={comparison.currentTotal.roundedToUnit.formatCompact()}
                  centerLabel="ce mois-ci"
                />
                <div>
                  <BarList slices={slices} />
                </div>
              </div>

              <Legend items={slices.map((slice) => ({ label: slice.label, color: slice.color }))} />

              <div className="card-title" style={{ marginTop: 22 }}>
                Écart avec la référence
              </div>
              {comparison.categories
                .filter((entry) => !entry.delta.isZero)
                .slice(0, 8)
                .map((entry) => (
                  <div className="row" key={entry.category}>
                    <span className="dot" style={{ background: entry.color }} aria-hidden="true" />
                    <div className="row-main">
                      <div className="row-title">{entry.label}</div>
                      <div className="row-subtitle">
                        référence {entry.reference.roundedToUnit.format()} · ce mois-ci{' '}
                        {entry.current.roundedToUnit.format()}
                      </div>
                    </div>
                    <div className={`row-amount amount ${entry.delta.isPositive ? 'warning' : 'positive'}`}>
                      {entry.delta.isPositive ? '+' : ''}
                      {entry.delta.roundedToUnit.format()}
                    </div>
                  </div>
                ))}

              <p className="rationale" style={{ marginTop: 12 }}>
                {comparison.label}
                {comparison.monthsObserved < comparison.windowMonths &&
                  ` — vous en avez demandé ${comparison.windowMonths}, les mois sans dépense saisie sont écartés.`}{' '}
                Les charges récurrentes comptent pour leur équivalent mensuel, comme partout ailleurs.
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
