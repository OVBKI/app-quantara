import { useRef, useState } from 'react';
import { CURRENCIES, Money, type Currency } from '../core/money';
import type { Account, AccountKind, Debt, DebtKind, RiskProfile } from '../core/model';
import { EMERGENCY_FUND_TIERS } from '../core/engine/emergencyFund';
import { INCOME_PLANNING_LABELS, type IncomePlanningMode } from '../core/engine/income';
import { useStore } from '../state/store';
import { deserializeProfile, downloadProfile } from '../storage/persistence';
import { encryptionAvailable, passwordStrength } from '../security/vault';
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
    updateAccount,
    removeAccount,
    addDebt,
    updateDebt,
    removeDebt,
    replaceProfile,
    reset,
    encrypted,
    enableEncryption,
    disableEncryption,
  } = useStore();
  const [accountForm, setAccountForm] = useState<Account | true | null>(null);
  const [debtForm, setDebtForm] = useState<Debt | true | null>(null);
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

          <Field
            label="Planification d’un revenu irrégulier"
            hint="Un budget bâti sur le meilleur mois casse onze mois sur douze."
          >
            {(id) => (
              <select
                id={id}
                value={profile.preferences.incomePlanning}
                onChange={(event) =>
                  updatePreferences({ incomePlanning: event.target.value as IncomePlanningMode })
                }
              >
                {(Object.keys(INCOME_PLANNING_LABELS) as IncomePlanningMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {INCOME_PLANNING_LABELS[mode]}
                  </option>
                ))}
              </select>
            )}
          </Field>

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
                <button type="button" className="button button-small" onClick={() => setAccountForm(account)}>
                  Modifier
                </button>
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
                  <button type="button" className="button button-small" onClick={() => setDebtForm(debt)}>
                    Modifier
                  </button>
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

        <Card title="Alertes et affichage">
          <Field
            label="Taille du texte"
            hint="S’applique à toute l’interface, graphiques compris."
          >
            {(id) => (
              <select
                id={id}
                value={profile.preferences.textScale}
                onChange={(event) => updatePreferences({ textScale: Number(event.target.value) })}
              >
                {[
                  [0.9, 'Compact'],
                  [1, 'Normal'],
                  [1.15, 'Grand'],
                  [1.3, 'Très grand'],
                  [1.4, 'Maximum'],
                ].map(([value, label]) => (
                  <option key={String(value)} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="card-title" style={{ marginTop: 18 }}>
            Notifications système
          </div>
          {(
            [
              ['upcomingDebits', 'Prélèvements à venir dans les trois jours'],
              ['overdraft', 'Découvert prévu'],
              ['envelopes', 'Enveloppe dépassée'],
              ['milestones', 'Palier d’objectif ou de fonds d’urgence atteint'],
              ['monthlyReport', 'Bilan de fin de mois'],
            ] as const
          ).map(([key, label]) => (
            <label className="inline" key={key} style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={profile.preferences.alerts[key]}
                onChange={(event) =>
                  updatePreferences({
                    alerts: { ...profile.preferences.alerts, [key]: event.target.checked },
                  })
                }
                style={{ width: 16 }}
              />
              <span>{label}</span>
            </label>
          ))}
          <p className="rationale" style={{ marginTop: 10 }}>
            Les notifications partent à l’ouverture de l’application, et une seule fois par jour pour un même
            sujet — une seule fois tout court pour un palier, qui ne se franchit qu’une fois. Une application
            de bureau fermée ne peut rien signaler : contrairement à un téléphone, aucun service ne tourne en
            arrière-plan pour elle.
          </p>
        </Card>

        <Card title="Protection du fichier">
          <SecuritySection
            encrypted={encrypted}
            onEnable={enableEncryption}
            onDisable={disableEncryption}
          />
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
        <AccountForm
          initial={accountForm === true ? null : accountForm}
          currency={profile.currency}
          onClose={() => setAccountForm(null)}
          onSubmit={(draft) => {
            if (accountForm === true) addAccount(draft);
            else updateAccount({ ...accountForm, ...draft });
          }}
        />
      )}
      {debtForm && (
        <DebtForm
          initial={debtForm === true ? null : debtForm}
          currency={profile.currency}
          onClose={() => setDebtForm(null)}
          onSubmit={(draft) => {
            if (debtForm === true) addDebt(draft);
            else updateDebt({ ...debtForm, ...draft });
          }}
        />
      )}
      {confirmNode}
    </>
  );
}

/**
 * Chiffrement du profil.
 *
 * Facultatif et explicite : sans mot de passe, le fichier reste lisible par quiconque
 * ouvre le dossier — et l'interface le dit, au lieu de laisser croire à une protection
 * qui n'existe pas.
 */
function SecuritySection({
  encrypted,
  onEnable,
  onDisable,
}: {
  encrypted: boolean;
  onEnable: (password: string) => Promise<void>;
  onDisable: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const available = encryptionAvailable();

  const strength = password.length > 0 ? passwordStrength(password) : null;
  const matches = password.length > 0 && password === confirmation;

  if (!available) {
    return (
      <p className="muted" style={{ marginTop: 0 }}>
        Le chiffrement n’est pas disponible dans cet environnement : les fonctions cryptographiques du système
        ne sont pas accessibles. Plutôt que d’afficher une protection factice, l’option est désactivée.
      </p>
    );
  }

  if (encrypted) {
    return (
      <>
        <p style={{ marginTop: 0, color: 'var(--positive)', fontWeight: 550 }}>
          ● Votre profil est chiffré sur ce poste
        </p>
        <p className="rationale">
          Le fichier est illisible sans le mot de passe, y compris pour quelqu’un qui copierait le disque.
          Le mot de passe n’est enregistré nulle part : le perdre signifie perdre les données. Pensez à un
          export régulier, rangé ailleurs.
        </p>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onDisable().finally(() => setBusy(false));
          }}
        >
          Retirer la protection
        </button>
      </>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Votre fichier est aujourd’hui <strong>en clair</strong> : n’importe qui ayant accès à cette session
        Windows peut le lire. Un budget en dit long — revenus, dettes, habitudes, parfois la santé au détour
        d’une pharmacie.
      </p>

      {failure && <div className="error-banner">{failure}</div>}

      <div className="field-row">
        <Field label="Mot de passe" hint={strength ? strength.label : 'Huit caractères au minimum'}>
          {(id) => (
            <input
              id={id}
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Field label="Confirmation">
          {(id) => (
            <input
              id={id}
              type="password"
              value={confirmation}
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          )}
        </Field>
      </div>

      <button
        type="button"
        className="button button-primary"
        disabled={!matches || (strength?.score ?? 0) === 0 || busy}
        onClick={() => {
          setBusy(true);
          setFailure(null);
          void onEnable(password)
            .then(() => {
              setPassword('');
              setConfirmation('');
            })
            .catch((cause: unknown) => setFailure(cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Chiffrement…' : 'Chiffrer le fichier'}
      </button>

      <p className="rationale" style={{ marginTop: 12 }}>
        Chiffrement AES-256, clé dérivée par 600 000 itérations. Cette lenteur volontaire — une demi-seconde à
        l’ouverture — rend inexploitable une attaque par essais successifs. Le mot de passe n’est écrit nulle
        part : <strong>le perdre, c’est perdre les données</strong>.
      </p>
    </>
  );
}

function AccountForm({
  initial,
  currency,
  onClose,
  onSubmit,
}: {
  initial: Account | null;
  currency: Currency;
  onClose: () => void;
  onSubmit: (account: { name: string; kind: AccountKind; balance: Money }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? 'checking');
  const [balance, setBalance] = useState(initial ? String(initial.balance.units) : '');
  const parsed = parseAmount(balance, currency) ?? Money.zero(currency);

  return (
    <Modal title={initial ? `Modifier « ${initial.name} »` : 'Nouveau compte'} onClose={onClose}>
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
          {initial ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </Modal>
  );
}

function DebtForm({
  initial,
  currency,
  onClose,
  onSubmit,
}: {
  initial: Debt | null;
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
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<DebtKind>(initial?.kind ?? 'consumerLoan');
  const [outstanding, setOutstanding] = useState(initial ? String(initial.outstanding.units) : '');
  const [rate, setRate] = useState(initial ? String(initial.annualRate * 100) : '4');
  const [payment, setPayment] = useState(initial ? String(initial.monthlyPayment.units) : '');

  const parsedOutstanding = parseAmount(outstanding, currency);
  const parsedPayment = parseAmount(payment, currency);
  const annualRate = Number(rate.replace(',', '.')) / 100;

  return (
    <Modal title={initial ? `Modifier « ${initial.name} »` : 'Nouvelle dette'} onClose={onClose}>
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
