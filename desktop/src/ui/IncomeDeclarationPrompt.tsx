import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import { pendingDeclarations, type PendingDeclaration } from '../core/engine/declarations';
import { useStore } from '../state/store';
import { Modal, parseAmount } from './components';

/**
 * « Combien avez-vous reçu ? »
 *
 * Une question, un champ, un bouton. Tout le reste a été retiré : une explication de
 * trois paragraphes autour d'une question à un chiffre n'aide personne, elle fait
 * hésiter. Ce que le montant déclenche ensuite se voit sur les écrans, il n'a pas besoin
 * d'être annoncé ici.
 *
 * La fenêtre s'ouvre le dernier jour du mois, et de nouveau à l'ouverture suivante si ce
 * jour-là a été manqué.
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
    // Stockage indisponible : au pire la question se reposera demain.
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
  const [amount, setAmount] = useState('');
  const entry = pending[index];

  if (!entry) return null;

  const parsed = parseAmount(amount, currency);
  const remaining = pending.length - index - 1;

  function submit(value: Money) {
    if (!entry) return;
    declareIncome(entry.source.id, entry.period, value);
    setAmount('');
    if (index + 1 < pending.length) setIndex(index + 1);
    else onClose();
  }

  return (
    <Modal title={entry.source.name} onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
        <p className="hero-label" style={{ margin: 0 }}>
          {entry.label}
        </p>
        <p style={{ fontSize: 22, fontWeight: 620, margin: '8px 0 20px' }}>Combien avez-vous reçu ?</p>

        {/* Un seul champ, grand, prêt à recevoir un nombre. */}
        <div className="declare-field">
          <input
            className="amount"
            inputMode="decimal"
            value={amount}
            autoFocus
            placeholder="0"
            aria-label={`Montant reçu en ${entry.label}`}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && parsed) submit(parsed);
            }}
          />
          <span aria-hidden="true">{currency === 'EUR' ? '€' : currency}</span>
        </div>

        {entry.suggestion && (
          <button
            type="button"
            className="chip"
            style={{ marginTop: 14 }}
            onClick={() => setAmount(String(entry.suggestion?.units ?? ''))}
          >
            Comme d’habitude : {entry.suggestion.roundedToUnit.format()}
          </button>
        )}
      </div>

      <div className="modal-actions" style={{ justifyContent: 'space-between', marginTop: 22 }}>
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
            Rien reçu
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!parsed}
            onClick={() => parsed && submit(parsed)}
          >
            Valider
          </button>
        </div>
      </div>

      {remaining > 0 && (
        <p className="tertiary" style={{ textAlign: 'center', fontSize: 12, margin: '12px 0 0' }}>
          Encore {remaining} mois après celui-ci
        </p>
      )}
    </Modal>
  );
}
