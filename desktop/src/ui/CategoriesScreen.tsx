import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import {
  BUILTIN_CATEGORIES,
  allCategories,
  categoryLabel,
  type CategoryInfo,
  type ExpenseCategoryId,
} from '../core/categories';
import type { CustomCategory } from '../core/model';
import { useStore } from '../state/store';
import { Card, Field, Modal, MoneyInput, ProgressBar, parseAmount } from './components';

/** Palette proposée. Rien n'empêche une autre couleur, mais celles-ci se distinguent
 *  entre elles, y compris en cas de déficience de la vision des couleurs. */
const SWATCHES = [
  '#4c9aff', '#6ea8fe', '#56d4dd', '#3fb950', '#7ee787', '#d29922',
  '#f0883e', '#ff7b72', '#db61a2', '#a371f7', '#d2a8ff', '#8b949e',
];

const ICONS = [
  '🏠', '🛒', '🍽️', '🚆', '⛽', '🎬', '👕', '⚕️', '🎁', '✈️', '📚', '👶',
  '🐾', '💇', '🔁', '💡', '📱', '🛡️', '🏛️', '💳', '🧰', '🎓', '🧸', '•',
];

/**
 * Gestion des catégories.
 *
 * Le catalogue livré couvre le cas courant ; il ne couvre pas tout le monde. On peut donc
 * en créer, en renommer, en recolorer, et en masquer — mais jamais en supprimer une sans
 * dire où vont les transactions qui l'utilisaient : des montants disparaîtraient des
 * totaux sans que personne ne s'en aperçoive.
 */
export function CategoriesScreen() {
  const { profile, analysis, saveCategory, removeCategory, setCategoryBudget, removeCategoryBudget } = useStore();
  const [form, setForm] = useState<CategoryInfo | true | null>(null);
  const [deleting, setDeleting] = useState<CategoryInfo | null>(null);

  const categories = useMemo(() => {
    const spentByCategory = new Map(
      analysis.summary.categoryTotals.map((total) => [total.category, total.amount]),
    );
    const budgets = new Map(profile.categoryBudgets.map((budget) => [budget.category, budget.limit]));

    return allCategories()
      .map((info) => ({
        info,
        spent: spentByCategory.get(info.id) ?? Money.zero(profile.currency),
        budget: budgets.get(info.id) ?? null,
      }))
      .sort((a, b) => {
        if (a.info.kind !== b.info.kind) return a.info.kind === 'fixed' ? -1 : 1;
        return a.info.label.localeCompare(b.info.label, 'fr');
      });
  }, [profile, analysis]);

  const fixed = categories.filter((entry) => entry.info.kind === 'fixed');
  const variable = categories.filter((entry) => entry.info.kind === 'variable');

  function section(title: string, entries: typeof categories, note: string) {
    return (
      <Card title={title}>
        <p className="section-note">{note}</p>
        {entries.map(({ info, spent, budget }) => (
          <div className="row" key={info.id} style={{ alignItems: 'flex-start' }}>
            <span
              aria-hidden="true"
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                display: 'grid',
                placeItems: 'center',
                background: `${info.color}22`,
                border: `1px solid ${info.color}`,
                flex: 'none',
              }}
            >
              {info.icon}
            </span>
            <div className="row-main">
              <div className="row-title">
                {info.label}
                {info.custom && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    créée
                  </span>
                )}
              </div>
              <div className="row-subtitle">
                {spent.isPositive ? `${spent.roundedToUnit.format()} ce mois-ci` : 'Aucune dépense ce mois-ci'}
                {budget && ` · plafond ${budget.roundedToUnit.format()}`}
                {info.kind === 'variable' && !info.essential && ' · non essentielle'}
              </div>
              {budget?.isPositive && (
                <div style={{ marginTop: 6, maxWidth: 260 }}>
                  <ProgressBar
                    value={spent.ratioTo(budget) ?? 0}
                    tone={spent.greaterThan(budget) ? 'var(--critical)' : 'var(--accent)'}
                  />
                </div>
              )}
            </div>
            <button type="button" className="button button-small" onClick={() => setForm(info)}>
              Modifier
            </button>
            <button
              type="button"
              className="button button-ghost"
              aria-label={`Supprimer ${info.label}`}
              onClick={() => setDeleting(info)}
            >
              ✕
            </button>
          </div>
        ))}
      </Card>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Catégories</h1>
          <p className="page-subtitle">Nom, couleur, icône et plafond — tout se modifie</p>
        </div>
        <div className="inline">
          <button type="button" className="button button-primary" onClick={() => setForm(true)}>
            + Nouvelle catégorie
          </button>
        </div>
      </header>

      <div className="stack">
        {section(
          'Charges fixes',
          fixed,
          'Des dépenses qui tombent d’elles-mêmes, au même montant. Elles ne sont jamais proposées à la coupe automatiquement : les réduire suppose une résiliation ou une renégociation, pas un effort de volonté.',
        )}
        {section(
          'Dépenses variables',
          variable,
          'Celles sur lesquelles vous décidez au jour le jour. Un plafond en fait une enveloppe, suivie en continu par rapport au calendrier du mois.',
        )}
      </div>

      {form && (
        <CategoryForm
          initial={form === true ? null : form}
          onClose={() => setForm(null)}
          onSubmit={(category, budget) => {
            saveCategory(category);
            if (budget && budget.isPositive) setCategoryBudget({ category: category.id, limit: budget });
            else removeCategoryBudget(category.id);
          }}
        />
      )}

      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={(reassignTo) => {
            if (BUILTIN_CATEGORIES[deleting.id]) {
              // Une catégorie livrée n'est pas supprimée mais masquée : des transactions
              // anciennes peuvent la référencer, et un profil exporté ailleurs aussi.
              saveCategory({
                id: deleting.id,
                label: deleting.label,
                kind: deleting.kind,
                essential: deleting.essential,
                compressibility: deleting.compressibility,
                color: deleting.color,
                icon: deleting.icon,
                hidden: true,
              });
            }
            removeCategory(deleting.id, reassignTo);
          }}
        />
      )}
    </>
  );
}

function CategoryForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial: CategoryInfo | null;
  onClose: () => void;
  onSubmit: (category: CustomCategory, budget: Money | null) => void;
}) {
  const { profile } = useStore();
  const currency = profile.currency;
  const existingBudget = profile.categoryBudgets.find((budget) => budget.category === initial?.id);

  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<'fixed' | 'variable'>(initial?.kind ?? 'variable');
  const [essential, setEssential] = useState(initial?.essential ?? false);
  const [compressibility, setCompressibility] = useState(initial?.compressibility ?? 0.5);
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]!);
  const [icon, setIcon] = useState(initial?.icon ?? '•');
  const [budget, setBudget] = useState(existingBudget ? String(existingBudget.limit.units) : '');

  const trimmed = label.trim();
  const duplicate = allCategories().some(
    (entry) => entry.id !== initial?.id && entry.label.toLowerCase() === trimmed.toLowerCase(),
  );
  const error = trimmed === '' ? 'Un intitulé est obligatoire.' : duplicate ? 'Une catégorie porte déjà ce nom.' : null;

  return (
    <Modal title={initial ? `Modifier « ${initial.label} »` : 'Nouvelle catégorie'} onClose={onClose}>
      <Field label="Intitulé">
        {(id) => (
          <input
            id={id}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Jardinage"
            autoFocus
          />
        )}
      </Field>

      <div className="field-row">
        <Field label="Nature" hint={initial ? 'Changer la nature déplace la catégorie de section.' : undefined}>
          {(id) => (
            <select id={id} value={kind} onChange={(event) => setKind(event.target.value as 'fixed' | 'variable')}>
              <option value="variable">Dépense variable</option>
              <option value="fixed">Charge fixe</option>
            </select>
          )}
        </Field>
        <Field label="Plafond mensuel" hint="Facultatif. Renseigné, il devient une enveloppe suivie.">
          {(id) => <MoneyInput id={id} value={budget} currency={currency} onChange={setBudget} />}
        </Field>
      </div>

      <Field label="Icône">
        {() => (
          <div className="swatch-grid">
            {ICONS.map((entry) => (
              <button
                key={entry}
                type="button"
                className="swatch"
                aria-pressed={icon === entry}
                aria-label={`Icône ${entry}`}
                style={{ background: 'var(--surface-raised)', fontSize: 15 }}
                onClick={() => setIcon(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="Couleur">
        {() => (
          <div className="swatch-grid">
            {SWATCHES.map((entry) => (
              <button
                key={entry}
                type="button"
                className="swatch"
                aria-pressed={color === entry}
                aria-label={`Couleur ${entry}`}
                style={{ background: entry }}
                onClick={() => setColor(entry)}
              />
            ))}
          </div>
        )}
      </Field>

      <label className="inline" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={essential}
          onChange={(event) => setEssential(event.target.checked)}
          style={{ width: 16 }}
        />
        <span>Dépense essentielle</span>
      </label>
      <p className="field-hint" style={{ marginBottom: 14 }}>
        Une catégorie essentielle entre dans le calcul du fonds d’urgence et n’est jamais proposée à la
        réduction : en cas de coup dur, les loisirs s’arrêtent, le loyer non.
      </p>

      {kind === 'variable' && (
        <Field
          label={`Marge de réduction réaliste : ${Math.round(compressibility * 100)} %`}
          hint="Utilisée par « Optimiser mon budget » pour ne proposer que des coupes tenables."
        >
          {(id) => (
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(compressibility * 100)}
              onChange={(event) => setCompressibility(Number(event.target.value) / 100)}
            />
          )}
        </Field>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={error !== null}
          onClick={() => {
            onSubmit(
              {
                // Un identifiant créé une fois pour toutes : renommer la catégorie ne doit
                // pas déclasser les transactions qui la référencent.
                id: initial?.id ?? `custom.${crypto.randomUUID().slice(0, 8)}`,
                label: trimmed,
                kind,
                essential,
                compressibility,
                color,
                icon,
              },
              parseAmount(budget, currency),
            );
            onClose();
          }}
        >
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </Modal>
  );
}

function DeleteCategoryDialog({
  category,
  onClose,
  onConfirm,
}: {
  category: CategoryInfo;
  onClose: () => void;
  onConfirm: (reassignTo: ExpenseCategoryId) => void;
}) {
  const { profile } = useStore();
  const affected = profile.transactions.filter((transaction) => transaction.category === category.id).length;
  const affectedExpenses = profile.recurringExpenses.filter((expense) => expense.category === category.id).length;

  const alternatives = allCategories().filter(
    (entry) => entry.id !== category.id && entry.kind === category.kind,
  );
  const [target, setTarget] = useState<ExpenseCategoryId>(
    alternatives[0]?.id ?? (category.kind === 'fixed' ? 'fixed.otherFixed' : 'variable.otherVariable'),
  );

  return (
    <Modal title={`Supprimer « ${category.label} » ?`} onClose={onClose}>
      <p className="muted">
        {affected + affectedExpenses === 0 ? (
          <>Aucune transaction ni charge n’utilise cette catégorie.</>
        ) : (
          <>
            {affected > 0 && `${affected} transaction${affected > 1 ? 's' : ''}`}
            {affected > 0 && affectedExpenses > 0 && ' et '}
            {affectedExpenses > 0 && `${affectedExpenses} charge${affectedExpenses > 1 ? 's' : ''} récurrente${affectedExpenses > 1 ? 's' : ''}`}
            {' '}y {affected + affectedExpenses > 1 ? 'sont' : 'est'} rattaché
            {affected + affectedExpenses > 1 ? 's' : ''}. Rien n’est supprimé : tout est reclassé dans la
            catégorie que vous choisissez ci-dessous.
          </>
        )}
      </p>

      <Field label="Reclasser dans">
        {(id) => (
          <select id={id} value={target} onChange={(event) => setTarget(event.target.value)}>
            {alternatives.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <p className="field-hint">
        {BUILTIN_CATEGORIES[category.id]
          ? 'Cette catégorie est livrée avec l’application : elle sera masquée plutôt que détruite, et pourra revenir.'
          : 'Cette catégorie a été créée par vous : elle disparaîtra définitivement.'}
      </p>

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={alternatives.length === 0}
          onClick={() => {
            onConfirm(target);
            onClose();
          }}
        >
          Supprimer et reclasser dans « {categoryLabel(target)} »
        </button>
      </div>
    </Modal>
  );
}
