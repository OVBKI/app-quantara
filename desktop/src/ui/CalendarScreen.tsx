import { useMemo } from 'react';
import { Money } from '../core/money';
import { daysInMonth, dateOf, formatYearMonth } from '../core/yearMonth';
import type { CashFlowEvent } from '../core/engine/cashflow';
import { useStore } from '../state/store';
import { Card, Tile } from './components';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const KIND_COLOR: Record<CashFlowEvent['kind'], string> = {
  income: 'var(--positive)',
  expense: 'var(--text-secondary)',
  debt: 'var(--debt)',
};

/**
 * Calendrier financier.
 *
 * La même information que la courbe de trésorerie, disposée autrement : la courbe montre
 * la tendance, le calendrier montre les dates. Savoir que le point bas tombe « vers le
 * 14 » ne suffit pas quand il faut décider si un achat attend la fin du mois.
 *
 * Rien n'est calculé ici : les échéances viennent du moteur de trésorerie, celui-là même
 * qui trace la courbe. Les deux écrans ne peuvent donc pas se contredire.
 */
export function CalendarScreen() {
  const { analysis, period, profile } = useStore();
  const total = daysInMonth(period);

  // Toutes les échéances du mois, pas seulement celles à venir : un calendrier qui
  // masquerait le début du mois empêcherait de vérifier ce qui est déjà passé.
  const byDay = useMemo(() => {
    const map = new Map<number, CashFlowEvent[]>();
    for (const point of analysis.cashFlow.points) {
      map.set(point.day, []);
    }
    for (const event of analysis.cashFlow.events) {
      const day = event.date.getDate();
      map.set(day, [...(map.get(day) ?? []), event]);
    }
    return map;
  }, [analysis]);

  const balanceByDay = useMemo(
    () => new Map(analysis.cashFlow.points.map((point) => [point.day, point.balance])),
    [analysis],
  );

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === period.year && today.getMonth() + 1 === period.month;

  // getDay() rend 0 pour dimanche ; la semaine française commence le lundi.
  const firstWeekday = (dateOf(period, 1).getDay() + 6) % 7;

  const upcoming = analysis.cashFlow.events.slice(0, 8);
  const totalIncoming = Money.sum(
    analysis.cashFlow.events.filter((event) => event.kind === 'income').map((event) => event.amount),
    profile.currency,
  );
  const totalOutgoing = Money.sum(
    analysis.cashFlow.events.filter((event) => event.kind !== 'income').map((event) => event.amount),
    profile.currency,
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Calendrier</h1>
          <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>
            {formatYearMonth(period)}
          </p>
        </div>
      </header>

      <div className="stack">
        <div className="grid grid-3">
          <Tile label="À recevoir" value={totalIncoming.roundedToUnit.format()} tone="positive" />
          <Tile label="À prélever" value={totalOutgoing.roundedToUnit.format()} />
          <Tile
            label="Solde en fin de mois"
            value={analysis.cashFlow.endOfMonthBalance.roundedToUnit.format()}
            tone={analysis.cashFlow.endOfMonthBalance.isNegative ? 'critical' : undefined}
          />
        </div>

        <Card title="Le mois jour par jour">
          <div className="scroll-x">
            <div className="calendar" style={{ minWidth: 480 }}>
              {WEEKDAYS.map((day, index) => (
                <div key={index} className="calendar-day" style={{ textAlign: 'center', minHeight: 'auto' }}>
                  {day}
                </div>
              ))}

              {Array.from({ length: firstWeekday }, (_, index) => (
                <div key={`vide-${index}`} />
              ))}

              {Array.from({ length: total }, (_, index) => {
                const day = index + 1;
                const events = byDay.get(day) ?? [];
                const balance = balanceByDay.get(day);
                const isToday = isCurrentMonth && today.getDate() === day;

                return (
                  <div key={day} className={`calendar-cell ${isToday ? 'today' : ''}`}>
                    <div className="calendar-day">{day}</div>
                    {events.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className="calendar-entry"
                        style={{ color: KIND_COLOR[event.kind] }}
                        title={`${event.label} · ${event.amount.roundedToUnit.format()}`}
                      >
                        {event.kind === 'income' ? '+' : '−'}
                        {event.amount.roundedToUnit.formatCompact()}
                      </span>
                    ))}
                    {events.length > 3 && <span className="calendar-entry tertiary">+{events.length - 3}</span>}
                    {balance?.isNegative && (
                      <span className="calendar-entry critical" title="Solde négatif ce jour-là">
                        ⚠
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="rationale" style={{ marginTop: 14 }}>
            Un triangle signale un jour où le solde projeté passerait sous zéro. Les dépenses variables ne
            figurent pas ici : elles n’ont pas de date connue, seulement un rythme, et les inventer donnerait
            une fausse précision.
          </p>
        </Card>

        <Card title="Prochaines échéances">
          {upcoming.length === 0 ? (
            <p className="muted">Plus aucune échéance d’ici la fin du mois.</p>
          ) : (
            upcoming.map((event) => (
              <div className="row" key={event.id}>
                <span className="dot" style={{ background: KIND_COLOR[event.kind] }} aria-hidden="true" />
                <div className="row-main">
                  <div className="row-title">{event.label}</div>
                  <div className="row-subtitle">
                    {event.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                </div>
                <div className={`row-amount amount ${event.kind === 'income' ? 'positive' : ''}`}>
                  {event.kind === 'income' ? '+' : '−'}
                  {event.amount.roundedToUnit.format()}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
