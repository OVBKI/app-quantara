import { useMemo } from 'react';
import { Percent } from '../core/money';
import { FREQUENCY_LABELS } from '../core/frequency';
import { summarizeSubscriptions } from '../core/engine/subscriptions';
import { useStore } from '../state/store';
import { Card, EmptyState, Tile, useConfirm } from './components';
import { BarList, foldSlices, type Slice } from './charts';

/**
 * Abonnements.
 *
 * Le coût annuel est mis au même rang que le mensuel, volontairement : c'est le mécanisme
 * même de l'abonnement que de faire paraître dérisoire une somme qui ne l'est pas sur
 * douze mois. Rien n'est jugé ici — la décision de garder ou de résilier appartient à
 * l'utilisateur, l'application se contente de rendre le total visible.
 */
export function SubscriptionsScreen() {
  const { profile, analysis, removeExpense } = useStore();
  const [confirmNode, confirm] = useConfirm();

  const summary = useMemo(
    () => summarizeSubscriptions(profile, analysis.summary.income),
    [profile, analysis],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Abonnements</h1>
          <p className="page-subtitle">Ce qui se prélève tous les mois sans qu’on y pense</p>
        </div>
      </header>

      <div className="stack">
        <div className="grid grid-3">
          <Tile label="Par mois" value={summary.monthlyTotal.roundedToUnit.format()} />
          <Tile
            label="Par an"
            value={summary.annualTotal.roundedToUnit.format()}
            tone={summary.annualTotal.isPositive ? 'warning' : undefined}
          />
          <Tile
            label="Part du revenu"
            value={summary.shareOfIncome !== null ? Percent.format(summary.shareOfIncome, 'fr-FR', 1) : '—'}
            note={summary.shareOfIncome === null ? 'Aucun revenu déclaré' : undefined}
          />
        </div>

        {summary.possibleDuplicates.length > 0 && (
          <div className="error-banner" style={{ borderColor: 'var(--warning)', color: 'var(--warning)', background: 'rgba(210, 153, 34, 0.12)' }}>
            Deux abonnements portent le même nom : {summary.possibleDuplicates.join(', ')}. Peut-être un
            doublon oublié — à vérifier avant de payer les deux.
          </div>
        )}

        <Card title="Vos abonnements">
          {summary.lines.length === 0 ? (
            <EmptyState
              title="Aucun abonnement identifié"
              message="Une charge récurrente cochée « abonnement », ou classée dans la catégorie Abonnements, apparaît ici. L’import d’un relevé en reconnaît la plupart automatiquement."
            />
          ) : (
            <>
              <BarList
                slices={foldSlices(
                  summary.lines.map(
                    (line): Slice => ({
                      key: line.expense.id,
                      label: line.expense.name,
                      value: Number(line.monthly.units.toFixed(2)),
                      color: 'var(--series-1)',
                      formatted: `${line.monthly.roundedToUnit.format()} / mois`,
                    }),
                  ),
                  6,
                )}
              />

              <p className="figure-hint" style={{ marginBottom: 18 }}>
                Une seule couleur : il n’y a qu’une série ici, et colorer chaque barre différemment ferait
                croire à une distinction qui n’existe pas.
              </p>

              <div className="scroll-x">
                {summary.lines.map((line) => (
                  <div className="row" key={line.expense.id}>
                    <div className="row-main">
                      <div className="row-title">{line.expense.name}</div>
                      <div className="row-subtitle">
                        {line.expense.amount.format()} · {FREQUENCY_LABELS[line.expense.frequency].toLowerCase()} ·
                        le {line.expense.dayOfMonth}
                        {line.shareOfIncome !== null && ` · ${Percent.format(line.shareOfIncome, 'fr-FR', 1)} du revenu`}
                      </div>
                    </div>
                    <div className="row-amount amount">
                      {line.monthly.roundedToUnit.format()}
                      <div className="tile-note" style={{ fontWeight: 400 }}>
                        {line.annual.roundedToUnit.format()} par an
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button button-ghost"
                      aria-label={`Supprimer ${line.expense.name}`}
                      onClick={() =>
                        confirm(
                          `Supprimer « ${line.expense.name} » ? Cela ne résilie rien : la charge disparaît seulement de votre budget.`,
                          () => removeExpense(line.expense.id),
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <p className="rationale" style={{ marginTop: 14 }}>
                Le total annuel n’est pas là pour culpabiliser : un abonnement utilisé vaut son prix. Il est là
                parce qu’un prélèvement mensuel modeste ne déclenche jamais la question, alors que la même
                somme sur douze mois la déclenche.
              </p>
            </>
          )}
        </Card>
      </div>
      {confirmNode}
    </>
  );
}
