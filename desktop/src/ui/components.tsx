import { useEffect, useId, useRef, useState, type KeyboardEventHandler, type ReactNode } from 'react';
import { Money, type Currency } from '../core/money';
import { useCountUp } from './motion';
import { Sparkline } from './charts';

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="inline" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          {title && <h2 className="card-title" style={{ margin: 0 }}>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Montant qui monte jusqu'à sa valeur.
 *
 * Le seul mouvement de l'application qui porte une information : on voit dans quel sens
 * le chiffre a bougé depuis le mois précédent, ou depuis l'action qu'on vient de faire.
 *
 * Pendant la montée, une approximation ; à l'arrivée, le montant exact tel que le moteur
 * l'a formaté. Laisser l'approximation à l'écran figerait un centime faux — ce serait
 * payer une animation d'une erreur, ce qu'aucune animation ne vaut.
 */
export function AnimatedAmount({ money, className }: { money: Money; className?: string }) {
  const { value, done } = useCountUp(money.units);
  const text = done ? money.format() : Money.of(value, money.currency).roundedToUnit.format();
  return (
    <span className={className}>{text}</span>
  );
}

/** Variation par rapport au mois précédent, en pastille. */
export function DeltaChip({ change, invert = false }: { change: number | null; invert?: boolean }) {
  if (change === null || !Number.isFinite(change) || Math.abs(change) < 0.005) return null;
  const up = change > 0;
  // Pour une dépense, une hausse n'est pas une bonne nouvelle : le sens se renverse.
  const good = invert ? !up : up;
  return (
    <span className={`delta ${good ? 'positive' : 'critical'}`}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(change * 100))}&#8239;%
    </span>
  );
}

export function Tile({
  label,
  value,
  note,
  tone,
  change,
  invertChange,
  trend,
  trendColor,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
  /** Variation par rapport au mois précédent, en proportion (0,12 = +12 %). */
  change?: number | null;
  invertChange?: boolean;
  /** Six derniers mois, pour la courbe miniature. */
  trend?: readonly number[];
  trendColor?: string;
}) {
  return (
    <div className="card tile">
      <div className="tile-head">
        <div className="tile-label">{label}</div>
        {change !== undefined && <DeltaChip change={change ?? null} invert={invertChange} />}
      </div>
      <div className={`tile-value amount ${tone ?? ''}`}>{value}</div>
      {note && <div className="tile-note">{note}</div>}
      {trend && trend.length > 1 && (
        <div className="tile-trend">
          <Sparkline values={trend} color={trendColor} />
        </div>
      )}
    </div>
  );
}

/**
 * Attente.
 *
 * Un rectangle qui a la forme de ce qui arrive, plutôt qu'un mot. Le regard se place au
 * bon endroit avant même que le contenu soit là, et la page ne saute pas quand il
 * arrive — ce qui est la vraie nuisance d'un « Chargement… » sur une ligne.
 */
export function Skeleton({ height = 16, width = '100%', radius }: { height?: number | string; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function ChartSkeleton() {
  return (
    <div className="card" aria-busy="true" aria-label="Chargement des graphiques">
      <Skeleton height={13} width={140} />
      <div style={{ height: 14 }} />
      <Skeleton height={180} radius={12} />
      <div style={{ height: 12 }} />
      <div className="inline" style={{ gap: 10 }}>
        <Skeleton height={11} width={90} />
        <Skeleton height={11} width={70} />
        <Skeleton height={11} width={110} />
      </div>
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <p style={{ margin: '0 auto 16px', maxWidth: '46ch' }}>{message}</p>
      {action}
    </div>
  );
}

export function ProgressBar({ value, tone }: { value: number; tone?: string }) {
  const percent = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-fill" style={{ width: `${percent}%`, background: tone }} />
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // Échap ferme la fenêtre : sans cela, une modale sans souris devient un piège.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/**
 * Saisie de montant.
 *
 * Le texte brut est conservé pendant la frappe : normaliser à chaque touche empêcherait
 * d'écrire « 12,5 » (le passage par « 12, » serait réécrit). La conversion en `Money`
 * n'a lieu qu'à la validation.
 */
export function MoneyInput({
  id,
  value,
  currency,
  onChange,
  autoFocus,
  onKeyDown,
  label,
}: {
  id?: string;
  value: string;
  currency: Currency;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  /** Pour les champs sans `<Field>` autour, qui n'ont donc pas d'étiquette visible. */
  label?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        className="amount"
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder="0,00"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        style={{ paddingRight: 42 }}
      />
      <span
        className="tertiary"
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}
      >
        {currency}
      </span>
    </div>
  );
}

export function parseAmount(text: string, currency: Currency): Money | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  try {
    const parsed = Money.parse(trimmed.replace(/\s/g, ''), currency);
    return parsed.isNegative ? null : parsed;
  } catch {
    return null;
  }
}

export function useConfirm(): [ReactNode, (message: string, action: () => void) => void] {
  const [pending, setPending] = useState<{ message: string; action: () => void } | null>(null);

  const node = pending ? (
    <Modal title="Confirmer" onClose={() => setPending(null)}>
      <p style={{ marginTop: 0 }}>{pending.message}</p>
      <div className="modal-actions">
        <button type="button" className="button" onClick={() => setPending(null)}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            pending.action();
            setPending(null);
          }}
        >
          Confirmer
        </button>
      </div>
    </Modal>
  ) : null;

  return [node, (message, action) => setPending({ message, action })];
}
