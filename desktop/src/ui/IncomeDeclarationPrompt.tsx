import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import { pendingDeclarations, type PendingDeclaration } from '../core/engine/declarations';
import { useStore } from '../state/store';
import { Field, Modal, MoneyInput, parseAmount } from './components';

/**
 * « Combien avez-vous touché ce mois-ci ? »
 *
 * La fenêtre qui rend utilisable un revenu trop irrégulier pour porter une fourchette.
 * Elle s'ouvre d'elle-même quand un mois attend sa réponse : le dernier jour du mois
 * pour le mois courant, et à l'ouverture suivante pour un mois déjà clos — parce qu'une
 * fenêtre qui n'apparaîtrait que le 31 serait manquée par quiconque n'ouvre pas
 * l'application ce jour-là.
 *
 * Trois façons de répondre, et aucune n'est un piège :
 * - un montant, qui devient une certitude et remplace toute estimation ;
 * - « je n'ai rien touché », qui est une réponse et non un oubli — enregistrée comme un
 *   mois à zéro, elle arrête les rappels ;
 * - « plus tard », qui repousse au lendemain sans rien inventer entre-temps.
 */
const DISMISS_KEY = 'quantara.declaration.dismissedOn';

function dismissedToday(reference: Date): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === reference.toISOString().slice(0, 10);
  } catch {
    return false;
  }
}

function rememberDismissal(reference: Date): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, reference.toISOString().slice(0, 10));
  } catch {
    // Stockage indisponible : au pire la question se reposera, ce n'est pas grave.
  }
}

export function useIncomeDeclarations(): {
  readonly pending: PendingDeclaration[];
  readonly shouldPrompt: boolean;
} {
  const { profile, ready, locked } = useStore();
  const pending = useMemo(() => (ready && !locked ? pendingDeclarations(profile) : []), [profile, ready, locked]);

  return { pending, shouldPrompt: pending.length > 0 && !dismissedToday(new Date()) };
}

export function IncomeDeclarationPrompt({
  pending,
  onClose,
}: {
  pending: readonly PendingDeclaration[];
  onClose: () => void;
}) {
  const { profile, declareIncome } = useStore();
  const currency = profile.currency;

  const [index, setIndex] = useState(0);
  const entry = pending[index];
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!entry) return null;

  const parsed = parseAmount(amount, currency);
  const remaining = pending.length - index - 1;

  function next() {
    setAmount('');
    setError(null);
    if (index + 1 < pending.length) setIndex(index + 1);
    else onClose();
  }

  function submit(value: Money) {
    if (!entry) return;
    declareIncome(entry.source.id, entry.period, value);
    next();
  }

  function confirm() {
    if (!parsed) {
      setError('Indiquez un montant, ou choisissez « Je n’ai rien touché ».');
      return;
    }
    submit(parsed);
  }

  return (
    <Modal title={`${entry.source.name} — ${entry.label}`} onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
        {entry.closed ? (
          <>
            Le mois de <strong>{entry.label}</strong> est terminé. Combien avez-vous touché exactement ?
          </>
        ) : (
          <>
            Dernier jour du mois. Combien avez-vous touché en <strong>{entry.label}</strong> ?
          </>
        )}
      </p>

      <Field
        label="Montant net reçu"
        hint={
          entry.suggestion
            ? `Vos mois déclarés tournent autour de ${entry.suggestion.roundedToUnit.format()} — à titre de repère seulement.`
            : 'Le montant exact, tel qu’il est arrivé sur le compte.'
        }
      >
        {(id) => (
          <MoneyInput
            id={id}
            value={amount}
            currency={currency}
            onChange={(value) => {
              setAmount(value);
              setError(null);
            }}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirm();
            }}
          />
        )}
      </Field>

      {entry.suggestion && (
        <button
          type="button"
          className="button button-small"
          style={{ marginBottom: 12 }}
          onClick={() => setAmount(String(entry.suggestion?.units ?? ''))}
        >
          Reprendre {entry.suggestion.roundedToUnit.format()}
        </button>
      )}

      {error && <p className="error-text">{error}</p>}

      <p className="field-hint">
        Ce montant remplace toute estimation : le budget, la trésorerie et les objectifs se recalculent sur
        cette valeur, et non sur une moyenne. Il reste modifiable à tout moment depuis l’écran Budget.
      </p>

      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="button button-ghost"
          onClick={() => {
            rememberDismissal(new Date());
            onClose();
          }}
        >
          Plus tard
        </button>

        <div className="inline">
          <button type="button" className="button" onClick={() => submit(Money.zero(currency))}>
            Je n’ai rien touché
          </button>
          <button type="button" className="button button-primary" onClick={confirm}>
            {remaining > 0 ? `Enregistrer (${remaining} mois ensuite)` : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
