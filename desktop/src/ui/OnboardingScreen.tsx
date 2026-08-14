import { useState } from 'react';
import { Money } from '../core/money';
import { FIXED_CATEGORY_IDS, categoryLabel, type ExpenseCategoryId } from '../core/categories';
import { FREQUENCY_LABELS, monthlyEquivalent, type Frequency } from '../core/frequency';
import { useStore } from '../state/store';
import { Field, MoneyInput, parseAmount } from './components';

interface DraftExpense {
  readonly name: string;
  readonly amount: Money;
  readonly category: ExpenseCategoryId;
  readonly frequency: Frequency;
}

const STEPS = ['Revenus', 'Charges', 'Épargne', 'Objectif'] as const;

/**
 * Première mise en route.
 *
 * Quatre étapes, dans l'ordre où l'information devient utile : sans revenu, rien ne se
 * calcule ; sans charges, le disponible est faux ; l'épargne conditionne le fonds
 * d'urgence ; l'objectif est facultatif et peut attendre.
 */
export function OnboardingScreen() {
  const { profile, addIncome, addExpense, setBalances, addGoal } = useStore();
  const currency = profile.currency;

  const [step, setStep] = useState(0);
  const [incomeName, setIncomeName] = useState('Salaire');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeFrequency, setIncomeFrequency] = useState<Frequency>('monthly');
  const [incomeVariable, setIncomeVariable] = useState(false);
  const [incomeMin, setIncomeMin] = useState('');
  const [incomeMax, setIncomeMax] = useState('');

  const [expenses, setExpenses] = useState<DraftExpense[]>([]);
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryId>('fixed.rent');

  const [savings, setSavings] = useState('');

  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');

  const parsedIncome = parseAmount(incomeAmount, currency);
  const monthlyIncome = parsedIncome ? monthlyEquivalent(parsedIncome, incomeFrequency) : null;
  const monthlyExpenses = Money.sum(
    expenses.map((expense) => monthlyEquivalent(expense.amount, expense.frequency)),
    currency,
  );

  function finish() {
    if (parsedIncome) {
      addIncome({
        name: incomeName.trim() || 'Salaire',
        amount: parsedIncome,
        frequency: incomeFrequency,
        category: 'salary',
        variable: incomeVariable,
        minAmount: incomeVariable ? (parseAmount(incomeMin, currency) ?? undefined) : undefined,
        maxAmount: incomeVariable ? (parseAmount(incomeMax, currency) ?? undefined) : undefined,
        active: true,
      });
    }
    for (const expense of expenses) {
      addExpense({
        name: expense.name,
        amount: expense.amount,
        frequency: expense.frequency,
        category: expense.category,
        dayOfMonth: 5,
        subscription: expense.category === 'fixed.subscriptions',
        active: true,
      });
    }
    const parsedSavings = parseAmount(savings, currency);
    if (parsedSavings) setBalances(parsedSavings, Money.zero(currency));

    const parsedGoal = parseAmount(goalTarget, currency);
    if (parsedGoal && parsedGoal.isPositive) {
      addGoal({
        name: goalName.trim() || 'Objectif',
        kind: 'purchase',
        target: parsedGoal,
        current: Money.zero(currency),
        targetDate: goalDate || undefined,
        priority: 1,
      });
    }
  }

  return (
    <div className="onboarding">
      <div className="brand" style={{ padding: '0 0 20px' }}>
        <span className="brand-mark" />
        Quantara
      </div>

      <div className="steps">
        {STEPS.map((label, index) => (
          <span key={label} className={`step ${index <= step ? 'done' : ''}`} />
        ))}
      </div>

      <div className="card">
        <h1 className="page-title" style={{ fontSize: 20 }}>
          {STEPS[step]}
        </h1>

        {step === 0 && (
          <>
            <p className="muted">
              Commençons par ce qui entre. Vous pourrez ajouter d’autres sources — allocations, activité
              indépendante, revenus locatifs — juste après.
            </p>
            <Field label="Intitulé">
              {(id) => <input id={id} value={incomeName} onChange={(event) => setIncomeName(event.target.value)} />}
            </Field>
            <div className="field-row">
              <Field label="Montant net">
                {(id) => (
                  <MoneyInput id={id} value={incomeAmount} currency={currency} onChange={setIncomeAmount} autoFocus />
                )}
              </Field>
              <Field label="Périodicité">
                {(id) => (
                  <select
                    id={id}
                    value={incomeFrequency}
                    onChange={(event) => setIncomeFrequency(event.target.value as Frequency)}
                  >
                    {(['monthly', 'weekly', 'biweekly', 'quarterly', 'annual'] as Frequency[]).map((entry) => (
                      <option key={entry} value={entry}>
                        {FREQUENCY_LABELS[entry]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <label className="inline" style={{ margin: '4px 0 10px' }}>
              <input
                type="checkbox"
                checked={incomeVariable}
                onChange={(event) => setIncomeVariable(event.target.checked)}
                style={{ width: 16 }}
              />
              <span>Mon revenu varie d’un mois à l’autre</span>
            </label>

            {incomeVariable && (
              <>
                <p className="field-hint" style={{ marginBottom: 12 }}>
                  Le montant ci-dessus devient votre mois <strong>typique</strong>. Indiquez l’amplitude : le plan
                  se calera sur le mois faible, pour qu’un mois creux ne casse pas tout.
                </p>
                <div className="field-row">
                  <Field label="Mois faible">
                    {(id) => <MoneyInput id={id} value={incomeMin} currency={currency} onChange={setIncomeMin} />}
                  </Field>
                  <Field label="Mois fort">
                    {(id) => <MoneyInput id={id} value={incomeMax} currency={currency} onChange={setIncomeMax} />}
                  </Field>
                </div>
              </>
            )}

            {monthlyIncome && (
              <p className="rationale">
                Soit <strong className="amount">{monthlyIncome.roundedTo(2).format()}</strong> par mois
                {incomeVariable ? ' pour un mois typique' : ''}. Une somme hebdomadaire est ramenée au mois par
                52 semaines ÷ 12, jamais par « 4 semaines » — l’écart atteindrait un mois de revenu par an.
              </p>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <p className="muted">
              Les charges qui tombent tous les mois, ou moins souvent. Une prime d’assurance annuelle sera
              automatiquement étalée sur douze mois.
            </p>
            <div className="field-row">
              <Field label="Intitulé">
                {(id) => (
                  <input
                    id={id}
                    value={expenseName}
                    onChange={(event) => setExpenseName(event.target.value)}
                    placeholder="Loyer"
                  />
                )}
              </Field>
              <Field label="Montant">
                {(id) => (
                  <MoneyInput id={id} value={expenseAmount} currency={currency} onChange={setExpenseAmount} />
                )}
              </Field>
            </div>
            <Field label="Catégorie">
              {(id) => (
                <select
                  id={id}
                  value={expenseCategory}
                  onChange={(event) => setExpenseCategory(event.target.value as ExpenseCategoryId)}
                >
                  {FIXED_CATEGORY_IDS.map((entry) => (
                    <option key={entry} value={entry}>
                      {categoryLabel(entry)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              className="button"
              disabled={!parseAmount(expenseAmount, currency)}
              onClick={() => {
                const parsed = parseAmount(expenseAmount, currency);
                if (!parsed) return;
                setExpenses((current) => [
                  ...current,
                  {
                    name: expenseName.trim() || categoryLabel(expenseCategory),
                    amount: parsed,
                    category: expenseCategory,
                    frequency: 'monthly',
                  },
                ]);
                setExpenseName('');
                setExpenseAmount('');
              }}
            >
              Ajouter cette charge
            </button>

            {expenses.length > 0 && (
              <div style={{ marginTop: 18 }}>
                {expenses.map((expense, index) => (
                  <div className="row" key={`${expense.name}-${index}`}>
                    <div className="row-main">
                      <div className="row-title">{expense.name}</div>
                      <div className="row-subtitle">{categoryLabel(expense.category)}</div>
                    </div>
                    <div className="row-amount amount">{expense.amount.format()}</div>
                    <button
                      type="button"
                      className="button button-ghost"
                      onClick={() => setExpenses((current) => current.filter((_, position) => position !== index))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {monthlyIncome && (
                  <p className="rationale">
                    Reste après charges fixes :{' '}
                    <strong className="amount">{monthlyIncome.minus(monthlyExpenses).roundedTo(2).format()}</strong>{' '}
                    par mois.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <p className="muted">
              Combien avez-vous de côté aujourd’hui ? Ce montant détermine votre fonds d’urgence — la première
              priorité du plan, avant tout placement.
            </p>
            <Field label="Épargne disponible">
              {(id) => <MoneyInput id={id} value={savings} currency={currency} onChange={setSavings} autoFocus />}
            </Field>
            {monthlyIncome && monthlyExpenses.isPositive && (
              <p className="rationale">
                Vos charges essentielles tournent autour de{' '}
                <strong className="amount">{monthlyExpenses.roundedToUnit.format()}</strong> par mois. Un fonds
                d’urgence de six mois représenterait{' '}
                <strong className="amount">{monthlyExpenses.times(6n).roundedToUnit.format()}</strong>.
              </p>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <p className="muted">
              Un objectif chiffré et daté, si vous en avez un. C’est facultatif : vous pourrez en créer à tout
              moment.
            </p>
            <Field label="Intitulé">
              {(id) => (
                <input
                  id={id}
                  value={goalName}
                  onChange={(event) => setGoalName(event.target.value)}
                  placeholder="Apport appartement"
                />
              )}
            </Field>
            <div className="field-row">
              <Field label="Montant visé">
                {(id) => <MoneyInput id={id} value={goalTarget} currency={currency} onChange={setGoalTarget} />}
              </Field>
              <Field label="Échéance">
                {(id) => (
                  <input id={id} type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} />
                )}
              </Field>
            </div>
          </>
        )}

        <div className="modal-actions">
          {step > 0 && (
            <button type="button" className="button" onClick={() => setStep((current) => current - 1)}>
              Retour
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="button button-primary"
              disabled={step === 0 && (!parsedIncome || !parsedIncome.isPositive)}
              onClick={() => setStep((current) => current + 1)}
            >
              Continuer
            </button>
          ) : (
            <button type="button" className="button button-primary" onClick={finish}>
              Terminer
            </button>
          )}
        </div>
      </div>

      <p className="nav-footnote" style={{ textAlign: 'center' }}>
        Vos données restent sur cette machine. Rien n’est transmis à un serveur.
      </p>
    </div>
  );
}
