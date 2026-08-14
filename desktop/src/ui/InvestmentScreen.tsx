import { useMemo } from 'react';
import { investmentGuidance, type AssetClass, type ReadinessCheck } from '../core/engine/investment';
import { allocatedTo } from '../core/engine/allocation';
import { useStore } from '../state/store';
import { Card } from './components';

const RISK_TONE: Record<AssetClass['risk'], string> = {
  faible: 'var(--positive)',
  modéré: 'var(--warning)',
  élevé: 'var(--critical)',
};

/**
 * Volet investissement — éducatif, et rien d'autre.
 *
 * L'écran vérifie des préalables et décrit des familles de placements. Il ne nomme aucun
 * produit, aucun émetteur, et ne chiffre aucun rendement : une recommandation
 * personnalisée sur un instrument financier relève du conseil réglementé.
 */
export function InvestmentScreen() {
  const { profile, analysis } = useStore();

  const guidance = useMemo(
    () =>
      investmentGuidance(
        profile,
        analysis.summary,
        analysis.emergencyFund,
        allocatedTo(analysis.allocation, 'investment'),
      ),
    [profile, analysis],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Investissement</h1>
          <p className="page-subtitle">Comprendre avant de placer</p>
        </div>
      </header>

      <div className="stack">
        <Card title="Où vous en êtes">
          <div
            style={{
              fontSize: 18,
              fontWeight: 620,
              marginBottom: 12,
              color:
                guidance.state === 'ready'
                  ? 'var(--positive)'
                  : guidance.state === 'partial'
                    ? 'var(--warning)'
                    : 'var(--text-secondary)',
            }}
          >
            {guidance.state === 'ready'
              ? 'Les préalables sont réunis'
              : guidance.state === 'partial'
                ? 'Presque — un point reste à surveiller'
                : 'Des priorités passent avant'}
          </div>

          {guidance.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}

          {guidance.indicativeMonthly.isPositive && (
            <p className="rationale" style={{ marginTop: 14 }}>
              Votre plan oriente{' '}
              <strong className="amount">{guidance.indicativeMonthly.roundedToUnit.format()}</strong> par mois
              vers un placement long terme. C’est un montant, pas une instruction : à vous de décider s’il part,
              où, et quand.
            </p>
          )}
        </Card>

        <Card title="Les grandes familles de placements">
          <p className="muted" style={{ marginTop: 0 }}>
            Chaque famille est décrite avec son principal inconvénient. Présenter un placement sans son revers
            reviendrait à en faire la promotion.
          </p>

          {guidance.assetClasses.map((asset) => (
            <div key={asset.name} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
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
              <div className="row-subtitle" style={{ marginBottom: 6 }}>
                Horizon : {asset.horizon}
              </div>
              <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: 13 }}>
                {asset.description}
              </p>
              <p className="rationale" style={{ margin: 0 }}>
                <strong>Le revers :</strong> {asset.drawback}
              </p>
            </div>
          ))}
        </Card>

        <Card>
          <p className="rationale" style={{ margin: 0 }}>
            ⚠ {guidance.disclaimer}
          </p>
        </Card>
      </div>
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
