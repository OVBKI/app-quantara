import { useState } from 'react';
import { Money } from '../core/money';
import type { Goal, GoalKind } from '../core/model';
import type { GoalPlan } from '../core/engine/goals';
import { useStore } from '../state/store';
import { Card, EmptyState, Field, Modal, MoneyInput, ProgressBar, parseAmount, useConfirm } from './components';

const GOAL_KINDS: Record<GoalKind, string> = {
  emergencyFund: 'Fonds d’urgence',
  purchase: 'Achat',
  travel: 'Voyage',
  property: 'Immobilier',
  education: 'Études',
  retirement: 'Retraite',
  investment: 'Investissement',
  project: 'Projet personnel',
  otherGoal: 'Autre',
};

export function GoalsScreen() {
  const { profile, analysis, addGoal, updateGoal, removeGoal, contributeToGoal } = useStore();
  const [form, setForm] = useState<Goal | true | null>(null);
  const [contributing, setContributing] = useState<GoalPlan | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const { goalPlans, emergencyFund, capacity } = analysis;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Objectifs</h1>
          <p className="page-subtitle">
            Capacité d’épargne estimée : <span className="amount">{capacity.roundedToUnit.format()}</span> par mois
          </p>
        </div>
        <button type="button" className="button button-primary" onClick={() => setForm(true)}>
          Nouvel objectif
        </button>
      </header>

      <div className="stack">
        <Card title="Fonds d’urgence">
          <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="amount" style={{ fontSize: 20, fontWeight: 620 }}>
              {emergencyFund.current.roundedToUnit.format()}
            </span>
            <span className="muted">cible {emergencyFund.target.roundedToUnit.format()}</span>
          </div>
          <ProgressBar value={emergencyFund.progress} tone={emergencyFund.progress >= 1 ? 'var(--positive)' : undefined} />
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            {emergencyFund.tiers.map((tier) => (
              <div key={tier.months} className="inline" style={{ gap: 8 }}>
                <span style={{ color: tier.reached ? 'var(--positive)' : 'var(--text-tertiary)' }}>
                  {tier.reached ? '●' : '○'}
                </span>
                <span>
                  <strong>{tier.months} mois</strong>
                  <br />
                  <span className="row-subtitle amount">{tier.target.roundedToUnit.format()}</span>
                </span>
              </div>
            ))}
          </div>
          {emergencyFund.monthsToTarget !== null && emergencyFund.monthsToTarget > 0 && (
            <p className="rationale">
              Au rythme de {capacity.roundedToUnit.format()} par mois, la cible est atteinte dans{' '}
              {emergencyFund.monthsToTarget} mois.
            </p>
          )}
        </Card>

        {goalPlans.length === 0 ? (
          <Card>
            <EmptyState
              title="Aucun objectif"
              message="Un objectif chiffré et daté transforme une intention en plan : « 15 000 € dans deux ans » devient « 625 € par mois »."
              action={
                <button type="button" className="button button-primary" onClick={() => setForm(true)}>
                  Créer un objectif
                </button>
              }
            />
          </Card>
        ) : (
          goalPlans.map((plan) => (
            <Card key={plan.goal.id}>
              <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17 }}>{plan.goal.name}</h2>
                  <p className="row-subtitle" style={{ margin: '2px 0 0' }}>
                    {GOAL_KINDS[plan.goal.kind]}
                    {plan.goal.targetDate ? ` · échéance ${new Date(plan.goal.targetDate).toLocaleDateString('fr-FR')}` : ''}
                  </p>
                </div>
                <div className="inline">
                  <button type="button" className="button button-small" onClick={() => setForm(plan.goal)}>
                    Modifier
                  </button>
                  <button type="button" className="button button-small" onClick={() => setContributing(plan)}>
                    Verser
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Supprimer ${plan.goal.name}`}
                    onClick={() =>
                      confirm(`Supprimer l’objectif « ${plan.goal.name} » ?`, () => removeGoal(plan.goal.id))
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="inline" style={{ justifyContent: 'space-between', margin: '14px 0 8px' }}>
                <span className="amount" style={{ fontWeight: 600 }}>
                  {plan.goal.current.roundedToUnit.format()}
                  <span className="muted" style={{ fontWeight: 400 }}> sur {plan.goal.target.roundedToUnit.format()}</span>
                </span>
                <span className="badge">{Math.round(plan.progress * 100)} %</span>
              </div>
              <ProgressBar value={plan.progress} />

              <div className="grid grid-3" style={{ marginTop: 16 }}>
                <div>
                  <div className="tile-label">Mensualité nécessaire</div>
                  <div className="amount" style={{ fontWeight: 600 }}>
                    {plan.requiredMonthly ? plan.requiredMonthly.roundedToUnit.format() : '—'}
                  </div>
                </div>
                <div>
                  <div className="tile-label">Atteint dans</div>
                  <div className="amount" style={{ fontWeight: 600 }}>
                    {plan.projectedMonths !== null ? `${plan.projectedMonths} mois` : 'jamais à ce rythme'}
                  </div>
                </div>
                <div>
                  <div className="tile-label">Faisable</div>
                  <div style={{ fontWeight: 600 }} className={plan.feasible ? 'positive' : 'warning'}>
                    {plan.feasible ? 'Oui' : `Manque ${plan.shortfall?.roundedToUnit.format()}/mois`}
                  </div>
                </div>
              </div>

              {plan.alternatives.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="card-title">Trois issues possibles</div>
                  {plan.alternatives.map((alternative) => (
                    <div className="row" key={alternative.kind}>
                      <div className="row-main">
                        <div className="row-title">
                          {alternative.kind === 'extendDeadline'
                            ? 'Allonger l’échéance'
                            : alternative.kind === 'reduceTarget'
                              ? 'Revoir le montant'
                              : 'Augmenter l’effort'}
                        </div>
                        <div className="rationale">{alternative.explanation}</div>
                      </div>
                    </div>
                  ))}
                  <p className="rationale">
                    Annoncer « hors de portée » sans proposer de sortie n’aide personne : à vous de choisir ce
                    que vous préférez ajuster.
                  </p>
                </div>
              )}
            </Card>
          ))
        )}
      </div>

      {form && (
        <GoalForm
          initial={form === true ? null : form}
          currency={profile.currency}
          onClose={() => setForm(null)}
          onSubmit={(draft) => {
            if (form === true) addGoal(draft);
            else updateGoal({ ...form, ...draft });
          }}
        />
      )}
      {contributing && (
        <ContributionForm
          plan={contributing}
          currency={profile.currency}
          onClose={() => setContributing(null)}
          onSubmit={(amount) => contributeToGoal(contributing.goal.id, amount)}
        />
      )}
      {confirmNode}
    </>
  );
}

function GoalForm({
  initial,
  currency,
  onClose,
  onSubmit,
}: {
  initial: Goal | null;
  currency: Money['currency'];
  onClose: () => void;
  onSubmit: (goal: {
    name: string;
    kind: GoalKind;
    target: Money;
    current: Money;
    targetDate?: string;
    priority: number;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial ? String(initial.target.units) : '');
  const [current, setCurrent] = useState(initial ? String(initial.current.units) : '');
  const [kind, setKind] = useState<GoalKind>(initial?.kind ?? 'purchase');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');

  const parsedTarget = parseAmount(target, currency);
  const parsedCurrent = parseAmount(current, currency) ?? Money.zero(currency);

  return (
    <Modal title={initial ? `Modifier « ${initial.name} »` : 'Nouvel objectif'} onClose={onClose}>
      <Field label="Intitulé">
        {(id) => (
          <input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Apport appartement"
          />
        )}
      </Field>
      <div className="field-row">
        <Field label="Montant visé">
          {(id) => <MoneyInput id={id} value={target} currency={currency} onChange={setTarget} autoFocus />}
        </Field>
        <Field label="Déjà épargné">
          {(id) => <MoneyInput id={id} value={current} currency={currency} onChange={setCurrent} />}
        </Field>
      </div>
      <div className="field-row">
        <Field label="Nature">
          {(id) => (
            <select id={id} value={kind} onChange={(event) => setKind(event.target.value as GoalKind)}>
              {(Object.keys(GOAL_KINDS) as GoalKind[]).map((entry) => (
                <option key={entry} value={entry}>
                  {GOAL_KINDS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Échéance" hint="Facultative — sans elle, la projection se fait à votre rythme actuel.">
          {(id) => (
            <input id={id} type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          )}
        </Field>
      </div>

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!parsedTarget || !parsedTarget.isPositive}
          onClick={() => {
            if (!parsedTarget) return;
            onSubmit({
              name: name.trim() || GOAL_KINDS[kind],
              kind,
              target: parsedTarget,
              current: parsedCurrent,
              targetDate: targetDate || undefined,
              priority: initial?.priority ?? 1,
            });
            onClose();
          }}
        >
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </Modal>
  );
}

function ContributionForm({
  plan,
  currency,
  onClose,
  onSubmit,
}: {
  plan: GoalPlan;
  currency: Money['currency'];
  onClose: () => void;
  onSubmit: (amount: Money) => void;
}) {
  const suggested = plan.requiredMonthly ?? plan.plannedMonthly;
  const [amount, setAmount] = useState(suggested ? String(suggested.roundedToUnit.units) : '');
  const parsed = parseAmount(amount, currency);

  return (
    <Modal title={`Verser sur « ${plan.goal.name} »`} onClose={onClose}>
      <Field label="Montant" hint="Le versement est aussi enregistré comme épargne du mois.">
        {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
      </Field>
      <p className="rationale">
        Restant à financer : <span className="amount">{plan.remaining.roundedToUnit.format()}</span>
      </p>
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
            onSubmit(parsed);
            onClose();
          }}
        >
          Verser
        </button>
      </div>
    </Modal>
  );
}
