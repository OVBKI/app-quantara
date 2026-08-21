import { useMemo, useState } from 'react';
import { Money } from '../core/money';
import {
  INCOME_CATEGORIES,
  INCOME_LABELS,
  visibleCategoryIds,
  allCategories,
  categoryLabel,
  type ExpenseCategoryId,
  type IncomeCategory,
} from '../core/categories';
import { containsDate, formatDate, parseDate } from '../core/yearMonth';
import type { Transaction, TransactionKind } from '../core/model';
import { useStore } from '../state/store';
import { Card, EmptyState, Field, Modal, MoneyInput, parseAmount, useConfirm } from './components';
import { ImportDialog, RecurrenceDialog, downloadTransactionsCsv } from './TransactionTools';
import { categorize } from '../core/engine/categorizer';
import { formatLongWeekday } from './dates';

const KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Dépense',
  income: 'Revenu',
  savings: 'Épargne',
  transfer: 'Virement',
  debtPayment: 'Remboursement',
};

type PeriodFilter = 'currentMonth' | 'threeMonths' | 'year' | 'all';

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  currentMonth: 'Mois affiché',
  threeMonths: '3 derniers mois',
  year: '12 derniers mois',
  all: 'Tout',
};

export function TransactionsScreen() {
  const { profile, period, addTransaction, updateTransaction, removeTransaction } = useStore();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<TransactionKind | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategoryId | 'all'>('all');
  const [accountFilter, setAccountFilter] = useState<string | 'all'>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('currentMonth');
  const [minAmount, setMinAmount] = useState('');
  const [form, setForm] = useState<Transaction | true | null>(null);
  const [importing, setImporting] = useState(false);
  const [recurrences, setRecurrences] = useState(false);
  const [confirmNode, confirm] = useConfirm();

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const floor = parseAmount(minAmount, profile.currency);

    // Fenêtre de dates. Par défaut le mois affiché dans la barre latérale : sans cela, la
    // liste ignore le sélecteur de mois et deux notions de « maintenant » coexistent.
    const start = new Date(period.year, period.month - 1, 1);
    const bound =
      periodFilter === 'currentMonth'
        ? null
        : periodFilter === 'threeMonths'
          ? new Date(period.year, period.month - 4, 1)
          : periodFilter === 'year'
            ? new Date(period.year - 1, period.month - 1, 1)
            : null;

    return [...profile.transactions]
      .filter((transaction) => {
        if (periodFilter === 'all') return true;
        const date = parseDate(transaction.date);
        if (periodFilter === 'currentMonth') return containsDate(period, date);
        return bound !== null && date >= bound && date <= new Date(start.getFullYear(), start.getMonth() + 1, 0);
      })
      .filter((transaction) => (kindFilter === 'all' ? true : transaction.kind === kindFilter))
      .filter((transaction) => (categoryFilter === 'all' ? true : transaction.category === categoryFilter))
      .filter((transaction) =>
        accountFilter === 'all'
          ? true
          : transaction.accountId === accountFilter || transaction.toAccountId === accountFilter,
      )
      .filter((transaction) => (floor === null ? true : transaction.amount.greaterThanOrEqual(floor)))
      .filter((transaction) => {
        if (needle === '') return true;
        const haystack = [
          transaction.label,
          transaction.category ? categoryLabel(transaction.category) : '',
          transaction.note ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [profile.transactions, profile.currency, period, search, kindFilter, categoryFilter, accountFilter, periodFilter, minAmount]);

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const transaction of filtered) {
      const key = transaction.date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), transaction]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">
            {profile.transactions.length} enregistrée{profile.transactions.length > 1 ? 's' : ''}
          </p>
        </div>
        <div className="inline">
          <button type="button" className="button" onClick={() => setRecurrences(true)}>
            Détecter les récurrences
          </button>
          <button type="button" className="button" onClick={() => setImporting(true)}>
            Importer un relevé
          </button>
          <button
            type="button"
            className="button"
            disabled={profile.transactions.length === 0}
            onClick={() => downloadTransactionsCsv(profile.transactions)}
          >
            Exporter
          </button>
          <button type="button" className="button button-primary" onClick={() => setForm(true)}>
            Nouvelle transaction
          </button>
        </div>
      </header>

      <Card>
        <div className="field-row" style={{ marginBottom: 12 }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un libellé, une catégorie…"
            aria-label="Rechercher"
          />
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value as PeriodFilter)}
            aria-label="Filtrer par période"
          >
            {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((entry) => (
              <option key={entry} value={entry}>
                {PERIOD_LABELS[entry]}
              </option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as TransactionKind | 'all')}
            aria-label="Filtrer par nature"
          >
            <option value="all">Toutes les natures</option>
            {(Object.keys(KIND_LABELS) as TransactionKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row" style={{ marginBottom: 16 }}>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filtrer par catégorie"
          >
            <option value="all">Toutes les catégories</option>
            {allCategories().map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            aria-label="Filtrer par compte"
            disabled={profile.accounts.length === 0}
          >
            <option value="all">Tous les comptes</option>
            {profile.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <MoneyInput
            value={minAmount}
            currency={profile.currency}
            onChange={setMinAmount}
            label="Montant minimum"
          />
        </div>

        {filtered.length !== profile.transactions.length && (
          <p className="rationale" style={{ marginTop: 0, marginBottom: 12 }}>
            {filtered.length} sur {profile.transactions.length} transactions affichées.{' '}
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => {
                setSearch('');
                setKindFilter('all');
                setCategoryFilter('all');
                setAccountFilter('all');
                setPeriodFilter('all');
                setMinAmount('');
              }}
            >
              Tout afficher
            </button>
          </p>
        )}

        {grouped.length === 0 ? (
          <EmptyState
            title="Aucune transaction"
            message="Les charges récurrentes sont déjà prises en compte par ailleurs. Ici, enregistrez ce qui varie : courses, restaurants, imprévus."
            action={
              <button type="button" className="button button-primary" onClick={() => setForm(true)}>
                Enregistrer une dépense
              </button>
            }
          />
        ) : (
          grouped.map(([date, entries]) => (
            <div key={date} style={{ marginBottom: 18 }}>
              <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="row-subtitle" style={{ textTransform: 'capitalize' }}>
                  {formatLongWeekday(date)}
                </span>
                <span className="row-subtitle amount">{dayTotal(entries, profile.currency)}</span>
              </div>
              {entries.map((transaction) => (
                <div className="row" key={transaction.id}>
                  <button
                    type="button"
                    className="row-main"
                    onClick={() => setForm(transaction)}
                    style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                    aria-label={`Modifier ${transaction.label}`}
                  >
                    <div className="row-title">{transaction.label}</div>
                    <div className="row-subtitle">
                      {transaction.category
                        ? categoryLabel(transaction.category)
                        : transaction.incomeCategory
                          ? INCOME_LABELS[transaction.incomeCategory]
                          : KIND_LABELS[transaction.kind]}
                      {transaction.note ? ` · ${transaction.note}` : ''}
                    </div>
                  </button>
                  <div
                    className={`row-amount amount ${transaction.kind === 'income' ? 'positive' : ''}`}
                  >
                    {transaction.kind === 'income' ? '+ ' : transaction.kind === 'transfer' ? '' : '− '}
                    {transaction.amount.format()}
                  </div>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Dupliquer ${transaction.label}`}
                    title="Dupliquer"
                    onClick={() => {
                      // Dupliquée à la date du jour : on duplique une dépense parce
                      // qu'elle se répète, pas pour recréer celle du mois dernier.
                      const { id: _id, ...rest } = transaction;
                      addTransaction({ ...rest, date: formatDate(new Date()) });
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    aria-label={`Supprimer ${transaction.label}`}
                    onClick={() =>
                      confirm(`Supprimer « ${transaction.label} » ?`, () => removeTransaction(transaction.id))
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>

      {form && (
        <TransactionForm
          initial={form === true ? null : form}
          currency={profile.currency}
          rules={profile.categorizationRules}
          onClose={() => setForm(null)}
          onSubmit={(draft) => {
            if (form === true) addTransaction(draft);
            else updateTransaction({ ...form, ...draft });
          }}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {recurrences && <RecurrenceDialog onClose={() => setRecurrences(false)} />}
      {confirmNode}
    </>
  );
}

function dayTotal(entries: readonly Transaction[], currency: Money['currency']): string {
  const total = entries.reduce((sum, transaction) => {
    if (transaction.kind === 'income') return sum.plus(transaction.amount);
    if (transaction.kind === 'transfer') return sum;
    return sum.minus(transaction.amount);
  }, Money.zero(currency));
  return total.format();
}

function TransactionForm({
  initial,
  currency,
  rules,
  onClose,
  onSubmit,
}: {
  initial: Transaction | null;
  currency: Money['currency'];
  rules: readonly import('../core/engine/categorizer').CategorizationRule[];
  onClose: () => void;
  onSubmit: (transaction: Omit<Transaction, 'id'>) => void;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.amount.units) : '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? 'expense');
  const [category, setCategory] = useState<ExpenseCategoryId>(initial?.category ?? 'variable.groceries');
  const [incomeCategory, setIncomeCategory] = useState<IncomeCategory>(initial?.incomeCategory ?? 'salary');
  const [date, setDate] = useState(initial?.date ?? formatDate(new Date()));
  const [note, setNote] = useState(initial?.note ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? '');
  const [autoCategorized, setAutoCategorized] = useState(false);

  const { profile } = useStore();
  const accounts = profile.accounts.filter((account) => !account.archived);
  const movesBetweenAccounts = kind === 'transfer' || kind === 'savings';

  const parsed = parseAmount(amount, currency);
  const error =
    amount.trim() !== '' && parsed === null
      ? 'Ce montant n’est pas un nombre valide. Utilisez la virgule ou le point pour les centimes.'
      : parsed?.isNegative
        ? 'Un montant se saisit toujours positif : c’est la nature choisie ci-dessus qui décide du sens.'
        : parsed?.isZero && amount.trim() !== ''
          ? 'Un montant nul n’a aucun effet sur le budget.'
          : Number.isNaN(new Date(date).getTime())
            ? 'La date n’est pas valide.'
            : movesBetweenAccounts && accountId !== '' && accountId === toAccountId
              ? 'Un virement doit relier deux comptes différents.'
              : null;

  // Catégorisation locale au fil de la frappe : la friction de saisie est la première
  // cause d'abandon d'une application de budget.
  function onLabelChange(text: string): void {
    setLabel(text);
    if (kind !== 'expense' || text.trim().length < 3) return;
    const guessed = categorize(text, rules);
    if (guessed) {
      setCategory(guessed.category);
      setAutoCategorized(true);
    }
  }

  return (
    <Modal title={initial ? 'Modifier la transaction' : 'Nouvelle transaction'} onClose={onClose}>
      <div className="field-row">
        <Field label="Montant">
          {(id) => <MoneyInput id={id} value={amount} currency={currency} onChange={setAmount} autoFocus />}
        </Field>
        <Field label="Date">
          {(id) => <input id={id} type="date" value={date} onChange={(event) => setDate(event.target.value)} />}
        </Field>
      </div>

      <Field label="Nature">
        {(id) => (
          <select id={id} value={kind} onChange={(event) => setKind(event.target.value as TransactionKind)}>
            {(Object.keys(KIND_LABELS) as TransactionKind[]).map((entry) => (
              <option key={entry} value={entry}>
                {KIND_LABELS[entry]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Libellé">
        {(id) => (
          <input id={id} value={label} onChange={(event) => onLabelChange(event.target.value)} placeholder="Courses" />
        )}
      </Field>

      {accounts.length > 0 && (
        <div className="field-row">
          <Field label={movesBetweenAccounts ? 'Depuis le compte' : kind === 'income' ? 'Versé sur' : 'Payé depuis'}>
            {(id) => (
              <select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">Non précisé</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {movesBetweenAccounts && (
            <Field label="Vers le compte" hint="Un virement déplace l’argent, il ne le dépense pas.">
              {(id) => (
                <select id={id} value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                  <option value="">Non précisé</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
      )}

      {kind === 'expense' && (
        <Field
          label="Catégorie"
          hint={
            autoCategorized
              ? 'Catégorie reconnue depuis le libellé — modifiable.'
              : 'Les catégories variables viennent en premier : ce sont les plus fréquentes.'
          }
        >
          {(id) => (
            <select
              id={id}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as ExpenseCategoryId);
                setAutoCategorized(false);
              }}
            >
              {[...visibleCategoryIds('variable'), ...visibleCategoryIds('fixed')].map(
                (entry) => (
                  <option key={entry} value={entry}>
                    {categoryLabel(entry)}
                  </option>
                ),
              )}
            </select>
          )}
        </Field>
      )}

      {kind === 'income' && (
        <Field label="Nature du revenu">
          {(id) => (
            <select
              id={id}
              value={incomeCategory}
              onChange={(event) => setIncomeCategory(event.target.value as IncomeCategory)}
            >
              {INCOME_CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {INCOME_LABELS[entry]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field label="Note">
        {(id) => <input id={id} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>

      {error && <p className="error-text">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!parsed || !parsed.isPositive || error !== null}
          onClick={() => {
            if (!parsed) return;
            onSubmit({
              amount: parsed,
              date,
              kind,
              label: label.trim() || (kind === 'expense' ? categoryLabel(category) : KIND_LABELS[kind]),
              category: kind === 'expense' ? category : undefined,
              incomeCategory: kind === 'income' ? incomeCategory : undefined,
              note: note.trim() || undefined,
              accountId: accountId || undefined,
              toAccountId: movesBetweenAccounts && toAccountId ? toAccountId : undefined,
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
