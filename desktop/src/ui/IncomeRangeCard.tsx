import { Percent } from '../core/money';
import { INCOME_PLANNING_LABELS } from '../core/engine/income';
import { useStore } from '../state/store';
import { Card } from './components';

/**
 * Fourchette de revenu.
 *
 * Pour un revenu irrégulier, un chiffre unique est un mensonge par omission. Cet encart
 * montre l'amplitude réelle, ce que le plan retient, et pourquoi.
 */
export function IncomeRangeCard() {
  const { analysis, profile } = useStore();
  const detail = analysis.summary.incomeDetail;

  if (!detail.hasVariableSource) return null;

  const mode = profile.preferences.incomePlanning;

  return (
    <Card title="Amplitude de vos revenus">
      <div className="grid grid-3">
        <div>
          <div className="tile-label">Mois faible</div>
          <div className="tile-value amount">{detail.low.roundedToUnit.format()}</div>
        </div>
        <div>
          <div className="tile-label">Mois typique</div>
          <div className="tile-value amount">{detail.typical.roundedToUnit.format()}</div>
        </div>
        <div>
          <div className="tile-label">Mois fort</div>
          <div className="tile-value amount">{detail.high.roundedToUnit.format()}</div>
        </div>
      </div>

      {/* Barre d'amplitude : la position du montant retenu se voit d'un coup d'œil. */}
      <div style={{ position: 'relative', margin: '20px 0 10px' }}>
        <div
          style={{
            height: 8,
            borderRadius: 4,
            background: 'linear-gradient(90deg, var(--warning), var(--accent), var(--positive))',
            opacity: 0.35,
          }}
        />
        <div
          title="Montant retenu par le plan"
          style={{
            position: 'absolute',
            top: -4,
            left: `${positionOf(detail.planned.units, detail.low.units, detail.high.units)}%`,
            width: 3,
            height: 16,
            borderRadius: 2,
            background: 'var(--text)',
            transform: 'translateX(-1px)',
          }}
        />
      </div>

      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <span className="tile-note">{detail.low.formatCompact()}</span>
        <span className="tile-note">{detail.high.formatCompact()}</span>
      </div>

      <p className="rationale" style={{ marginTop: 14 }}>
        Le plan retient <strong className="amount">{detail.planned.roundedToUnit.format()}</strong> ce mois-ci —
        mode « {INCOME_PLANNING_LABELS[mode].toLowerCase()} ».
        {detail.received.isPositive && (
          <>
            {' '}
            Dont {detail.received.roundedToUnit.format()} déjà encaissés : un montant reçu n’est plus une
            hypothèse, il remplace l’estimation.
          </>
        )}
      </p>

      {detail.volatility !== null && detail.volatility > 0.3 && (
        <p className="rationale">
          Votre revenu varie de {Percent.format(detail.volatility, 'fr-FR', 0)} autour du mois typique. Un compte
          tampon d’environ{' '}
          <strong className="amount">{analysis.smoothingBuffer.roundedToUnit.format()}</strong> absorberait trois
          mois creux : les bons mois y déposent l’excédent, les mauvais y puisent. C’est l’outil adapté à un
          revenu irrégulier — distinct du fonds d’urgence, qui couvre les accidents, pas les creux d’activité.
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        {detail.sources
          .filter((source) => source.variable)
          .map((source) => (
            <div className="row" key={source.source.id}>
              <div className="row-main">
                <div className="row-title">{source.source.name}</div>
                <div className="row-subtitle">
                  {source.historyMonths >= 3
                    ? `fourchette calculée sur ${source.historyMonths} mois réellement encaissés`
                    : source.source.minAmount || source.source.maxAmount
                      ? 'fourchette que vous avez déclarée'
                      : 'fourchette par défaut de ± 20 % — précisez-la pour affiner'}
                </div>
              </div>
              <div className="row-amount amount">
                {source.actual ? (
                  <span className="positive">{source.actual.roundedToUnit.format()} reçus</span>
                ) : (
                  <>
                    {source.low.roundedToUnit.formatCompact()} – {source.high.roundedToUnit.formatCompact()}
                  </>
                )}
              </div>
            </div>
          ))}
      </div>
    </Card>
  );
}

function positionOf(value: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.min(Math.max(((value - low) / (high - low)) * 100, 0), 100);
}
