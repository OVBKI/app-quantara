import type { Currency } from '../core/money';
import type { CashFlowForecast } from '../core/engine/cashflow';
import { Card } from './components';
import { BarList, Donut, Figure, Legend, TrendChart, foldSlices, type Slice, type TrendPoint } from './charts';

export interface CategorySlice {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly value: number;
  readonly formatted: string;
}

/**
 * Les graphiques de l'accueil, isolés dans leur propre module.
 *
 * Deux questions, deux formes différentes, et c'est délibéré :
 *
 * - « Comment évolue mon solde ce mois-ci ? » est une question de **tendance** : une
 *   courbe, avec le creux marqué, parce que c'est lui qui provoque un découvert.
 * - « Où part mon argent ? » est une question de **composition** : un anneau donne le
 *   poids d'un poste dans le tout d'un seul regard — mais l'œil ne compare pas des
 *   angles, alors les barres à côté donnent le classement exact.
 *
 * Le même jeu de données, deux lectures, chacune faite pour ce qu'elle sait faire.
 */
export default function HomeCharts({
  cashFlowData,
  categoryData,
  currency,
  cashFlow,
  totalFormatted,
}: {
  cashFlowData: readonly { day: number; solde: number }[];
  categoryData: readonly CategorySlice[];
  currency: Currency;
  cashFlow: CashFlowForecast;
  totalFormatted: string;
}) {
  const points: TrendPoint[] = cashFlowData.map((point) => ({
    x: point.day,
    y: point.solde,
    label: `Jour ${point.day}`,
    formatted: `${point.solde.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`,
  }));

  const lowestIndex = cashFlow.lowestBalanceDate ? cashFlow.lowestBalanceDate.getDate() - 1 : undefined;

  const slices: Slice[] = foldSlices(
    categoryData.map((entry) => ({
      key: entry.key,
      label: entry.name,
      value: entry.value,
      color: entry.color,
      formatted: entry.formatted,
    })),
  );

  return (
    <div className="grid grid-2">
      <Card title="Trésorerie du mois">
        <Figure
          title={
            cashFlow.projectedOverdraft
              ? `Point bas : ${cashFlow.lowestBalance.roundedToUnit.format()}`
              : `Fin de mois : ${cashFlow.endOfMonthBalance.roundedToUnit.format()}`
          }
          hint={
            cashFlow.projectedOverdraft
              ? 'Le point marqué est le jour le plus bas du mois.'
              : 'Chaque échéance est placée à sa date réelle.'
          }
        >
          <TrendChart
            points={points}
            color={cashFlow.projectedOverdraft ? 'var(--critical)' : 'var(--series-1)'}
            markerAt={lowestIndex}
          />
        </Figure>
      </Card>

      <Card title="Où part l’argent">
        {slices.length === 0 ? (
          <p className="muted">Aucune dépense enregistrée pour ce mois.</p>
        ) : (
          <>
            <div className="donut-layout">
              <Donut slices={slices} centerValue={totalFormatted} centerLabel="dépensés" />
              <div>
                <BarList slices={slices} />
              </div>
            </div>
            <p className="figure-hint">
              L’anneau donne le poids de chaque poste, les barres le classement exact.
            </p>
            <Legend items={slices.map((slice) => ({ label: slice.label, color: slice.color }))} />
          </>
        )}
      </Card>
    </div>
  );
}
