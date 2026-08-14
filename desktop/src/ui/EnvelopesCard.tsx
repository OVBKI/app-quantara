import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import { VARIABLE_CATEGORY_IDS, categoryLabel, type ExpenseCategoryId } from '../core/categories';
import { addMonths, lastMonths } from '../core/yearMonth';
import {
  ENVELOPE_STATE_LABELS,
  ENVELOPE_STATE_TONE,
  suggestEnvelopes,
  type Envelope,
} from '../core/engine/envelopes';
import { useStore } from '../state/store';
import { Card, Field, Modal, MoneyInput, ProgressBar, parseAmount, useConfirm } from './components';

/**
 * Budgets par catégorie.
 *
 * L'écart entre suivre un budget et le subir tient à ce seul écran : décider à l'avance
 * combien va dans chaque poste, puis voir en temps réel si le rythme tient.
 */
export function EnvelopesCard() {
  const { profile, analysis, setCategoryBudget, removeCategoryBudget } = useStore();
  const [form, setForm] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [confirmNode, confirm] = useConfirm();

  const { envelopes } = analysis.summary;

  return (
    <>
      <Card
        title="Enveloppes par catégorie"
        action={
          <div className="inline">
            <button type="button" className="button button-small" onClick={() => setSuggesting(true)}>
              Proposer d’après mon historique
            </button>
            <button type="button" className="button button-small" onClick={() => setForm(true)}>
              Ajouter
            </button>
          </div>
        }
      >
        {envelopes.envelopes.length === 0 ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Aucune enveloppe définie. Vos dépenses variables sont alors seulement <em>constatées</em> : à la fin
              du mois, vous savez ce que vous avez dépensé, mais rien ne vous a prévenu pendant.
            </p>
            <p className="rationale">
              Fixez un montant par poste — courses, restaurants, loisirs — et l’application compare en continu la
              part consommée à la part du mois écoulée. C’est ce qui transforme un relevé en budget.
            </p>
            <div className="inline" style={{ marginTop: 12 }}>
              <button type="button" className="button button-primary" onClick={() => setSuggesting(true)}>
                Partir de mes habitudes
              </button>
              <button type="button" className="button" onClick={() => setForm(true)}>
                Saisir un montant
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-3" style={{ marginBottom: 18 }}>
              <div>
                <div className="tile-label">Prévu</div>
                <div className="tile-value amount">{envelopes.totalPlanned.roundedToUnit.format()}</div>
              </div>
              <div>
                <div className="tile-label">Dépensé</div>
                <div className="tile-value amount">{envelopes.totalSpent.roundedToUnit.format()}</div>
              </div>
              <div>
                <div className="tile-label">Reste</div>
                <div
                  className={`tile-value amount ${envelopes.totalRemaining.isNegative ? 'critical' : 'positive'}`}
                >
                  {envelopes.totalRemaining.roundedToUnit.format()}
                </div>
              </div>
            </div>

            {envelopes.envelopes.map((envelope) => (
              <EnvelopeRow
                key={envelope.category}
                envelope={envelope}
                onRemove={() =>
                  confirm(`Supprimer l’enveloppe « ${envelope.label} » ?`, () =>
                    removeCategoryBudget(envelope.category),
                  )
                }
              />
            ))}

            {envelopes.unbudgeted.isPositive && (
              <p className="rationale" style={{ marginTop: 14 }}>
                {envelopes.unbudgeted.roundedToUnit.format()} de dépenses hors enveloppe ce mois-ci. Faute de
                montant décidé, elles sont extrapolées au rythme observé — un poste sans budget n’a aucune raison
                de s’arrêter là où il en est.
              </p>
            )}
          </>
        )}
      </Card>

      {form && (
        <EnvelopeForm
          currency={profile.currency}
          existing={envelopes.envelopes.map((envelope) => envelope.category)}
          onClose={() => setForm(false)}
          onSubmit={(category, limit) => setCategoryBudget({ category, limit })}
        />
      )}
      {suggesting && <SuggestionDialog onClose={() => setSuggesting(false)} />}
      {confirmNode}
    </>
  );
}

function EnvelopeRow({ envelope, onRemove }: { envelope: Envelope; onRemove: () => void }) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <span style={{ fontWeight: 550 }}>{envelope.label}</span>
          <span
            className="badge"
            style={{
              marginLeft: 8,
              background: 'transparent',
              color: ENVELOPE_STATE_TONE[envelope.state],
              border: `1px solid ${ENVELOPE_STATE_TONE[envelope.state]}`,
            }}
          >
            {ENVELOPE_STATE_LABELS[envelope.state]}
          </span>
        </div>
        <div className="inline">
          <span className="amount" style={{ fontWeight: 600 }}>
            {envelope.spent.roundedToUnit.format()}
            <span className="muted" style={{ fontWeight: 400 }}> / {envelope.planned.roundedToUnit.format()}</span>
          </span>
          <button type="button" className="button button-ghost" aria-label={`Supprimer ${envelope.label}`} onClick={onRemove}>
            ✕
          </button>
        </div>
      </div>

      <ProgressBar value={envelope.consumed} tone={ENVELOPE_STATE_TONE[envelope.state]} />

      <div className="inline" style={{ justifyContent: 'space-between', marginTop: 5 }}>
        <span className="tile-note">
          {Math.round(envelope.consumed * 100)} % consommés · {Math.round(envelope.monthProgress * 100)} % du mois
          écoulé
        </span>
        <span className="tile-note amount">
          {envelope.remaining.isNegative
            ? `dépassement de ${envelope.remaining.absolute.roundedToUnit.format()}`
            : `${envelope.perRemainingDay.roundedToUnit.format()} par jour restant`}
        </span>
      </div>
    </div>
  );
}

function EnvelopeForm({
  currency,
  existing,
  onClose,
  onSubmit,
}: {
  currency: Money['currency'];
  existing: readonly ExpenseCategoryId[];
  onClose: () => void;
  onSubmit: (category: ExpenseCategoryId, limit: Money) => void;
}) {
  const available = VARIABLE_CATEGORY_IDS.filter((category) => !existing.includes(category));
  const [category, setCategory] = useState<ExpenseCategoryId>(available[0] ?? 'variable.groceries');
  const [amount, setAmount] = useState('');
  const parsed = parseAmount(amount, currency);

  return (
    <Modal title="Nouvelle enveloppe" onClose={onClose}>
      <Field label="Catégorie">
        {(id) => (
          <select id={id} value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategoryId)}>
            {available.map((entry) => (
              <option key={entry} value={entry}>
                {categoryLabel(entry)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Montant mensuel" hint="Approximatif suffit : un budget se corrige, l’absence de budget non.">
        {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
      </Field>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!parsed || !parsed.isPositive}
          onClick={() => {
            if (!parsed) return;
            onSubmit(category, parsed);
            onClose();
          }}
        >
          Créer
        </button>
      </div>
    </Modal>
  );
}

/**
 * Propositions fondées sur les mois passés.
 *
 * Demander « combien voulez-vous consacrer aux courses ? » sans repère produit un chiffre
 * inventé, abandonné au bout de trois semaines. Partir de sa médiane réelle donne un
 * budget qu'on tient déjà — et qu'on peut ensuite décider de resserrer.
 */
function SuggestionDialog({ onClose }: { onClose: () => void }) {
  const { profile, analysis, setCategoryBudget } = useStore();
  const [applied, setApplied] = useState<ExpenseCategoryId[]>([]);

  const suggestions = useMemo(() => {
    const months = lastMonths(addMonths(analysis.period, -1), 6);
    const already = new Set(profile.categoryBudgets.map((budget) => budget.category));
    return suggestEnvelopes(profile, months).filter(
      (entry) => !already.has(entry.category) && !applied.includes(entry.category),
    );
  }, [profile, analysis.period, applied]);

  return (
    <Modal title="Enveloppes proposées" onClose={onClose}>
      {suggestions.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Pas assez d’historique pour proposer quoi que ce soit. Il faut au moins deux mois de dépenses dans une
          catégorie pour que sa médiane veuille dire quelque chose — saisissez vos enveloppes à la main en
          attendant, ou importez un relevé.
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Ces montants sont vos <strong>médianes réelles</strong> des six derniers mois. Ce sont donc des budgets
            que vous tenez déjà ; à vous de les resserrer ensuite si vous le souhaitez.
          </p>
          {suggestions.map((entry) => (
            <div className="row" key={entry.category}>
              <div className="row-main">
                <div className="row-title">{categoryLabel(entry.category)}</div>
                <div className="row-subtitle">médiane sur {entry.basis} mois</div>
              </div>
              <div className="row-amount amount">{entry.suggested.format()}</div>
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  setCategoryBudget({ category: entry.category, limit: entry.suggested });
                  setApplied((current) => [...current, entry.category]);
                }}
              >
                Adopter
              </button>
            </div>
          ))}
          <div className="modal-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                for (const entry of suggestions) {
                  setCategoryBudget({ category: entry.category, limit: entry.suggested });
                }
                onClose();
              }}
            >
              Tout adopter
            </button>
          </div>
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Modal>
  );
}
