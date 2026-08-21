import { useMemo, useState } from 'react';
import { categoryLabel } from '../core/categories';
import { type AccountKind } from '../core/model';
import { formatYearMonth, parseDate } from '../core/yearMonth';
import { accountMovements, overviewAccounts, type AccountSummary } from '../core/engine/accounts';
import { expectedIncomes, receiptTotals, receiptTransaction } from '../core/engine/receipts';
import { defaultSourceAccount } from '../core/engine/applyAllocation';
import { useStore } from '../state/store';
import { AnimatedAmount, Card, EmptyState } from './components';
import { Sparkline } from './charts';
import { useToast } from './Toast';
import { formatDay, formatFullDay, formatWeekday } from './dates';

const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Compte courant',
  savings: 'Épargne',
  investment: 'Placement',
  cash: 'Espèces',
};

const KIND_COLOR: Record<AccountKind, string> = {
  checking: 'var(--series-1)',
  savings: 'var(--series-3)',
  investment: 'var(--series-7)',
  cash: 'var(--series-4)',
};

/**
 * Suivi des comptes.
 *
 * Le reste de l'application raisonne en budget — ce qui est prévu, ce qui reste. Ici on
 * raisonne en **relevé** : combien il y a sur chaque compte aujourd'hui, ce qui y est
 * entré, ce qui en est sorti, et dans quel ordre.
 *
 * Aucun solde n'est saisi ni stocké : tout se déduit du solde de départ daté et des
 * écritures postérieures. Corriger une dépense de la semaine dernière remet donc tous les
 * soldes d'aplomb, sans rien à ressaisir.
 */
export function AccountsScreen() {
  const { profile, period, analysis, addTransaction, removeTransaction } = useStore();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);

  const overview = useMemo(
    () => overviewAccounts(profile, period, analysis.reference),
    [profile, period, analysis.reference],
  );
  const incomes = useMemo(
    () => expectedIncomes(profile, period, analysis.reference),
    [profile, period, analysis.reference],
  );
  const totals = receiptTotals(incomes, profile.currency);
  const fallbackAccount = defaultSourceAccount(profile, analysis.reference);

  if (profile.accounts.length === 0) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">Comptes</h1>
        </header>
        <EmptyState
          title="Aucun compte enregistré"
          message="Le suivi part de là : un compte, son solde et la date de ce solde. Tout le reste s’en déduit."
          action={
            <a className="button button-primary" href="#/settings">
              Ajouter un compte
            </a>
          }
        />
      </>
    );
  }

  const opened = overview.accounts.find((entry) => entry.account.id === openId) ?? null;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Comptes</h1>
          <p className="page-subtitle">Ce qu’il y a réellement, compte par compte</p>
        </div>
      </header>

      <div className="stack">
        <section className="hero">
          <div className="hero-label">Total sur vos comptes</div>
          <AnimatedAmount money={overview.total.roundedToUnit} className="hero-value amount" />
          <p className="hero-note">
            <strong className="amount positive">+{overview.credited.roundedToUnit.format()}</strong> entrés et{' '}
            <strong className="amount">−{overview.debited.roundedToUnit.format()}</strong> sortis en{' '}
            {formatYearMonth(period)}. Les placements sont comptés à leur dernière valeur connue.
          </p>
        </section>

        {totals.pending > 0 && (
          <Card title="Revenus attendus ce mois-ci">
            <p className="rationale" style={{ marginTop: 0 }}>
              Un revenu inscrit au budget est une attente, pas un encaissement. Tant qu’il n’est pas confirmé, il ne
              figure sur aucun compte — et le solde suivi reste celui d’avant la paie.
            </p>
            {incomes.map((entry) => (
              <div className="row" key={entry.source.id}>
                <div className="row-main">
                  <div className="row-title">{entry.source.name}</div>
                  <div className="row-subtitle">
                    Attendu le {formatDay(entry.date)}
                    {entry.source.accountId
                      ? ` · vers ${profile.accounts.find((a) => a.id === entry.source.accountId)?.name ?? 'compte inconnu'}`
                      : fallbackAccount
                        ? ` · vers ${fallbackAccount.name}`
                        : ' · aucun compte à créditer'}
                    {entry.unassigned && ' · reçu, mais rattaché à aucun compte'}
                    {entry.amount && entry.remaining.isPositive &&
                      ` · ${entry.amount.roundedToUnit.format()} reçus, ${entry.remaining.roundedToUnit.format()} attendus`}
                  </div>
                </div>
                <div className="row-amount amount">
                  {(entry.amount ?? entry.expected).roundedToUnit.format()}
                </div>
                {entry.remaining.isPositive ? (
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={() => {
                      const created = addTransaction(
                        receiptTransaction(entry, period, entry.remaining, fallbackAccount?.id, analysis.reference),
                      );
                      toast({
                        message: `${entry.remaining.roundedToUnit.format()} crédités sur ${
                          profile.accounts.find(
                            (candidate) => candidate.id === (entry.source.accountId ?? fallbackAccount?.id),
                          )?.name ?? 'aucun compte'
                        }.`,
                        tone: 'positive',
                        action: { label: 'Annuler', run: () => removeTransaction(created) },
                      });
                    }}
                  >
                    {entry.amount ? 'Compléter' : 'J’ai reçu'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => {
                      for (const receipt of entry.receipts) removeTransaction(receipt.id);
                      toast({ message: `Encaissement de « ${entry.source.name} » annulé.` });
                    }}
                  >
                    Annuler
                  </button>
                )}
              </div>
            ))}
            <div className="row" style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
              <div className="row-main">Encaissé sur {totals.expected.roundedToUnit.format()} attendus</div>
              <div className="row-amount amount positive">{totals.received.roundedToUnit.format()}</div>
              <span style={{ width: 90 }} />
            </div>
          </Card>
        )}

        <div className="grid grid-2">
          {overview.accounts.map((entry) => (
            <AccountCard
              key={entry.account.id}
              summary={entry}
              open={openId === entry.account.id}
              onToggle={() => setOpenId(openId === entry.account.id ? null : entry.account.id)}
            />
          ))}
        </div>

        {opened && <MovementsCard summary={opened} />}

        {overview.unassigned.length > 0 && (
          <Card title="Écritures sans compte">
            <p className="rationale" style={{ marginTop: 0 }}>
              Ces {overview.unassigned.length} écritures comptent dans votre budget mais ne modifient aucun solde :
              elles ne disent pas d’où l’argent est parti — soit aucun compte n’a été précisé, soit celui qu’elles
              désignent a été supprimé depuis. Ouvrez-les depuis les Transactions pour leur affecter un compte.
            </p>
            {overview.unassigned.slice(0, 6).map((transaction) => (
              <div className="row" key={transaction.id}>
                <div className="row-main">
                  <div className="row-title">
                    {transaction.label || (transaction.category ? categoryLabel(transaction.category) : 'Écriture')}
                  </div>
                  <div className="row-subtitle">{formatFullDay(transaction.date)}</div>
                </div>
                <div className="row-amount amount">{transaction.amount.roundedToUnit.format()}</div>
              </div>
            ))}
            {overview.unassigned.length > 6 && (
              <p className="tertiary">et {overview.unassigned.length - 6} autres.</p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

function AccountCard({
  summary,
  open,
  onToggle,
}: {
  readonly summary: AccountSummary;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { account, balance, valuedByHoldings, credited, debited, net, movementCount, daily } = summary;
  const color = KIND_COLOR[account.kind];

  return (
    <section className={`card account-card ${open ? 'open' : ''}`}>
      <div className="account-head">
        <span className="dot" style={{ background: color }} aria-hidden="true" />
        <div className="row-main">
          <div className="row-title">{account.name}</div>
          <div className="row-subtitle">{KIND_LABEL[account.kind]}</div>
        </div>
        <div className={`account-balance amount ${balance.isNegative ? 'critical' : ''}`}>
          {balance.roundedToUnit.format()}
        </div>
      </div>

      {/* La courbe du mois : une seule série, donc la couleur ne distingue rien — elle
          reprend simplement celle de la nature du compte. */}
      <div className="account-trend">
        <Sparkline values={daily.map((day) => day.balance.units)} color={color} width={260} height={44} />
      </div>

      <div className="account-figures">
        <span>
          <span className="tertiary">Entré</span>{' '}
          <strong className="amount positive">+{credited.roundedToUnit.format()}</strong>
        </span>
        <span>
          <span className="tertiary">Sorti</span>{' '}
          <strong className="amount">−{debited.roundedToUnit.format()}</strong>
        </span>
        <span>
          <span className="tertiary">Net</span>{' '}
          <strong className={`amount ${net.isNegative ? 'critical' : 'positive'}`}>
            {net.isNegative ? '' : '+'}
            {net.roundedToUnit.format()}
          </strong>
        </span>
      </div>

      <div className="inline" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span className="tertiary">
          {valuedByHoldings
            ? 'Valeur des lignes de portefeuille'
            : movementCount === 0
              ? 'Aucun mouvement ce mois-ci'
              : `${movementCount} mouvement${movementCount > 1 ? 's' : ''} · relevé du ${formatFullDay(account.balanceDate)}`}
        </span>
        <button type="button" className="button button-small" onClick={onToggle} disabled={movementCount === 0}>
          {open ? 'Masquer' : 'Voir le détail'}
        </button>
      </div>
    </section>
  );
}

/**
 * Le relevé du compte ouvert.
 *
 * Chaque ligne porte le solde **après** elle. C'est ce qui distingue un relevé d'une liste
 * de dépenses : on voit à quel moment le compte est passé sous zéro, pas seulement qu'il
 * y est passé.
 */
function MovementsCard({ summary }: { readonly summary: AccountSummary }) {
  const { profile, period } = useStore();
  const movements = useMemo(
    // Du plus récent au plus ancien : c'est la dernière ligne qu'on vient vérifier.
    () => [...accountMovements(profile, summary.account, period)].reverse(),
    [profile, summary, period],
  );

  return (
    <Card title={`Relevé — ${summary.account.name}`}>
      {movements.map((movement) => (
        <div className="row" key={movement.transaction.id}>
          <div className="row-main">
            <div className="row-title">
              {movement.transaction.label ||
                (movement.transaction.category ? categoryLabel(movement.transaction.category) : 'Écriture')}
            </div>
            <div className="row-subtitle">
              {formatWeekday(movement.date)}
              {movement.transaction.category ? ` · ${categoryLabel(movement.transaction.category)}` : ''}
            </div>
          </div>
          <div className={`row-amount amount ${movement.amount.isNegative ? '' : 'positive'}`}>
            {movement.amount.isNegative ? '−' : '+'}
            {movement.amount.absolute.roundedToUnit.format()}
          </div>
          <div
            className={`row-amount amount tertiary ${movement.balanceAfter.isNegative ? 'critical' : ''}`}
            style={{ minWidth: 110 }}
            title="Solde après ce mouvement"
          >
            {movement.balanceAfter.roundedToUnit.format()}
          </div>
        </div>
      ))}
      <p className="rationale" style={{ marginTop: 12 }}>
        La colonne de droite est le solde après chaque ligne. Il se déduit du relevé du{' '}
        {parseDate(summary.account.balanceDate).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}{' '}
        et de tout ce qui a suivi — rien n’est saisi à la main.
      </p>
    </Card>
  );
}

