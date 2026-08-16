import type { AssetClass, InvestmentGuidance, ReadinessCheck } from '../core/engine/investment';

const RISK_TONE: Record<AssetClass['risk'], string> = {
  faible: 'var(--positive)',
  modéré: 'var(--warning)',
  élevé: 'var(--critical)',
};

/**
 * Volet éducatif de l'investissement.
 *
 * Ce bloc vérifie des préalables et décrit des familles de placements. Il ne nomme aucun
 * produit, aucun émetteur, et ne chiffre aucun rendement : une recommandation
 * personnalisée sur un instrument financier relève du conseil réglementé. Il est replié
 * sous l'écran Portefeuille, dont le sujet principal est le suivi, pas le conseil.
 */
/**
 * Préalables et familles d'actifs, réutilisés tels quels par l'écran Portefeuille.
 *
 * Extraits ici plutôt que dupliqués : ces textes portent des garde-fous réglementaires,
 * et deux copies finiraient par diverger.
 */
export function ReadinessSection({ guidance }: { guidance: InvestmentGuidance }) {
  return (
    <>
      {guidance.checks.map((check) => (
        <CheckRow key={check.id} check={check} />
      ))}

      {guidance.assetClasses.map((asset) => (
        <div key={asset.name} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 580 }}>{asset.name}</span>
            <span
              className="badge"
              style={{
                background: 'transparent',
                color: RISK_TONE[asset.risk],
                border: `1px solid ${RISK_TONE[asset.risk]}`,
              }}
            >
              risque {asset.risk}
            </span>
          </div>
          <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: 13 }}>{asset.description}</p>
          <p className="rationale" style={{ margin: 0 }}>
            <strong>Le revers :</strong> {asset.drawback}
          </p>
        </div>
      ))}

      <p className="rationale" style={{ marginTop: 14 }}>
        ⚠ {guidance.disclaimer}
      </p>
    </>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{
          color: check.passed ? 'var(--positive)' : check.blocking ? 'var(--critical)' : 'var(--warning)',
          fontSize: 15,
          lineHeight: '20px',
        }}
      >
        {check.passed ? '●' : '○'}
      </span>
      <div className="row-main">
        <div className="row-title">
          {check.label}
          {!check.blocking && (
            <span className="badge" style={{ marginLeft: 8 }}>
              recommandé
            </span>
          )}
        </div>
        <div className="rationale">{check.detail}</div>
      </div>
    </div>
  );
}
