import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import { FIXED_CATEGORY_IDS, INCOME_CATEGORIES, INCOME_LABELS, categoryLabel, type ExpenseCategoryId, type IncomeCategory } from '../core/categories';
import { FREQUENCIES, FREQUENCY_LABELS, monthlyEquivalent, type Frequency } from '../core/frequency';
import {
  ALLOCATION_PART_LABELS,
  ALLOCATION_PARTS,
  DEFAULT_ALLOCATION_TARGETS,
  rebalanceAllocation,
  type AllocationPart,
  type IncomeSource,
  type RecurringExpense,
} from '../core/model';
import { useStore } from '../state/store';
import { allocatedTo } from '../core/engine/allocation';
import { declarationHistory, pendingDeclarations } from '../core/engine/declarations';
import type { YearMonth } from '../core/yearMonth';
import { BarList, Donut, Legend, type Slice } from './charts';
import { Card, EmptyState, Field, Modal, MoneyInput, parseAmount, useConfirm } from './components';
import { ALLOCATION_PART_BUCKETS, ALLOCATION_PART_COLORS, ALLOCATION_PART_HINTS } from './allocationVisual';
import {
  destinationAccounts,
  planApplication,
  spendingAccounts,
  suggestedDestination,
} from '../core/engine/applyAllocation';
import { ApplyAllocationButton } from './ApplyAllocation';
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
        <IncomeBreakdownCard />
        <AutoSplitCard />
        <DeclaredIncomeCard />
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
                      {income.declaredMonthly ? (
                        <span className="badge" style={{ marginLeft: 8 }}>
                          déclaré au mois
                        </span>
                      ) : income.variable ? (
                        <span className="badge" style={{ marginLeft: 8 }}>
                          irrégulier
                        </span>
                      ) : null}
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

        {!profile.preferences.allocationTargets.enabled && (
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
        )}
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

/**
 * Partage automatique de ce qui reste.
 *
 * Les charges sont paramétrées par l'utilisateur ; tout le reste se découpe seul, chaque
 * mois, selon quatre parts réglées une fois. C'est la demande exacte : ne plus avoir à
 * décider où va l'argent quand il arrive.
 *
 * Les curseurs se compensent — bouger l'un réajuste les trois autres — pour que le total
 * fasse toujours 100 %. Un réglage qu'il faut faire tomber juste à la main n'est pas un
 * réglage, c'est un devoir d'arithmétique, et un total faux ferait basculer le partage
 * dans un autre mode sans que rien ne l'annonce.
 */
function AutoSplitCard() {
  const { profile, analysis, period, updatePreferences } = useStore();
  const { allocation } = analysis;
  const targets = profile.preferences.allocationTargets;
  const accounts = profile.preferences.allocationAccounts;

  // Le même calcul que celui de la fenêtre de confirmation : les comptes affichés ici
  // sont exactement ceux qui serviront, jamais une deuxième interprétation du réglage.
  const application = planApplication(profile, allocation, period);
  const destinationOf = (part: AllocationPart): string | undefined =>
    application.moves.find((move) => move.part === part)?.toAccountId ??
    accounts[part as 'security' | 'savings' | 'investment'] ??
    suggestedDestination(profile, part, application.fromAccountId)?.id;
  const accountName = (id: string | null | undefined): string =>
    profile.accounts.find((account) => account.id === id)?.name ?? 'votre compte courant';

  // Le montant réellement partagé, pris du moteur : les pourcentages affichés et les
  // euros affichés viennent ainsi du même calcul et ne peuvent pas diverger.
  const amountOf = (part: AllocationPart): Money => allocatedTo(allocation, ALLOCATION_PART_BUCKETS[part]);

  const slices: Slice[] = ALLOCATION_PARTS.map((part) => ({
    key: part,
    label: ALLOCATION_PART_LABELS[part],
    value: Number(amountOf(part).units.toFixed(2)),
    color: ALLOCATION_PART_COLORS[part],
    formatted: amountOf(part).roundedToUnit.format(),
  })).filter((slice) => slice.value > 0);

  const nothingToShare = !allocation.disposable.isPositive;

  return (
    <Card
      title="Partage automatique"
      action={
        <label className="switch">
          <input
            type="checkbox"
            checked={targets.enabled}
            onChange={(event) =>
              updatePreferences({ allocationTargets: { ...targets, enabled: event.target.checked } })
            }
          />
          <span>Activé</span>
        </label>
      }
    >
      <div className="split-head">
        <div>
          <div className="tile-label">Reste à partager chaque mois</div>
          <div className={`split-amount ${nothingToShare ? 'critical' : ''}`}>
            {allocation.disposable.roundedToUnit.format()}
          </div>
          <p className="rationale" style={{ marginTop: 4 }}>
            Vos revenus, moins vos charges fixes, vos dépenses variables et vos remboursements.
          </p>
        </div>
        {targets.enabled && slices.length > 0 && (
          <Donut slices={slices} size={148} thickness={22} centerValue={allocation.disposable.roundedToUnit.formatCompact()} centerLabel="partagés" />
        )}
      </div>

      {!targets.enabled ? (
        <p className="rationale" style={{ marginTop: 12 }}>
          Le partage automatique est désactivé : le disponible est réparti par ordre de priorité (sécurité,
          dettes coûteuses, objectifs, puis investissement). Activez-le pour fixer vos propres parts.
        </p>
      ) : (
        <>
          <div className="split-rows">
            {ALLOCATION_PARTS.map((part) => {
              const percent = Math.round(targets[part] * 100);
              return (
                <div className="split-row" key={part}>
                  <div className="split-row-head">
                    <span className="dot" style={{ background: ALLOCATION_PART_COLORS[part] }} aria-hidden="true" />
                    <span className="split-row-label">{ALLOCATION_PART_LABELS[part]}</span>
                    <span className="split-row-percent">{percent}&nbsp;%</span>
                    <span className="split-row-amount amount">{amountOf(part).roundedToUnit.format()}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={percent}
                    aria-label={`Part ${ALLOCATION_PART_LABELS[part]}`}
                    // La portion parcourue prend la couleur de la part : le curseur, la
                    // pastille et l'anneau disent alors la même chose sans légende.
                    style={{
                      background: `linear-gradient(90deg, ${ALLOCATION_PART_COLORS[part]} ${percent}%, var(--grid) ${percent}%)`,
                    }}
                    onChange={(event) =>
                      updatePreferences({
                        allocationTargets: rebalanceAllocation(targets, part, Number(event.target.value) / 100),
                      })
                    }
                  />
                  <div className="split-row-foot">
                    <p className="rationale">{ALLOCATION_PART_HINTS[part]}</p>
                    {part === 'free' ? (
                      <span className="tertiary">reste sur {accountName(application.fromAccountId)}</span>
                    ) : (
                      <label className="split-target">
                        <span className="tertiary">vers</span>
                        <select
                          value={destinationOf(part) ?? ''}
                          aria-label={`Compte pour ${ALLOCATION_PART_LABELS[part]}`}
                          onChange={(event) =>
                            updatePreferences({
                              allocationAccounts: { ...accounts, [part]: event.target.value },
                            })
                          }
                        >
                          {destinationAccounts(profile, part, application.fromAccountId).map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {spendingAccounts(profile).length > 1 && (
            <label className="split-target" style={{ marginTop: 16 }}>
              <span className="tertiary">L’argent part de</span>
              <select
                value={application.fromAccountId ?? ''}
                aria-label="Compte d’où part l’argent"
                onChange={(event) =>
                  updatePreferences({ allocationAccounts: { ...accounts, source: event.target.value } })
                }
              >
                {spendingAccounts(profile).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {allocation.skippedSteps.map((step) => (
            <p className="rationale" key={step} style={{ marginTop: 12 }}>
              ⏸ {step}
            </p>
          ))}

          <div className="split-actions">
            <ApplyAllocationButton />
            <button
              type="button"
              className="button button-small"
              onClick={() => updatePreferences({ allocationTargets: DEFAULT_ALLOCATION_TARGETS })}
            >
              Valeurs conseillées
            </button>
            <span className="tertiary">
              Bouger une part réajuste les autres : le total fait toujours 100&nbsp;%.
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

/** Montant prêt à être réédité : « 1200 » plutôt que « 1200,00 € ». */
function editable(amount: Money | undefined): string {
  return amount ? String(amount.units) : '';
}

/**
 * Où va le revenu.
 *
 * La question du cahier des charges — « revenus moins charges, que reste-t-il, et où
 * cela part-il ? » — posée sous la seule forme qui y répond d'un regard : une
 * composition. Les parts sont des montants réels, pas des pourcentages théoriques.
 *
 * Un anneau parce qu'il s'agit d'un tout qui se partage, et quatre à six parts au plus.
 * Les barres à côté donnent le classement, que l'anneau ne sait pas donner.
 */
function IncomeBreakdownCard() {
  const { analysis } = useStore();
  const { summary, allocation } = analysis;

  if (!summary.income.isPositive) return null;

  const savings = allocatedTo(allocation, 'emergencyFund')
    .plus(allocatedTo(allocation, 'goals'))
    .plus(allocatedTo(allocation, 'safetyBuffer'));

  const parts: Slice[] = [
    {
      key: 'fixed',
      label: 'Charges fixes',
      value: Number(summary.fixedExpenses.units.toFixed(2)),
      color: 'var(--series-1)',
      formatted: summary.fixedExpenses.roundedToUnit.format(),
    },
    {
      key: 'variable',
      label: 'Dépenses variables',
      value: Number(summary.variableReserved.units.toFixed(2)),
      color: 'var(--series-2)',
      formatted: summary.variableReserved.roundedToUnit.format(),
    },
    {
      key: 'debt',
      label: 'Remboursements',
      value: Number(summary.debtPayments.units.toFixed(2)),
      color: 'var(--series-3)',
      formatted: summary.debtPayments.roundedToUnit.format(),
    },
    {
      key: 'savings',
      label: 'Épargne',
      value: Number(savings.units.toFixed(2)),
      color: 'var(--series-4)',
      formatted: savings.roundedToUnit.format(),
    },
    {
      key: 'investment',
      label: 'Investissement',
      value: Number(allocatedTo(allocation, 'investment').units.toFixed(2)),
      color: 'var(--series-5)',
      formatted: allocatedTo(allocation, 'investment').roundedToUnit.format(),
    },
    {
      key: 'free',
      label: 'Libre',
      value: Number(allocatedTo(allocation, 'freeMoney').units.toFixed(2)),
      color: 'var(--series-6)',
      formatted: allocatedTo(allocation, 'freeMoney').roundedToUnit.format(),
    },
  ].filter((part) => part.value > 0);

  // Le centre affiche la somme des parts, jamais le revenu : quand le mois est
  // déficitaire, les deux diffèrent, et annoncer le revenu au milieu d'un anneau qui
  // représente autre chose serait une contradiction affichée.
  const allocated = parts.reduce((sum, part) => sum + part.value, 0);
  const overCommitted = allocated > Number(summary.income.units);

  return (
    <Card title="Où va votre revenu">
      <div className="donut-layout">
        <Donut
          slices={parts}
          centerValue={Money.of(allocated, analysis.summary.currency).roundedToUnit.formatCompact()}
          centerLabel="engagés"
        />
        <div>
          <BarList slices={parts} />
        </div>
      </div>
      <p className="figure-hint">
        Vos montants réels, pas des pourcentages théoriques.
        {overCommitted && (
          <>
            {' '}
            <strong className="critical">
              Ces engagements dépassent votre revenu de{' '}
              {Money.of(allocated, analysis.summary.currency)
                .minus(summary.income)
                .roundedToUnit.format()}
            </strong>{' '}
            : le mois se boucle sur l’épargne ou sur le découvert.
          </>
        )}
      </p>
      <Legend items={parts.map((part) => ({ label: part.label, color: part.color }))} />
    </Card>
  );
}

/**
 * Les mois déclarés, et ceux qui manquent.
 *
 * Le rappel automatique fait le gros du travail ; cette carte existe pour le reste :
 * corriger un montant saisi trop vite, rattraper un mois passé, ou simplement vérifier
 * ce que l'application a retenu. Rien n'est enfermé dans une fenêtre modale.
 */
function DeclaredIncomeCard() {
  const { profile, declareIncome } = useStore();
  const [editing, setEditing] = useState<{ sourceId: string; period: YearMonth; label: string } | null>(null);

  const sources = profile.incomes.filter((source) => source.declaredMonthly && source.active);
  const pending = useMemo(() => pendingDeclarations(profile), [profile]);

  if (sources.length === 0) return null;

  return (
    <Card title="Revenus déclarés au mois">
      <p className="section-note">Seul compte le montant que vous saisissez.</p>

      {sources.map((source) => {
        const history = declarationHistory(profile, source);
        const missing = pending.filter((entry) => entry.source.id === source.id);

        return (
          <div key={source.id} style={{ marginBottom: 18 }}>
            <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>{source.name}</strong>
              {missing.length > 0 && (
                <span className="badge" style={{ color: 'var(--warning)', background: 'transparent', border: '1px solid var(--warning)' }}>
                  {missing.length} mois à déclarer
                </span>
              )}
            </div>

            {missing.map((entry) => (
              <div className="row" key={`${entry.source.id}-${entry.label}`}>
                <div className="row-main">
                  <div className="row-title" style={{ textTransform: 'capitalize' }}>
                    {entry.label}
                  </div>
                  <div className="row-subtitle warning">Pas encore déclaré</div>
                </div>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setEditing({ sourceId: source.id, period: entry.period, label: entry.label })}
                >
                  Saisir
                </button>
              </div>
            ))}

            {history.length === 0 && missing.length === 0 && (
              <p className="muted">Aucun mois déclaré pour l’instant.</p>
            )}

            {history.map((entry) => (
              <div className="row" key={`${source.id}-${entry.label}`}>
                <div className="row-main">
                  <div className="row-title" style={{ textTransform: 'capitalize' }}>
                    {entry.label}
                  </div>
                  <div className="row-subtitle">Montant déclaré</div>
                </div>
                <div className="row-amount amount positive">{entry.amount.roundedToUnit.format()}</div>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setEditing({ sourceId: source.id, period: entry.period, label: entry.label })}
                >
                  Corriger
                </button>
              </div>
            ))}
          </div>
        );
      })}

      {editing && (
        <DeclarationForm
          label={editing.label}
          currency={profile.currency}
          initial={
            declarationHistory(profile, profile.incomes.find((entry) => entry.id === editing.sourceId)!).find(
              (entry) => entry.label === editing.label,
            )?.amount ?? null
          }
          onClose={() => setEditing(null)}
          onSubmit={(amount) => declareIncome(editing.sourceId, editing.period, amount)}
        />
      )}
    </Card>
  );
}

function DeclarationForm({
  label,
  currency,
  initial,
  onClose,
  onSubmit,
}: {
  label: string;
  currency: Money['currency'];
  initial: Money | null;
  onClose: () => void;
  onSubmit: (amount: Money) => void;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.units) : '');
  const parsed = parseAmount(amount, currency);

  return (
    <Modal title={`Revenu de ${label}`} onClose={onClose}>
      <Field label="Montant net reçu" hint="Le montant exact, tel qu’il est arrivé sur le compte.">
        {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
      </Field>

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={parsed === null}
          onClick={() => {
            if (!parsed) return;
            onSubmit(parsed);
            onClose();
          }}
        >
          Enregistrer
        </button>
      </div>
    </Modal>
  );
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
  const { profile } = useStore();
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(editable(initial?.amount));
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [category, setCategory] = useState<IncomeCategory>(initial?.category ?? 'salary');
  // Trois natures, et non deux cases à cocher : « fixe », « fourchette » et « déclaré
  // chaque mois » s'excluent, et un jeu de cases laisserait des combinaisons absurdes.
  const [nature, setNature] = useState<'fixed' | 'range' | 'declared'>(
    initial?.declaredMonthly ? 'declared' : initial?.variable ? 'range' : 'fixed',
  );
  const variable = nature !== 'fixed';
  const [minAmount, setMinAmount] = useState(editable(initial?.minAmount));
  const [maxAmount, setMaxAmount] = useState(editable(initial?.maxAmount));
  const [dayOfMonth, setDayOfMonth] = useState(String(initial?.dayOfMonth ?? 28));
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');

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
      {spendingAccounts(profile).length > 0 && (
        <Field
          label="Versé sur quel compte ?"
          hint="Sans compte, un encaissement confirmé n’augmente aucun solde"
        >
          {(id) => (
            <select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Aucun compte précisé</option>
              {spendingAccounts(profile).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Nature de ce revenu">
        {(id) => (
          <select
            id={id}
            value={nature}
            onChange={(event) => setNature(event.target.value as 'fixed' | 'range' | 'declared')}
          >
            <option value="fixed">Fixe — le même montant chaque mois</option>
            <option value="range">Irrégulier — je connais l’amplitude</option>
            <option value="declared">Trop irrégulier — je saisis le montant exact chaque mois</option>
          </select>
        )}
      </Field>

      {nature === 'declared' && (
        <p className="field-hint" style={{ marginBottom: 14 }}>
          En fin de mois, l’application vous demandera combien vous avez reçu. Aucune moyenne n’est supposée
          tant que vous n’avez pas répondu.
        </p>
      )}

      {nature === 'range' ? (
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
              declaredMonthly: nature === 'declared',
              minAmount: nature === 'range' && parsedMin ? parsedMin : undefined,
              maxAmount: nature === 'range' && parsedMax ? parsedMax : undefined,
              dayOfMonth: Math.min(Math.max(Number(dayOfMonth) || 28, 1), 31),
              accountId: accountId || undefined,
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
