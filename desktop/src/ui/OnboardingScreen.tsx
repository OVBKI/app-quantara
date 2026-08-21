import { useMemo, useState } from 'react';
import { Money, formatDecimal } from '../core/money';
import {
  FIXED_CATEGORY_IDS,
  VARIABLE_CATEGORY_IDS,
  categoryLabel,
  type ExpenseCategoryId,
} from '../core/categories';
import { FREQUENCY_LABELS, monthlyEquivalent, type Frequency } from '../core/frequency';
import { emptyProfile, type Debt, type DebtKind, type FinancialProfile, type RiskProfile } from '../core/model';
import { analyse } from '../core/engine/analysis';
import { formatDate, yearMonthOf } from '../core/yearMonth';
import { useStore } from '../state/store';
import { Field, MoneyInput, parseAmount } from './components';
import { formatFullDay } from './dates';

interface DraftExpense {
  readonly name: string;
  readonly amount: Money;
  readonly category: ExpenseCategoryId;
  readonly frequency: Frequency;
}

interface DraftGoal {
  readonly name: string;
  readonly target: Money;
  readonly targetDate: string;
}

type DraftDebt = Omit<Debt, 'id'>;

const STEPS = [
  'Revenus',
  'Dépenses fixes',
  'Dépenses variables',
  'Crédits & dettes',
  'Épargne existante',
  'Objectifs',
  'Tolérance au risque',
  'Votre plan',
] as const;

const PLAN_STEP = STEPS.length - 1;

const DEBT_KINDS: Record<DebtKind, string> = {
  creditCard: 'Carte de crédit',
  consumerLoan: 'Crédit à la consommation',
  carLoan: 'Crédit auto',
  studentLoan: 'Prêt étudiant',
  mortgage: 'Crédit immobilier',
  overdraft: 'Découvert',
  otherDebt: 'Autre dette',
};

const RISK_CHOICES: readonly { readonly value: RiskProfile; readonly label: string; readonly detail: string }[] = [
  {
    value: 'cautious',
    label: 'Prudent',
    detail:
      'Une baisse de 10 % de votre épargne placée vous empêcherait de dormir. Le plan oriente une petite part vers le placement et privilégie le fonds d’urgence.',
  },
  {
    value: 'balanced',
    label: 'Équilibré',
    detail:
      'Vous acceptez de voir la valeur baisser quelques mois si l’horizon est long. Le plan partage entre sécurité et placement.',
  },
  {
    value: 'dynamic',
    label: 'Dynamique',
    detail:
      'Une baisse de 30 % ne vous ferait pas vendre. Le plan oriente davantage vers le placement — une fois la sécurité assurée, jamais avant.',
  },
];

/** Les postes variables les plus courants : proposer les douze noierait l'essentiel. */
const SUGGESTED_VARIABLE: readonly ExpenseCategoryId[] = VARIABLE_CATEGORY_IDS.slice(0, 5);

function id(): string {
  return crypto.randomUUID();
}

/**
 * Première mise en route (§23).
 *
 * Sept étapes puis le plan, dans l'ordre où l'information devient utile : sans revenu rien
 * ne se calcule, sans charges le disponible est faux, les dettes coûteuses passent avant
 * l'épargne, et la tolérance au risque n'a de sens qu'une fois le reste connu.
 *
 * Chaque étape est sautable. Un questionnaire de huit écrans qu'on ne peut pas abréger
 * est abandonné en cours de route, et un profil à moitié rempli vaut mieux qu'aucun :
 * tout reste modifiable ensuite depuis les Réglages.
 */
export function OnboardingScreen() {
  const { profile: existing, replaceProfile } = useStore();
  const currency = existing.currency;

  const [step, setStep] = useState(0);

  // --- 1. Revenus ---
  const [incomeName, setIncomeName] = useState('Salaire');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeFrequency, setIncomeFrequency] = useState<Frequency>('monthly');
  const [incomeVariable, setIncomeVariable] = useState(false);
  const [incomeMin, setIncomeMin] = useState('');
  const [incomeMax, setIncomeMax] = useState('');
  const [incomeDay, setIncomeDay] = useState('28');

  // --- 2. Dépenses fixes ---
  const [expenses, setExpenses] = useState<DraftExpense[]>([]);
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryId>('fixed.rent');

  // --- 3. Dépenses variables (estimation par enveloppe) ---
  const [envelopes, setEnvelopes] = useState<Partial<Record<ExpenseCategoryId, string>>>({});

  // --- 4. Crédits & dettes ---
  const [debts, setDebts] = useState<DraftDebt[]>([]);
  const [debtName, setDebtName] = useState('');
  const [debtKind, setDebtKind] = useState<DebtKind>('consumerLoan');
  const [debtOutstanding, setDebtOutstanding] = useState('');
  const [debtRate, setDebtRate] = useState('');
  const [debtPayment, setDebtPayment] = useState('');

  // --- 5. Épargne ---
  const [savings, setSavings] = useState('');

  // --- 6. Objectifs ---
  const [goals, setGoals] = useState<DraftGoal[]>([]);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');

  // --- 7. Risque ---
  const [risk, setRisk] = useState<RiskProfile>('balanced');

  const parsedIncome = parseAmount(incomeAmount, currency);
  const monthlyIncome = parsedIncome ? monthlyEquivalent(parsedIncome, incomeFrequency) : null;
  const monthlyExpenses = Money.sum(
    expenses.map((expense) => monthlyEquivalent(expense.amount, expense.frequency)),
    currency,
  );
  const monthlyEnvelopes = Money.sum(
    SUGGESTED_VARIABLE.map((category) => parseAmount(envelopes[category] ?? '', currency) ?? Money.zero(currency)),
    currency,
  );

  /**
   * Le profil tel qu'il serait enregistré. Construit à chaque rendu plutôt qu'écrit dans
   * le magasin au fil des étapes : tant que l'utilisateur n'a pas vu son plan, rien n'est
   * validé, et revenir en arrière ne laisse aucune trace à nettoyer.
   */
  const draft = useMemo<FinancialProfile>(() => {
    /*
     * On part du profil **existant**, pas d'un profil vide.
     *
     * Un fichier ancien portant des comptes et des transactions mais aucun revenu
     * déclaré était jugé « jamais mis en route » ; terminer le questionnaire effaçait
     * alors tout — comptes, transactions, objectifs, placements. Repartir de l'existant
     * rend l'étape additive : au pire elle complète, jamais elle ne supprime.
     */
    const base = existing.accounts.length > 0 || existing.transactions.length > 0 ? existing : emptyProfile(currency);
    const savingsBalance = parseAmount(savings, currency) ?? Money.zero(currency);
    const createdAt = new Date().toISOString();
    const today = formatDate(new Date());

    return {
      ...base,
      incomes:
        parsedIncome && parsedIncome.isPositive
          ? [
              {
                id: id(),
                name: incomeName.trim() || 'Salaire',
                amount: parsedIncome,
                frequency: incomeFrequency,
                category: 'salary',
                variable: incomeVariable,
                minAmount: incomeVariable ? (parseAmount(incomeMin, currency) ?? undefined) : undefined,
                maxAmount: incomeVariable ? (parseAmount(incomeMax, currency) ?? undefined) : undefined,
                dayOfMonth: Math.min(Math.max(Number(incomeDay) || 28, 1), 31),
                active: true,
              },
            ]
          : [],
      recurringExpenses: expenses.map((expense) => ({
        id: id(),
        name: expense.name,
        amount: expense.amount,
        frequency: expense.frequency,
        category: expense.category,
        dayOfMonth: 5,
        subscription: expense.category === 'fixed.subscriptions',
        active: true,
      })),
      debts: debts.map((debt) => ({ ...debt, id: id() })),
      goals: goals.map((goal, index) => ({
        id: id(),
        name: goal.name,
        kind: 'purchase' as const,
        target: goal.target,
        current: Money.zero(currency),
        targetDate: goal.targetDate || undefined,
        priority: index + 1,
        createdAt,
        achieved: false,
      })),
      categoryBudgets: SUGGESTED_VARIABLE.flatMap((category) => {
        const limit = parseAmount(envelopes[category] ?? '', currency);
        return limit && limit.isPositive ? [{ category, limit }] : [];
      }),
      accounts: savingsBalance.isPositive
        ? [
            {
              id: id(),
              name: 'Épargne',
              kind: 'savings' as const,
              openingBalance: savingsBalance,
              balanceDate: today,
            },
          ]
        : [],
      preferences: { ...base.preferences, riskProfile: risk, onboardingCompleted: true },
    };
    // `draft` ne sert qu'à l'aperçu du plan et à l'enregistrement final ; le recalculer à
    // chaque frappe reste sans effet perceptible sur un profil de cette taille.
  }, [
    currency,
    parsedIncome,
    incomeName,
    incomeFrequency,
    incomeVariable,
    incomeMin,
    incomeMax,
    expenses,
    envelopes,
    debts,
    goals,
    savings,
    risk,
  ]);

  /** L'étape en cours a-t-elle reçu une réponse ? Sert uniquement à nommer le bouton. */
  const stepAnswered = [
    Boolean(parsedIncome?.isPositive),
    expenses.length > 0,
    monthlyEnvelopes.isPositive,
    debts.length > 0,
    Boolean(parseAmount(savings, currency)),
    goals.length > 0,
    true,
  ][step] === true;

  // L'analyse n'est calculée que sur le dernier écran : inutile ailleurs.
  const plan = useMemo(() => (step === PLAN_STEP ? analyse(draft, yearMonthOf(new Date())) : null), [step, draft]);

  function finish() {
    replaceProfile(draft);
  }

  function addExpenseDraft() {
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
  }

  function addDebtDraft() {
    const outstanding = parseAmount(debtOutstanding, currency);
    if (!outstanding) return;
    setDebts((current) => [
      ...current,
      {
        name: debtName.trim() || DEBT_KINDS[debtKind],
        kind: debtKind,
        outstanding,
        annualRate: Math.max(0, Number(debtRate.replace(',', '.')) || 0) / 100,
        monthlyPayment: parseAmount(debtPayment, currency) ?? Money.zero(currency),
        active: true,
      },
    ]);
    setDebtName('');
    setDebtOutstanding('');
    setDebtRate('');
    setDebtPayment('');
  }

  function addGoalDraft() {
    const target = parseAmount(goalTarget, currency);
    if (!target || !target.isPositive) return;
    setGoals((current) => [...current, { name: goalName.trim() || 'Objectif', target, targetDate: goalDate }]);
    setGoalName('');
    setGoalTarget('');
    setGoalDate('');
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
        <p className="tertiary" style={{ fontSize: 12, marginTop: 2 }}>
          Étape {step + 1} sur {STEPS.length}
        </p>

        {step === 0 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Commençons par ce qui entre. Vous pourrez ajouter d’autres sources — allocations, activité
              indépendante, revenus locatifs — juste après.
            </p>
            <Field label="Intitulé">
              {(fieldId) => (
                <input id={fieldId} value={incomeName} onChange={(event) => setIncomeName(event.target.value)} />
              )}
            </Field>
            <div className="field-row">
              <Field label="Montant net">
                {(fieldId) => (
                  <MoneyInput
                    id={fieldId}
                    value={incomeAmount}
                    currency={currency}
                    onChange={setIncomeAmount}
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Périodicité">
                {(fieldId) => (
                  <select
                    id={fieldId}
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
              <Field label="Jour de réception">
                {(fieldId) => (
                  <input
                    id={fieldId}
                    type="number"
                    min={1}
                    max={31}
                    value={incomeDay}
                    onChange={(event) => setIncomeDay(event.target.value)}
                  />
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
                    {(fieldId) => (
                      <MoneyInput id={fieldId} value={incomeMin} currency={currency} onChange={setIncomeMin} />
                    )}
                  </Field>
                  <Field label="Mois fort">
                    {(fieldId) => (
                      <MoneyInput id={fieldId} value={incomeMax} currency={currency} onChange={setIncomeMax} />
                    )}
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
          </div>
        )}

        {step === 1 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Les charges qui tombent tous les mois, ou moins souvent. Une prime d’assurance annuelle sera
              automatiquement étalée sur douze mois.
            </p>
            <div className="field-row">
              <Field label="Intitulé">
                {(fieldId) => (
                  <input
                    id={fieldId}
                    value={expenseName}
                    onChange={(event) => setExpenseName(event.target.value)}
                    placeholder="Loyer"
                  />
                )}
              </Field>
              <Field label="Montant">
                {(fieldId) => (
                  <MoneyInput id={fieldId} value={expenseAmount} currency={currency} onChange={setExpenseAmount} />
                )}
              </Field>
            </div>
            <Field label="Catégorie">
              {(fieldId) => (
                <select
                  id={fieldId}
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
              onClick={addExpenseDraft}
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
                      aria-label={`Retirer ${expense.name}`}
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
          </div>
        )}

        {step === 2 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Une estimation suffit : ces montants deviennent vos <strong>enveloppes</strong>, et se corrigeront
              d’eux-mêmes dès que vous aurez saisi ou importé quelques semaines de dépenses.
            </p>
            {SUGGESTED_VARIABLE.map((category) => (
              <Field key={category} label={categoryLabel(category)}>
                {(fieldId) => (
                  <MoneyInput
                    id={fieldId}
                    value={envelopes[category] ?? ''}
                    currency={currency}
                    onChange={(value) => setEnvelopes((current) => ({ ...current, [category]: value }))}
                  />
                )}
              </Field>
            ))}
            {monthlyEnvelopes.isPositive && (
              <p className="rationale">
                Soit <strong className="amount">{monthlyEnvelopes.roundedToUnit.format()}</strong> de dépenses
                variables prévues par mois
                {monthlyIncome
                  ? `, et ${monthlyIncome.minus(monthlyExpenses).minus(monthlyEnvelopes).roundedToUnit.format()} restants.`
                  : '.'}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Crédits en cours, découvert, carte à débit différé. Le taux compte plus que le montant : au-delà de
              8 % l’an, rembourser rapporte davantage — et plus sûrement — que placer.
            </p>
            <div className="field-row">
              <Field label="Intitulé">
                {(fieldId) => (
                  <input
                    id={fieldId}
                    value={debtName}
                    onChange={(event) => setDebtName(event.target.value)}
                    placeholder="Crédit auto"
                  />
                )}
              </Field>
              <Field label="Type">
                {(fieldId) => (
                  <select
                    id={fieldId}
                    value={debtKind}
                    onChange={(event) => setDebtKind(event.target.value as DebtKind)}
                  >
                    {(Object.keys(DEBT_KINDS) as DebtKind[]).map((entry) => (
                      <option key={entry} value={entry}>
                        {DEBT_KINDS[entry]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div className="field-row">
              <Field label="Capital restant dû">
                {(fieldId) => (
                  <MoneyInput
                    id={fieldId}
                    value={debtOutstanding}
                    currency={currency}
                    onChange={setDebtOutstanding}
                  />
                )}
              </Field>
              <Field label="Taux annuel (%)">
                {(fieldId) => (
                  <input
                    id={fieldId}
                    inputMode="decimal"
                    value={debtRate}
                    onChange={(event) => setDebtRate(event.target.value)}
                    placeholder="4,5"
                  />
                )}
              </Field>
              <Field label="Mensualité">
                {(fieldId) => (
                  <MoneyInput id={fieldId} value={debtPayment} currency={currency} onChange={setDebtPayment} />
                )}
              </Field>
            </div>
            <button
              type="button"
              className="button"
              disabled={!parseAmount(debtOutstanding, currency)}
              onClick={addDebtDraft}
            >
              Ajouter ce crédit
            </button>

            {debts.length > 0 && (
              <div style={{ marginTop: 18 }}>
                {debts.map((debt, index) => (
                  <div className="row" key={`${debt.name}-${index}`}>
                    <div className="row-main">
                      <div className="row-title">{debt.name}</div>
                      <div className="row-subtitle">
                        {DEBT_KINDS[debt.kind]} · {formatDecimal(debt.annualRate * 100, 2)} % · mensualité{' '}
                        {debt.monthlyPayment.roundedToUnit.format()}
                      </div>
                    </div>
                    <div className="row-amount amount">{debt.outstanding.roundedToUnit.format()}</div>
                    <button
                      type="button"
                      className="button button-ghost"
                      aria-label={`Retirer ${debt.name}`}
                      onClick={() => setDebts((current) => current.filter((_, position) => position !== index))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Combien avez-vous de côté aujourd’hui ? Ce montant détermine votre fonds d’urgence — la première
              priorité du plan, avant tout placement.
            </p>
            <Field label="Épargne actuelle">
              {(fieldId) => (
                <MoneyInput id={fieldId} value={savings} currency={currency} onChange={setSavings} autoFocus />
              )}
            </Field>
            {monthlyExpenses.isPositive && (
              <p className="rationale">
                Vos charges essentielles tournent autour de{' '}
                <strong className="amount">{monthlyExpenses.roundedToUnit.format()}</strong> par mois. Un fonds
                d’urgence de six mois représenterait{' '}
                <strong className="amount">{monthlyExpenses.times(6n).roundedToUnit.format()}</strong>.
              </p>
            )}
          </div>
        )}

        {step === 5 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Un objectif chiffré et daté a bien plus de chances d’aboutir qu’une intention. Vous pourrez en
              ajouter à tout moment.
            </p>
            <Field label="Intitulé">
              {(fieldId) => (
                <input
                  id={fieldId}
                  value={goalName}
                  onChange={(event) => setGoalName(event.target.value)}
                  placeholder="Apport appartement"
                />
              )}
            </Field>
            <div className="field-row">
              <Field label="Montant visé">
                {(fieldId) => (
                  <MoneyInput id={fieldId} value={goalTarget} currency={currency} onChange={setGoalTarget} />
                )}
              </Field>
              <Field label="Échéance">
                {(fieldId) => (
                  <input
                    id={fieldId}
                    type="date"
                    value={goalDate}
                    onChange={(event) => setGoalDate(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <button
              type="button"
              className="button"
              disabled={!parseAmount(goalTarget, currency)}
              onClick={addGoalDraft}
            >
              Ajouter cet objectif
            </button>

            {goals.length > 0 && (
              <div style={{ marginTop: 18 }}>
                {goals.map((goal, index) => (
                  <div className="row" key={`${goal.name}-${index}`}>
                    <div className="row-main">
                      <div className="row-title">{goal.name}</div>
                      <div className="row-subtitle">
                        {goal.targetDate ? `Échéance ${formatFullDay(goal.targetDate)}` : 'Sans échéance'} · priorité {index + 1}
                      </div>
                    </div>
                    <div className="row-amount amount">{goal.target.roundedToUnit.format()}</div>
                    <button
                      type="button"
                      className="button button-ghost"
                      aria-label={`Retirer ${goal.name}`}
                      onClick={() => setGoals((current) => current.filter((_, position) => position !== index))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 6 && (
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              Cette réponse ne change rien à votre sécurité : le fonds d’urgence et les dettes coûteuses passent
              avant, quel que soit le profil. Elle règle seulement la part orientée vers le placement une fois
              ces deux points réglés.
            </p>
            {RISK_CHOICES.map((choice) => (
              <label
                key={choice.value}
                className="card"
                style={{
                  display: 'block',
                  marginBottom: 10,
                  cursor: 'pointer',
                  borderColor: risk === choice.value ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <div className="inline">
                  <input
                    type="radio"
                    name="risk"
                    checked={risk === choice.value}
                    onChange={() => setRisk(choice.value)}
                    style={{ width: 16 }}
                  />
                  <strong>{choice.label}</strong>
                </div>
                <p className="rationale" style={{ marginTop: 6 }}>
                  {choice.detail}
                </p>
              </label>
            ))}
          </div>
        )}

        {step === PLAN_STEP && plan && (
          <div style={{ marginTop: 16 }}>
            {draft.incomes.length === 0 ? (
              <p className="muted">
                Aucun revenu n’a été renseigné : le plan ne peut donc rien répartir. Revenez en arrière pour en
                ajouter un, ou commencez quand même — tout se complète depuis les Réglages.
              </p>
            ) : (
              <>
                <p className="hero-label" style={{ marginTop: 4 }}>
                  Reste après charges, chaque mois
                </p>
                <p className="hero-value amount" style={{ fontSize: 34 }}>
                  {plan.summary.disposable.roundedToUnit.format()}
                </p>
                <p className="muted" style={{ marginBottom: 18 }}>
                  {plan.summary.income.roundedToUnit.format()} de revenus −{' '}
                  {plan.summary.fixedExpenses.roundedToUnit.format()} de charges fixes −{' '}
                  {plan.summary.variableReserved.roundedToUnit.format()} réservés aux dépenses variables.
                </p>

                {plan.allocation.lines.length === 0 ? (
                  <p className="muted">
                    Rien à répartir ce mois-ci
                    {plan.summary.disposable.isNegative ? ' : le budget est déficitaire.' : '.'}
                  </p>
                ) : (
                  plan.allocation.lines.map((line, index) => (
                    <div className="row" key={`${line.bucket}-${index}`} style={{ alignItems: 'flex-start' }}>
                      <div className="row-main">
                        <div className="row-title">{line.label}</div>
                        <div className="rationale">{line.rationale}</div>
                      </div>
                      <div className="row-amount amount">{line.amount.roundedToUnit.format()}</div>
                    </div>
                  ))
                )}

                {plan.allocation.skippedSteps.map((skipped) => (
                  <p className="rationale" key={skipped} style={{ marginTop: 12 }}>
                    ⏸ {skipped}
                  </p>
                ))}

                <p className="rationale" style={{ marginTop: 16 }}>
                  Cet ordre suit un <strong>risque décroissant</strong> : sécuriser, éteindre ce qui coûte cher,
                  construire, puis seulement investir. Chaque ligne porte son motif — vous pourrez toutes les
                  ajuster, et rien ici n’est figé.
                </p>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          {step > 0 && (
            <button type="button" className="button" onClick={() => setStep((current) => current - 1)}>
              Retour
            </button>
          )}
          {step < PLAN_STEP ? (
            // Un seul bouton, dont le libellé dit ce qui va réellement se passer : proposer
            // « Continuer » *et* « Je verrai plus tard » quand les deux avancent d'un écran
            // ferait croire à une différence qui n'existe pas.
            <button type="button" className="button button-primary" onClick={() => setStep((current) => current + 1)}>
              {stepAnswered ? 'Continuer' : 'Je verrai plus tard'}
            </button>
          ) : (
            <button type="button" className="button button-primary" onClick={finish}>
              Commencer
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
