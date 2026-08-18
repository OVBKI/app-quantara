import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import { categoryLabel } from '../core/categories';
import type { Transaction } from '../core/model';
import { daysInMonth, dateOf, formatYearMonth, parseDate, containsDate } from '../core/yearMonth';
import type { CashFlowEvent } from '../core/engine/cashflow';
import { movementFor } from '../core/engine/accounts';
import { useStore } from '../state/store';
import { Card, Tile } from './components';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Une ligne du calendrier : soit une écriture réelle, soit une échéance prévue.
 *
 * Les deux figurent côte à côte parce qu'un mois se lit ainsi : ce qui est déjà passé,
 * et ce qui reste à venir. Elles ne se confondent pas pour autant — le réel est plein,
 * le prévu est en pointillé, et chacun porte son total.
 */
interface DayEntry {
  readonly id: string;
  readonly label: string;
  /** Signé : négatif quand l'argent sort. */
  readonly amount: Money;
  readonly real: boolean;
  readonly detail?: string;
}

function eventEntry(event: CashFlowEvent): DayEntry {
  const signed =
    event.kind === 'income' ? event.amount : Money.zero(event.amount.currency).minus(event.amount);
  return {
    id: `prévu-${event.id}`,
    label: event.label,
    amount: signed,
    real: false,
    detail: event.kind === 'income' ? 'Revenu prévu' : event.kind === 'debt' ? 'Remboursement prévu' : 'Charge prévue',
  };
}

const KIND_DETAIL: Record<Transaction['kind'], string> = {
  income: 'Revenu',
  expense: 'Dépense',
  savings: 'Épargne',
  transfer: 'Virement',
  debtPayment: 'Remboursement',
};

/**
 * Calendrier financier.
 *
 * La même information que la courbe de trésorerie, disposée autrement : la courbe montre
 * la tendance, le calendrier montre les dates. Savoir que le point bas tombe « vers le
 * 14 » ne suffit pas quand il faut décider si un achat attend la fin du mois.
 *
 * Ce qui manquait : les dépenses réellement notées n'y figuraient pas. Le calendrier ne
 * montrait que les échéances prévues — et seulement celles à venir, si bien que le début
 * du mois paraissait vide. Un calendrier de suivi qui ignore ce qui s'est passé ne suit
 * rien du tout.
 */
export function CalendarScreen() {
  const { analysis, period, profile } = useStore();
  const total = daysInMonth(period);
  const currency = profile.currency;
  const [accountId, setAccountId] = useState<string>('all');
  const [openDay, setOpenDay] = useState<number | null>(null);

  const accounts = profile.accounts.filter((account) => !account.archived);

  /*
   * Ce qui est réellement passé, jour par jour.
   *
   * Filtré sur le compte choisi le cas échéant : « tous les comptes » additionne, un
   * compte donné ne montre que ce qui l'a traversé, dans le sens qui le concerne. Un
   * virement entre deux de vos comptes n'est ni une dépense ni un revenu — il sort de
   * l'un et entre dans l'autre, et c'est ainsi qu'il s'affiche.
   */
  const realByDay = useMemo(() => {
    const map = new Map<number, DayEntry[]>();
    for (const transaction of profile.transactions) {
      const date = parseDate(transaction.date);
      if (!containsDate(period, date)) continue;

      let amount: Money;
      if (accountId === 'all') {
        if (transaction.kind === 'income') amount = transaction.amount;
        else if (transaction.kind === 'savings' || transaction.kind === 'transfer') continue;
        else amount = Money.zero(currency).minus(transaction.amount);
      } else {
        const movement = movementFor(accountId, transaction);
        if (movement === null) continue;
        amount = movement;
      }

      const day = date.getDate();
      map.set(day, [
        ...(map.get(day) ?? []),
        {
          id: transaction.id,
          label: transaction.label || (transaction.category ? categoryLabel(transaction.category) : 'Écriture'),
          amount,
          real: true,
          detail: transaction.category
            ? `${KIND_DETAIL[transaction.kind]} · ${categoryLabel(transaction.category)}`
            : KIND_DETAIL[transaction.kind],
        },
      ]);
    }
    return map;
  }, [profile, period, accountId, currency]);

  // Les échéances prévues n'existent que pour la vue d'ensemble : rattachées à aucun
  // compte, elles n'ont pas de sens quand on en regarde un seul.
  const plannedByDay = useMemo(() => {
    const map = new Map<number, DayEntry[]>();
    if (accountId !== 'all') return map;
    for (const event of analysis.cashFlow.events) {
      const day = event.date.getDate();
      map.set(day, [...(map.get(day) ?? []), eventEntry(event)]);
    }
    return map;
  }, [analysis, accountId]);

  const balanceByDay = useMemo(
    () => new Map(analysis.cashFlow.points.map((point) => [point.day, point.balance])),
    [analysis],
  );

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === period.year && today.getMonth() + 1 === period.month;
  // getDay() rend 0 pour dimanche ; la semaine française commence le lundi.
  const firstWeekday = (dateOf(period, 1).getDay() + 6) % 7;

  const allReal = [...realByDay.values()].flat();
  const received = Money.sum(
    allReal.filter((entry) => entry.amount.isPositive).map((entry) => entry.amount),
    currency,
  );
  const spent = Money.sum(
    allReal.filter((entry) => entry.amount.isNegative).map((entry) => Money.zero(currency).minus(entry.amount)),
    currency,
  );
  const plannedRemaining = Money.sum(
    analysis.cashFlow.upcoming.filter((event) => event.kind !== 'income').map((event) => event.amount),
    currency,
  );

  const dayEntries = (day: number): DayEntry[] => [...(realByDay.get(day) ?? []), ...(plannedByDay.get(day) ?? [])];
  const selected = openDay !== null ? dayEntries(openDay) : [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Calendrier</h1>
          <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>
            {formatYearMonth(period)}
          </p>
        </div>
        {accounts.length > 0 && (
          <label className="split-target">
            <span className="tertiary">Compte</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="all">Tous les comptes</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className="stack">
        <div className="grid grid-3">
          <Tile
            label="Reçu ce mois-ci"
            value={received.roundedToUnit.format()}
            tone={received.isPositive ? 'positive' : undefined}
            note={`${allReal.filter((entry) => entry.amount.isPositive).length} écritures`}
          />
          <Tile
            label="Dépensé ce mois-ci"
            value={spent.roundedToUnit.format()}
            note={`${allReal.filter((entry) => entry.amount.isNegative).length} écritures`}
          />
          <Tile
            label="Encore à prélever"
            value={plannedRemaining.roundedToUnit.format()}
            note={accountId === 'all' ? 'Charges prévues d’ici la fin du mois' : 'Toutes charges confondues'}
          />
        </div>

        <Card title="Le mois jour par jour">
          <div className="scroll-x">
            <div className="calendar" style={{ minWidth: 520 }}>
              {WEEKDAYS.map((day, index) => (
                <div key={index} className="calendar-weekday">
                  {day}
                </div>
              ))}

              {Array.from({ length: firstWeekday }, (_, index) => (
                <div key={`vide-${index}`} />
              ))}

              {Array.from({ length: total }, (_, index) => {
                const day = index + 1;
                const entries = dayEntries(day);
                const balance = balanceByDay.get(day);
                const isToday = isCurrentMonth && today.getDate() === day;
                const net = Money.sum(entries.map((entry) => entry.amount), currency);

                return (
                  <button
                    type="button"
                    key={day}
                    className={`calendar-cell ${isToday ? 'today' : ''} ${openDay === day ? 'selected' : ''}`}
                    onClick={() => setOpenDay(openDay === day ? null : day)}
                    aria-label={`${day} — ${entries.length} mouvement${entries.length > 1 ? 's' : ''}`}
                  >
                    <div className="calendar-head">
                      <span className="calendar-day">{day}</span>
                      {!net.isZero && (
                        <span className={`calendar-net amount ${net.isNegative ? '' : 'positive'}`}>
                          {net.isNegative ? '−' : '+'}
                          {net.absolute.roundedToUnit.formatCompact()}
                        </span>
                      )}
                    </div>

                    {entries.slice(0, 3).map((entry) => (
                      <span
                        key={entry.id}
                        className={`calendar-entry ${entry.real ? 'real' : 'planned'}`}
                        title={`${entry.label} · ${entry.amount.absolute.roundedToUnit.format()}`}
                      >
                        {entry.label}
                      </span>
                    ))}
                    {entries.length > 3 && (
                      <span className="calendar-entry tertiary">+{entries.length - 3} autres</span>
                    )}
                    {balance?.isNegative && (
                      <span className="calendar-flag critical" title="Solde négatif ce jour-là">
                        ⚠ découvert
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="calendar-legend">
            <span className="legend-item">
              <span className="legend-swatch real" aria-hidden="true" /> Écriture réelle
            </span>
            <span className="legend-item">
              <span className="legend-swatch planned" aria-hidden="true" /> Échéance prévue
            </span>
            <span className="tertiary">Cliquez un jour pour le détail.</span>
          </div>
        </Card>

        {openDay !== null && (
          <Card
            title={`${openDay} ${formatYearMonth(period)}`}
            action={
              <button type="button" className="button button-small" onClick={() => setOpenDay(null)}>
                Fermer
              </button>
            }
          >
            {selected.length === 0 ? (
              <p className="muted">Aucun mouvement ce jour-là.</p>
            ) : (
              selected.map((entry) => (
                <div className="row" key={entry.id}>
                  <span className={`legend-swatch ${entry.real ? 'real' : 'planned'}`} aria-hidden="true" />
                  <div className="row-main">
                    <div className="row-title">{entry.label}</div>
                    <div className="row-subtitle">{entry.detail}</div>
                  </div>
                  <div className={`row-amount amount ${entry.amount.isNegative ? '' : 'positive'}`}>
                    {entry.amount.isNegative ? '−' : '+'}
                    {entry.amount.absolute.roundedToUnit.format()}
                  </div>
                </div>
              ))
            )}
          </Card>
        )}

        <Card title="Prochaines échéances">
          {analysis.cashFlow.upcoming.length === 0 ? (
            <p className="muted">Plus aucune échéance d’ici la fin du mois.</p>
          ) : (
            analysis.cashFlow.upcoming.slice(0, 8).map((event) => (
              <div className="row" key={event.id}>
                <span className="legend-swatch planned" aria-hidden="true" />
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
          <p className="rationale" style={{ marginTop: 14 }}>
            ⚠ marque un jour où le solde passerait sous zéro. Les dépenses variables à venir n’ont pas de date : elles
            pèsent sur le solde prévu, sans figurer dans une case.
          </p>
        </Card>
      </div>
    </>
  );
}
