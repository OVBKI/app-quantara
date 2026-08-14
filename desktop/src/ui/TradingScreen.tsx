import { useState } from 'react';
import { Money, Percent } from '../core/money';
import { formatDate, parseDate } from '../core/yearMonth';
import type { PropFirmPhase, TradingAccount } from '../core/model';
import { PHASE_LABELS } from '../core/engine/trading';
import { useStore } from '../state/store';
import { Card, EmptyState, Field, Modal, MoneyInput, parseAmount, useConfirm } from './components';

const PHASE_TONE: Record<PropFirmPhase, string> = {
  challenge: 'var(--accent)',
  verification: 'var(--accent)',
  funded: 'var(--positive)',
  failed: 'var(--critical)',
  closed: 'var(--text-tertiary)',
};

/**
 * Activité de trading en compte financé.
 *
 * L'écran compte, il ne conseille pas. Aucune stratégie n'est suggérée, aucun rendement
 * projeté : seulement ce qui a été payé, ce qui a été encaissé, et la différence.
 */
export function TradingScreen() {
  const { profile, analysis, addTradingAccount, updateTradingAccount, removeTradingAccount, addTransaction } =
    useStore();
  const [accountForm, setAccountForm] = useState(false);
  const [payoutFor, setPayoutFor] = useState<TradingAccount | null>(null);
  const [confirmNode, confirm] = useConfirm();

  const trading = analysis.summary.trading;
  const tradingIncome = analysis.summary.incomeDetail.trading;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Trading</h1>
          <p className="page-subtitle">Comptes financés : ce que l’activité coûte, ce qu’elle rapporte</p>
        </div>
        <button type="button" className="button button-primary" onClick={() => setAccountForm(true)}>
          Nouveau compte
        </button>
      </header>

      <div className="stack">
        {!trading || trading.attemptsStarted === 0 ? (
          <Card>
            <EmptyState
              title="Aucun compte enregistré"
              message="Enregistrez vos épreuves et vos versements. L’application calculera ce que l’activité rapporte réellement — versements encaissés moins épreuves payées, échecs compris."
              action={
                <button type="button" className="button button-primary" onClick={() => setAccountForm(true)}>
                  Ajouter un compte
                </button>
              }
            />
          </Card>
        ) : (
          <>
            <Card title="Résultat net depuis le début">
              <div className="grid grid-3">
                <div>
                  <div className="tile-label">Versements encaissés</div>
                  <div className="tile-value amount positive">
                    {trading.lifetimePayouts.roundedToUnit.format()}
                  </div>
                </div>
                <div>
                  <div className="tile-label">Épreuves payées</div>
                  <div className="tile-value amount">{trading.lifetimeFees.roundedToUnit.format()}</div>
                </div>
                <div>
                  <div className="tile-label">Net</div>
                  <div
                    className={`tile-value amount ${trading.lifetimeNet.isNegative ? 'critical' : 'positive'}`}
                  >
                    {trading.lifetimeNet.roundedToUnit.format()}
                  </div>
                </div>
              </div>
              <p className="rationale" style={{ marginTop: 14 }}>
                C’est la seule soustraction qui répond à la question. Les versements se retiennent, les frais
                d’épreuve s’oublient — et c’est ainsi qu’une activité déficitaire peut sembler rentable pendant
                des mois.
              </p>
            </Card>

            <div className="grid grid-2">
              <Card title="Taux de réussite">
                <div className="grid grid-2">
                  <div>
                    <div className="tile-label">Épreuves réussies</div>
                    <div className="tile-value amount">
                      {trading.passRate === null ? '—' : Percent.format(trading.passRate, 'fr-FR', 0)}
                    </div>
                    <div className="tile-note">
                      {trading.fundedAccounts} financé{trading.fundedAccounts > 1 ? 's' : ''} ·{' '}
                      {trading.failedAccounts} perdu{trading.failedAccounts > 1 ? 's' : ''}
                    </div>
                  </div>
                  <div>
                    <div className="tile-label">Coût d’un compte financé</div>
                    <div className="tile-value amount">
                      {trading.costPerFundedAccount?.roundedToUnit.format() ?? '—'}
                    </div>
                    <div className="tile-note">échecs compris</div>
                  </div>
                </div>
              </Card>

              <Card title="Régularité des versements">
                <div className="grid grid-2">
                  <div>
                    <div className="tile-label">Mois avec versement</div>
                    <div className="tile-value amount">
                      {trading.payouts.monthsWithPayout} / {trading.payouts.monthsObserved}
                    </div>
                    <div className="tile-note">
                      médiane {trading.payouts.median.roundedToUnit.format()}
                    </div>
                  </div>
                  <div>
                    <div className="tile-label">Plus longue sécheresse</div>
                    <div className="tile-value amount">{trading.payouts.longestDrySpell} mois</div>
                    <div className="tile-note">sans aucun versement</div>
                  </div>
                </div>
              </Card>
            </div>

            <Card title="Ce que le budget retient">
              <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="amount" style={{ fontSize: 22, fontWeight: 640 }}>
                  {tradingIncome?.planned.roundedToUnit.format() ?? Money.zero(profile.currency).format()}
                </span>
                <span className="badge">{tradingIncome?.plannable ? 'planifiable' : 'non planifié'}</span>
              </div>
              <p className="rationale">
                {tradingIncome?.plannable ? (
                  <>
                    Six mois de versements observés : le budget retient désormais le premier quintile de vos
                    montants, mois sans versement compris. Ce n’est pas la moyenne — elle serait tirée vers le
                    haut par les bons mois.
                  </>
                ) : (
                  <>
                    Le budget ne compte <strong>aucun</strong> revenu de trading tant que six mois de versements
                    n’ont pas été observés ({tradingIncome?.monthsObserved ?? 0} pour l’instant). Un compte
                    financé se perd sur une seule séance en dépassant la perte maximale autorisée : y adosser un
                    loyer, c’est risquer de devoir le payer un mois où le compte n’existe plus.
                  </>
                )}
              </p>
              {trading.allocatedCapital.isPositive && (
                <p className="rationale">
                  Les <strong className="amount">{trading.allocatedCapital.roundedToUnit.format()}</strong> de
                  capital géré n’entrent dans aucun calcul de patrimoine, et c’est délibéré : c’est un mandat
                  révocable, pas un avoir. Votre exposition financière se limite au prix des épreuves.
                </p>
              )}
            </Card>
          </>
        )}

        {profile.tradingAccounts.length > 0 && (
          <Card title="Vos comptes">
            {profile.tradingAccounts.map((entry) => (
              <div className="row" key={entry.id} style={{ alignItems: 'flex-start' }}>
                <div className="row-main">
                  <div className="row-title">
                    {entry.label}
                    <span
                      className="badge"
                      style={{
                        marginLeft: 8,
                        background: 'transparent',
                        color: PHASE_TONE[entry.phase],
                        border: `1px solid ${PHASE_TONE[entry.phase]}`,
                      }}
                    >
                      {PHASE_LABELS[entry.phase]}
                    </span>
                  </div>
                  <div className="row-subtitle">
                    {entry.provider} · {entry.accountSize.formatCompact()} gérés ·{' '}
                    {entry.fee.format()} d’épreuve · {Math.round(entry.profitSplit * 100)} % pour vous ·
                    depuis le {parseDate(entry.startedAt).toLocaleDateString('fr-FR')}
                  </div>
                </div>
                <div className="inline">
                  <select
                    value={entry.phase}
                    aria-label={`Phase de ${entry.label}`}
                    onChange={(event) =>
                      updateTradingAccount({ ...entry, phase: event.target.value as PropFirmPhase })
                    }
                    style={{ width: 'auto' }}
                  >
                    {(Object.keys(PHASE_LABELS) as PropFirmPhase[]).map((phase) => (
                      <option key={phase} value={phase}>
                        {PHASE_LABELS[phase]}
                      </option>
                    ))}
                  </select>
                  {entry.phase === 'funded' && (
                    <button type="button" className="button button-small" onClick={() => setPayoutFor(entry)}>
                      Versement
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Supprimer ${entry.label}`}
                    onClick={() => confirm(`Supprimer « ${entry.label} » ?`, () => removeTradingAccount(entry.id))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>

      {accountForm && (
        <AccountForm
          currency={profile.currency}
          onClose={() => setAccountForm(false)}
          onSubmit={addTradingAccount}
        />
      )}
      {payoutFor && (
        <PayoutForm
          account={payoutFor}
          currency={profile.currency}
          onClose={() => setPayoutFor(null)}
          onSubmit={(amount, date) =>
            addTransaction({
              amount,
              date,
              kind: 'income',
              label: `Versement ${payoutFor.label}`,
              tradingAccountId: payoutFor.id,
            })
          }
        />
      )}
      {confirmNode}
    </>
  );
}

function AccountForm({
  currency,
  onClose,
  onSubmit,
}: {
  currency: Money['currency'];
  onClose: () => void;
  onSubmit: (account: Omit<TradingAccount, 'id'>) => void;
}) {
  const [provider, setProvider] = useState('');
  const [label, setLabel] = useState('');
  const [size, setSize] = useState('');
  const [fee, setFee] = useState('');
  const [split, setSplit] = useState('80');
  const [phase, setPhase] = useState<PropFirmPhase>('challenge');
  const [startedAt, setStartedAt] = useState(() => formatDate(new Date()));

  const parsedSize = parseAmount(size, currency);
  const parsedFee = parseAmount(fee, currency);

  return (
    <Modal title="Nouveau compte" onClose={onClose}>
      <div className="field-row">
        <Field label="Société">
          {(id) => (
            <input id={id} value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="FTMO" autoFocus />
          )}
        </Field>
        <Field label="Intitulé">
          {(id) => (
            <input id={id} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Compte 100k" />
          )}
        </Field>
      </div>

      <div className="field-row">
        <Field label="Capital géré" hint="Ne vous appartient pas : exclu du patrimoine.">
          {(id) => <MoneyInput id={id} value={size} currency={currency} onChange={setSize} />}
        </Field>
        <Field label="Prix de l’épreuve" hint="Le seul montant réellement engagé.">
          {(id) => <MoneyInput id={id} value={fee} currency={currency} onChange={setFee} />}
        </Field>
      </div>

      <div className="field-row">
        <Field label="Part des gains (%)">
          {(id) => (
            <input id={id} value={split} inputMode="numeric" onChange={(event) => setSplit(event.target.value)} />
          )}
        </Field>
        <Field label="Phase">
          {(id) => (
            <select id={id} value={phase} onChange={(event) => setPhase(event.target.value as PropFirmPhase)}>
              {(Object.keys(PHASE_LABELS) as PropFirmPhase[]).map((entry) => (
                <option key={entry} value={entry}>
                  {PHASE_LABELS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Date de début">
          {(id) => (
            <input id={id} type="date" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
          )}
        </Field>
      </div>

      <p className="field-hint">
        Enregistrez aussi les épreuves perdues : sans elles, le coût réel d’un compte financé est sous-estimé,
        parfois d’un facteur trois ou quatre.
      </p>

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!parsedFee}
          onClick={() => {
            if (!parsedFee) return;
            onSubmit({
              provider: provider.trim() || 'Société',
              label: label.trim() || 'Compte',
              phase,
              accountSize: parsedSize ?? Money.zero(currency),
              fee: parsedFee,
              profitSplit: Math.min(Math.max(Number(split.replace(',', '.')) || 0, 0), 100) / 100,
              startedAt,
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

function PayoutForm({
  account,
  currency,
  onClose,
  onSubmit,
}: {
  account: TradingAccount;
  currency: Money['currency'];
  onClose: () => void;
  onSubmit: (amount: Money, date: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => formatDate(new Date()));
  const parsed = parseAmount(amount, currency);

  return (
    <Modal title={`Versement — ${account.label}`} onClose={onClose}>
      <div className="field-row">
        <Field label="Montant reçu" hint="Le montant net encaissé, après partage des gains.">
          {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
        </Field>
        <Field label="Date">
          {(id) => <input id={id} type="date" value={date} onChange={(event) => setDate(event.target.value)} />}
        </Field>
      </div>
      <p className="rationale">
        Ce versement est enregistré comme un revenu à part. Il ne se planifie pas comme un salaire : il compte
        pour le mois où il tombe, et n’annonce pas le suivant.
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
            onSubmit(parsed, date);
            onClose();
          }}
        >
          Enregistrer
        </button>
      </div>
    </Modal>
  );
}
