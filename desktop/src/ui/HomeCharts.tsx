import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Currency } from '../core/money';
import type { CashFlowForecast } from '../core/engine/cashflow';
import { Card } from './components';

export interface ChartPoint {
  readonly day: number;
  readonly solde: number;
}

export interface CategorySlice {
  readonly name: string;
  readonly color: string;
  readonly value: number;
}

/**
 * Les deux graphiques de l'accueil, isolés dans leur propre module.
 *
 * Recharts pèse à lui seul la majeure partie du paquet. Le charger séparément permet à
 * l'accueil de s'afficher — solde, tuiles, constats — avant que la bibliothèque de
 * graphiques ne soit arrivée. Les chiffres passent en premier ; les courbes suivent.
 */
export default function HomeCharts({
  cashFlowData,
  categoryData,
  currency,
  cashFlow,
}: {
  cashFlowData: readonly ChartPoint[];
  categoryData: readonly CategorySlice[];
  currency: Currency;
  cashFlow: CashFlowForecast;
}) {
  return (
    <>
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
                    formatter={(value) => [`${Number(value ?? 0).toLocaleString('fr-FR')} ${currency}`, 'Solde']}
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
                        formatter={(value) => `${Number(value ?? 0).toLocaleString('fr-FR')} ${currency}`}
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
    </>
  );
}
