import { useState } from 'react';
import { Money } from '../core/money';
import { FIXED_CATEGORY_IDS, INCOME_CATEGORIES, INCOME_LABELS, categoryLabel, type ExpenseCategoryId, type IncomeCategory } from '../core/categories';
import { FREQUENCIES, FREQUENCY_LABELS, monthlyEquivalent, type Frequency } from '../core/frequency';
import type { IncomeSource, RecurringExpense } from '../core/model';
import { useStore } from '../state/store';
import { Card, EmptyState, Field, Modal, MoneyInput, parseAmount, useConfirm } from './components';
import { EnvelopesCard } from './EnvelopesCard';
import { IncomeRangeCard } from './IncomeRangeCard';

export function BudgetScreen() {
  const { profile, analysis, addIncome, updateIncome, removeIncome, addExpense, updateExpense, removeExpense } =
    useStore();
  // `true` pour une création, l'entité elle-même pour une modification.
  const [incomeForm, setIncomeForm] = useState<IncomeSource | true | null>(null);
  const [expenseForm, setExpenseForm] = useState<RecurringExpense | true | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const { summary, allocation } = analysis;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Budget</h1>
          <p className="page-subtitle">Vos revenus, vos charges, et la destination de ce qui reste</p>
        </div>
      </header>

      <div className="stack">
        <IncomeRangeCard />

        <Card
          title="Revenus"
          action={
            <button type="button" className="button button-small" onClick={() => setIncomeForm(true)}>
              Ajouter
            </button>
          }
        >
          {profile.incomes.length === 0 ? (
            <EmptyState
              title="Aucun revenu enregistré"
              message="Tout part de là : sans revenu déclaré, aucun budget ne peut être établi."
              action={
                <button type="button" className="button button-primary" onClick={() => setIncomeForm(true)}>
                  Ajouter un revenu
                </button>
              }
            />
          ) : (
            <>
              {profile.incomes.map((income) => (
                <div className="row" key={income.id}>
                  <div className="row-main">
                    <div className="row-title">{income.name}</div>
                    <div className="row-subtitle">
                      {income.amount.format()} · {FREQUENCY_LABELS[income.frequency].toLowerCase()} ·{' '}
                      {INCOME_LABELS[income.category]}
                      {income.dayOfMonth ? ` · le ${income.dayOfMonth}` : ''}
                      {income.variable && (
                        <span className="badge" style={{ marginLeft: 8 }}>
                          irrégulier
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="row-amount amount">
                    {monthlyEquivalent(income.amount, income.frequency).roundedTo(2).format()}
                    <span className="tertiary" style={{ fontWeight: 400 }}> /mois</span>
                  </div>
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => setIncomeForm(income)}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Supprimer ${income.name}`}
                    onClick={() => confirm(`Supprimer le revenu « ${income.name} » ?`, () => removeIncome(income.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="row" style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                <div className="row-main">Total mensuel</div>
                <div className="row-amount amount positive">{summary.income.roundedTo(2).format()}</div>
                <span style={{ width: 33 }} />
              </div>
            </>
          )}
        </Card>

        <Card
          title="Charges récurrentes"
          action={
            <button type="button" className="button button-small" onClick={() => setExpenseForm(true)}>
              Ajouter
            </button>
          }
        >
          {profile.recurringExpenses.length === 0 ? (
            <EmptyState
              title="Aucune charge récurrente"
              message="Loyer, énergie, assurances, abonnements : ce sont elles qui déterminent votre marge de manœuvre réelle."
              action={
                <button type="button" className="button button-primary" onClick={() => setExpenseForm(true)}>
                  Ajouter une charge
                </button>
              }
            />
          ) : (
            <>
              {profile.recurringExpenses.map((expense) => (
                <div className="row" key={expense.id}>
                  <div className="row-main">
                    <div className="row-title">
                      {expense.name}
                      {expense.subscription && (
                        <span className="badge" style={{ marginLeft: 8 }}>
                          abonnement
                        </span>
                      )}
                    </div>
                    <div className="row-subtitle">
                      {expense.amount.format()} · {FREQUENCY_LABELS[expense.frequency].toLowerCase()} ·{' '}
                      {categoryLabel(expense.category)} · le {expense.dayOfMonth}
                    </div>
                  </div>
                  <div className="row-amount amount">
                    {monthlyEquivalent(expense.amount, expense.frequency).roundedTo(2).format()}
                    <span className="tertiary" style={{ fontWeight: 400 }}> /mois</span>
                  </div>
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => setExpenseForm(expense)}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Supprimer ${expense.name}`}
                    onClick={() => confirm(`Supprimer la charge « ${expense.name} » ?`, () => removeExpense(expense.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="row" style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                <div className="row-main">Total mensuel</div>
                <div className="row-amount amount">{summary.fixedExpenses.roundedTo(2).format()}</div>
                <span style={{ width: 33 }} />
              </div>
            </>
          )}
        </Card>

        <EnvelopesCard />

        <Card title="Où va le disponible">
          {allocation.lines.length === 0 ? (
            <p className="muted">
              Aucun disponible à répartir ce mois-ci{summary.disposable.isNegative ? ' : le budget est déficitaire.' : '.'}
            </p>
          ) : (
            <>
              {allocation.lines.map((line, index) => (
                <div className="row" key={`${line.bucket}-${index}`} style={{ alignItems: 'flex-start' }}>
                  <div className="row-main">
                    <div className="row-title">{line.label}</div>
                    <div className="rationale">{line.rationale}</div>
                  </div>
                  <div className="row-amount amount">{line.amount.roundedToUnit.format()}</div>
                </div>
              ))}
              {allocation.skippedSteps.map((step) => (
                <p className="rationale" key={step} style={{ marginTop: 12 }}>
                  ⏸ {step}
                </p>
              ))}
              <p className="rationale" style={{ marginTop: 14 }}>
                Cette répartition suit un ordre de <strong>risque décroissant</strong> : sécuriser, éteindre ce
                qui coûte cher, construire, puis seulement investir. Ce n’est pas une règle toute faite du type
                50/30/20 — elle dépend de votre situation réelle.
              </p>
            </>
          )}
        </Card>
      </div>

      {incomeForm && (
        <IncomeForm
          initial={incomeForm === true ? null : incomeForm}
          onClose={() => setIncomeForm(null)}
          onSubmit={(draft) => {
            if (incomeForm === true) addIncome(draft);
            else updateIncome({ ...incomeForm, ...draft });
          }}
          currency={profile.currency}
        />
      )}
      {expenseForm && (
        <ExpenseForm
          initial={expenseForm === true ? null : expenseForm}
          onClose={() => setExpenseForm(null)}
          onSubmit={(draft) => {
            if (expenseForm === true) addExpense(draft);
            else updateExpense({ ...expenseForm, ...draft });
          }}
          currency={profile.currency}
        />
      )}
      {confirmNode}
    </>
  );
}

/** Montant prêt à être réédité : « 1200 » plutôt que « 1200,00 € ». */
function editable(amount: Money | undefined): string {
  return amount ? String(amount.units) : '';
}

function IncomeForm({
  initial,
  onClose,
  onSubmit,
  currency,
}: {
  initial: IncomeSource | null;
  onClose: () => void;
  onSubmit: (income: Omit<IncomeSource, 'id'>) => void;
  currency: Money['currency'];
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(editable(initial?.amount));
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [category, setCategory] = useState<IncomeCategory>(initial?.category ?? 'salary');
  const [variable, setVariable] = useState(initial?.variable ?? false);
  const [minAmount, setMinAmount] = useState(editable(initial?.minAmount));
  const [maxAmount, setMaxAmount] = useState(editable(initial?.maxAmount));
  const [dayOfMonth, setDayOfMonth] = useState(String(initial?.dayOfMonth ?? 28));

  const parsed = parseAmount(amount, currency);
  const monthly = parsed ? monthlyEquivalent(parsed, frequency) : null;
  const parsedMin = parseAmount(minAmount, currency);
  const parsedMax = parseAmount(maxAmount, currency);

  return (
    <Modal title={initial ? `Modifier « ${initial.name} »` : 'Nouveau revenu'} onClose={onClose}>
      <Field label="Intitulé">
        {(id) => <input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="Salaire" />}
      </Field>
      <div className="field-row">
        <Field label="Montant">
          {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
        </Field>
        <Field label="Périodicité">
          {(id) => (
            <select id={id} value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
              {FREQUENCIES.filter((entry) => entry !== 'oneOff').map((entry) => (
                <option key={entry} value={entry}>
                  {FREQUENCY_LABELS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="field-row">
        <Field label="Nature">
          {(id) => (
            <select id={id} value={category} onChange={(event) => setCategory(event.target.value as IncomeCategory)}>
              {INCOME_CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {INCOME_LABELS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Jour de réception" hint="Décide de la forme de la courbe de trésorerie">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.value)}
            />
          )}
        </Field>
      </div>
      <label className="inline" style={{ marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={variable}
          onChange={(event) => setVariable(event.target.checked)}
          style={{ width: 16 }}
        />
        <span>Revenu irrégulier (freelance, primes, heures supplémentaires)</span>
      </label>

      {variable ? (
        <>
          <p className="field-hint" style={{ marginBottom: 12 }}>
            Le montant ci-dessus est votre mois <strong>typique</strong>. Indiquez l’amplitude : le plan se calera
            sur le mois faible, et les bons mois dégageront un surplus au lieu que les mauvais creusent un trou.
          </p>
          <div className="field-row">
            <Field label="Mois faible" hint="Le plus bas que vous ayez connu, hors accident">
              {(id) => <MoneyInput id={id} value={minAmount} currency={currency} onChange={setMinAmount} />}
            </Field>
            <Field label="Mois fort">
              {(id) => <MoneyInput id={id} value={maxAmount} currency={currency} onChange={setMaxAmount} />}
            </Field>
          </div>
          <p className="field-hint">
            Laissez vide et j’appliquerai ± 20 %. Dès trois mois de revenus saisis, c’est votre historique réel
            qui remplacera cette fourchette.
          </p>
        </>
      ) : null}

      {monthly && (
        <p className="rationale">
          Équivalent mensuel : <strong className="amount">{monthly.roundedTo(2).format()}</strong>
        </p>
      )}

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
            onSubmit({
              name: name.trim() || INCOME_LABELS[category],
              amount: parsed,
              frequency,
              category,
              variable,
              minAmount: variable && parsedMin ? parsedMin : undefined,
              maxAmount: variable && parsedMax ? parsedMax : undefined,
              dayOfMonth: Math.min(Math.max(Number(dayOfMonth) || 28, 1), 31),
              active: initial?.active ?? true,
            });
            onClose();
          }}
        >
          {initial ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </Modal>
  );
}

function ExpenseForm({
  initial,
  onClose,
  onSubmit,
  currency,
}: {
  initial: RecurringExpense | null;
  onClose: () => void;
  onSubmit: (expense: Omit<RecurringExpense, 'id'>) => void;
  currency: Money['currency'];
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(editable(initial?.amount));
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [category, setCategory] = useState<ExpenseCategoryId>(initial?.category ?? 'fixed.rent');
  const [day, setDay] = useState(String(initial?.dayOfMonth ?? 5));
  const [subscription, setSubscription] = useState(initial?.subscription ?? false);

  const parsed = parseAmount(amount, currency);
  const monthly = parsed ? monthlyEquivalent(parsed, frequency) : null;

  return (
    <Modal title={initial ? `Modifier « ${initial.name} »` : 'Nouvelle charge récurrente'} onClose={onClose}>
      <Field label="Intitulé">
        {(id) => <input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="Loyer" />}
      </Field>
      <div className="field-row">
        <Field label="Montant">
          {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
        </Field>
        <Field label="Périodicité">
          {(id) => (
            <select id={id} value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
              {FREQUENCIES.filter((entry) => entry !== 'oneOff').map((entry) => (
                <option key={entry} value={entry}>
                  {FREQUENCY_LABELS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="field-row">
        <Field label="Catégorie">
          {(id) => (
            <select
              id={id}
              value={category}
              onChange={(event) => setCategory(event.target.value as ExpenseCategoryId)}
            >
              {FIXED_CATEGORY_IDS.map((entry) => (
                <option key={entry} value={entry}>
                  {categoryLabel(entry)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Jour de prélèvement" hint="Sert à placer l’échéance dans la trésorerie">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={31}
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          )}
        </Field>
      </div>
      <label className="inline" style={{ marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={subscription}
          onChange={(event) => setSubscription(event.target.checked)}
          style={{ width: 16 }}
        />
        <span>C’est un abonnement</span>
      </label>

      {monthly && (
        <p className="rationale">
          Équivalent mensuel : <strong className="amount">{monthly.roundedTo(2).format()}</strong>
          {frequency === 'annual' && ' — une charge annuelle est étalée sur douze mois, pas imputée d’un coup.'}
        </p>
      )}

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
            onSubmit({
              name: name.trim() || categoryLabel(category),
              amount: parsed,
              frequency,
              category,
              dayOfMonth: Math.min(Math.max(Number(day) || 1, 1), 31),
              subscription,
              active: initial?.active ?? true,
            });
            onClose();
          }}
        >
          {initial ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </Modal>
  );
}
