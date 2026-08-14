import { useRef, useState } from 'react';
import { CURRENCIES, Money, type Currency } from '../core/money';
import type { AccountKind, DebtKind, RiskProfile } from '../core/model';
import { EMERGENCY_FUND_TIERS } from '../core/engine/emergencyFund';
import { useStore } from '../state/store';
import { deserializeProfile, downloadProfile } from '../storage/persistence';
import { Card, Field, Modal, MoneyInput, parseAmount, useConfirm } from './components';

const RISK_LABELS: Record<RiskProfile, string> = {
  cautious: 'Prudent',
  balanced: 'Équilibré',
  dynamic: 'Dynamique',
};

const ACCOUNT_KINDS: Record<AccountKind, string> = {
  checking: 'Compte courant',
  savings: 'Épargne',
  investment: 'Placement',
  cash: 'Espèces',
};

const DEBT_KINDS: Record<DebtKind, string> = {
  creditCard: 'Carte de crédit',
  consumerLoan: 'Crédit à la consommation',
  carLoan: 'Crédit auto',
  studentLoan: 'Prêt étudiant',
  mortgage: 'Crédit immobilier',
  overdraft: 'Découvert',
  otherDebt: 'Autre dette',
};

export function SettingsScreen() {
  const {
    profile,
    analysis,
    setCurrency,
    updatePreferences,
    setBalances,
    addAccount,
    removeAccount,
    addDebt,
    removeDebt,
    replaceProfile,
    reset,
  } = useStore();
  const [accountForm, setAccountForm] = useState(false);
  const [debtForm, setDebtForm] = useState(false);
  const [savings, setSavings] = useState(String(profile.savingsBalance.units || ''));
  const [investments, setInvestments] = useState(String(profile.investmentsBalance.units || ''));
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmNode, confirm] = useConfirm();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Réglages</h1>
          <p className="page-subtitle">Vos données restent sur cette machine</p>
        </div>
      </header>

      <div className="stack">
        <Card title="Général">
          <div className="field-row">
            <Field label="Devise" hint="Un profil est mono-devise : les opérations entre devises sont refusées.">
              {(id) => (
                <select id={id} value={profile.currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Profil de risque" hint="Détermine la part du surplus orientée vers l’investissement.">
              {(id) => (
                <select
                  id={id}
                  value={profile.preferences.riskProfile}
                  onChange={(event) => updatePreferences({ riskProfile: event.target.value as RiskProfile })}
                >
                  {(Object.keys(RISK_LABELS) as RiskProfile[]).map((entry) => (
                    <option key={entry} value={entry}>
                      {RISK_LABELS[entry]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div className="field-row">
            <Field label="Fonds d’urgence visé">
              {(id) => (
                <select
                  id={id}
                  value={profile.preferences.emergencyFundMonths}
                  onChange={(event) => updatePreferences({ emergencyFundMonths: Number(event.target.value) })}
                >
                  {EMERGENCY_FUND_TIERS.map((months) => (
                    <option key={months} value={months}>
                      {months} mois de dépenses essentielles
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Part laissée libre"
              hint="Jamais affectée par le plan. Un budget qui ne laisse rien ne tient pas."
            >
              {(id) => (
                <select
                  id={id}
                  value={profile.preferences.minimumFreeShare}
                  onChange={(event) => updatePreferences({ minimumFreeShare: Number(event.target.value) })}
                >
                  {[0.05, 0.1, 0.15, 0.2].map((share) => (
                    <option key={share} value={share}>
                      {Math.round(share * 100)} % du disponible
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <label className="inline">
            <input
              type="checkbox"
              checked={profile.preferences.smoothIncome}
              onChange={(event) => updatePreferences({ smoothIncome: event.target.checked })}
              style={{ width: 16 }}
            />
            <span>Lisser les revenus irréguliers sur la médiane des mois passés</span>
          </label>
        </Card>

        <Card title="Épargne et placements">
          <div className="field-row">
            <Field label="Épargne disponible" hint="Sert de base au calcul du fonds d’urgence.">
              {(id) => <MoneyInput id={id} value={savings} currency={profile.currency} onChange={setSavings} />}
            </Field>
            <Field label="Placements">
              {(id) => (
                <MoneyInput id={id} value={investments} currency={profile.currency} onChange={setInvestments} />
              )}
            </Field>
          </div>
          <button
            type="button"
            className="button"
            onClick={() =>
              setBalances(
                parseAmount(savings, profile.currency) ?? Money.zero(profile.currency),
                parseAmount(investments, profile.currency) ?? Money.zero(profile.currency),
              )
            }
          >
            Enregistrer les soldes
          </button>
        </Card>

        <Card
          title="Comptes"
          action={
            <button type="button" className="button button-small" onClick={() => setAccountForm(true)}>
              Ajouter
            </button>
          }
        >
          {profile.accounts.length === 0 ? (
            <p className="muted">
              Aucun compte. Le solde d’un compte courant permet de projeter la trésorerie jour par jour et de
              prévoir un découvert.
            </p>
          ) : (
            profile.accounts.map((account) => (
              <div className="row" key={account.id}>
                <div className="row-main">
                  <div className="row-title">{account.name}</div>
                  <div className="row-subtitle">{ACCOUNT_KINDS[account.kind]}</div>
                </div>
                <div className="row-amount amount">{account.balance.format()}</div>
                <button
                  type="button"
                  className="button button-ghost"
                  aria-label={`Supprimer ${account.name}`}
                  onClick={() => confirm(`Supprimer le compte « ${account.name} » ?`, () => removeAccount(account.id))}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </Card>

        <Card
          title="Dettes"
          action={
            <button type="button" className="button button-small" onClick={() => setDebtForm(true)}>
              Ajouter
            </button>
          }
        >
          {profile.debts.length === 0 ? (
            <p className="muted">Aucune dette enregistrée.</p>
          ) : (
            <>
              {profile.debts.map((debt) => (
                <div className="row" key={debt.id}>
                  <div className="row-main">
                    <div className="row-title">
                      {debt.name}
                      {debt.annualRate >= 0.08 && (
                        <span className="badge" style={{ marginLeft: 8, background: 'rgba(248,81,73,0.14)', color: 'var(--critical)' }}>
                          taux élevé
                        </span>
                      )}
                    </div>
                    <div className="row-subtitle">
                      {DEBT_KINDS[debt.kind]} · {(debt.annualRate * 100).toFixed(2)} % · mensualité{' '}
                      {debt.monthlyPayment.format()}
                    </div>
                  </div>
                  <div className="row-amount amount">{debt.outstanding.format()}</div>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Supprimer ${debt.name}`}
                    onClick={() => confirm(`Supprimer la dette « ${debt.name} » ?`, () => removeDebt(debt.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {analysis.debtPlan.totalMonths !== null && analysis.debtPlan.totalMonths > 0 && (
                <p className="rationale">
                  En réaffectant chaque mensualité libérée à la dette suivante, tout est remboursé en{' '}
                  {analysis.debtPlan.totalMonths} mois, avec{' '}
                  {analysis.debtPlan.interestSaved.roundedToUnit.format()} d’intérêts économisés par rapport au
                  paiement minimum.
                </p>
              )}
              {analysis.debtPlan.totalMonths === null && profile.debts.length > 0 && (
                <p className="rationale critical">
                  Aux mensualités actuelles, une dette au moins ne se rembourse jamais : les intérêts dépassent
                  le remboursement.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Vos données">
          {importError && <div className="error-banner">{importError}</div>}
          <p className="muted" style={{ marginTop: 0 }}>
            Tout est enregistré localement, dans un fichier JSON lisible. Aucune donnée n’est transmise à un
            serveur. L’export vous permet de partir avec vos données à tout moment.
          </p>
          <div className="inline">
            <button type="button" className="button" onClick={() => downloadProfile(profile)}>
              Exporter
            </button>
            <button type="button" className="button" onClick={() => fileInput.current?.click()}>
              Importer
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() =>
                confirm(
                  'Effacer toutes vos données ? Cette action est définitive. Pensez à exporter avant.',
                  () => void reset(),
                )
              }
            >
              Tout effacer
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                replaceProfile(deserializeProfile(await file.text()));
                setImportError(null);
              } catch (cause) {
                setImportError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                event.target.value = '';
              }
            }}
          />
        </Card>
      </div>

      {accountForm && (
        <AccountForm currency={profile.currency} onClose={() => setAccountForm(false)} onSubmit={addAccount} />
      )}
      {debtForm && <DebtForm currency={profile.currency} onClose={() => setDebtForm(false)} onSubmit={addDebt} />}
      {confirmNode}
    </>
  );
}

function AccountForm({
  currency,
  onClose,
  onSubmit,
}: {
  currency: Currency;
  onClose: () => void;
  onSubmit: (account: { name: string; kind: AccountKind; balance: Money }) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('checking');
  const [balance, setBalance] = useState('');
  const parsed = parseAmount(balance, currency) ?? Money.zero(currency);

  return (
    <Modal title="Nouveau compte" onClose={onClose}>
      <Field label="Intitulé">
        {(id) => (
          <input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="Compte courant" />
        )}
      </Field>
      <div className="field-row">
        <Field label="Type">
          {(id) => (
            <select id={id} value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
              {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((entry) => (
                <option key={entry} value={entry}>
                  {ACCOUNT_KINDS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Solde">
          {(id) => <MoneyInput id={id} value={balance} currency={currency} onChange={setBalance} autoFocus />}
        </Field>
      </div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            onSubmit({ name: name.trim() || ACCOUNT_KINDS[kind], kind, balance: parsed });
            onClose();
          }}
        >
          Ajouter
        </button>
      </div>
    </Modal>
  );
}

function DebtForm({
  currency,
  onClose,
  onSubmit,
}: {
  currency: Currency;
  onClose: () => void;
  onSubmit: (debt: {
    name: string;
    kind: DebtKind;
    outstanding: Money;
    annualRate: number;
    monthlyPayment: Money;
    active: boolean;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DebtKind>('consumerLoan');
  const [outstanding, setOutstanding] = useState('');
  const [rate, setRate] = useState('4');
  const [payment, setPayment] = useState('');

  const parsedOutstanding = parseAmount(outstanding, currency);
  const parsedPayment = parseAmount(payment, currency);
  const annualRate = Number(rate.replace(',', '.')) / 100;

  return (
    <Modal title="Nouvelle dette" onClose={onClose}>
      <Field label="Intitulé">
        {(id) => (
          <input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="Crédit auto" />
        )}
      </Field>
      <div className="field-row">
        <Field label="Capital restant dû">
          {(id) => <MoneyInput id={id} value={outstanding} currency={currency} onChange={setOutstanding} autoFocus />}
        </Field>
        <Field label="Mensualité">
          {(id) => <MoneyInput id={id} value={payment} currency={currency} onChange={setPayment} />}
        </Field>
      </div>
      <div className="field-row">
        <Field label="Type">
          {(id) => (
            <select id={id} value={kind} onChange={(event) => setKind(event.target.value as DebtKind)}>
              {(Object.keys(DEBT_KINDS) as DebtKind[]).map((entry) => (
                <option key={entry} value={entry}>
                  {DEBT_KINDS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Taux annuel (%)" hint="Au-delà de 8 %, rembourser prime sur investir.">
          {(id) => <input id={id} value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" />}
        </Field>
      </div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!parsedOutstanding || !parsedPayment || !Number.isFinite(annualRate)}
          onClick={() => {
            if (!parsedOutstanding || !parsedPayment) return;
            onSubmit({
              name: name.trim() || DEBT_KINDS[kind],
              kind,
              outstanding: parsedOutstanding,
              annualRate: Math.max(annualRate, 0),
              monthlyPayment: parsedPayment,
              active: true,
            });
            onClose();
          }}
        >
          Ajouter
        </button>
      </div>
    </Modal>
  );
}
