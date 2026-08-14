import { useMemo, useRef, useState } from 'react';
import { categoryLabel } from '../core/categories';
import { FREQUENCY_LABELS } from '../core/frequency';
import { importCsv, exportCsv, type ImportReport } from '../core/engine/csv';
import { detectRecurrences, normalize } from '../core/engine/categorizer';
import { useStore } from '../state/store';
import { Modal } from './components';

/**
 * Import d'un relevé bancaire.
 *
 * Le fichier est lu sur la machine et jamais transmis. Un aperçu précède l'ajout :
 * un import qui se déverse directement dans les comptes sans montrer ce qu'il a compris
 * est impossible à corriger une fois fait.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { profile, addTransactions } = useStore();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileName, setFileName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function read(file: File): Promise<void> {
    setFileName(file.name);
    const text = await file.text();
    setReport(importCsv(text, profile.currency, profile.transactions, profile.categorizationRules));
  }

  return (
    <Modal title="Importer un relevé" onClose={onClose}>
      {!report ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Exportez votre relevé au format CSV depuis le site de votre banque, puis déposez-le ici. Le fichier
            est analysé sur cette machine ; rien n’est envoyé nulle part.
          </p>
          <p className="rationale">
            Les colonnes date, libellé et montant sont reconnues automatiquement, quel que soit le séparateur et
            la convention d’écriture des nombres. Les lignes déjà présentes ne sont pas ajoutées une seconde fois.
          </p>
          <button type="button" className="button button-primary" onClick={() => input.current?.click()}>
            Choisir un fichier CSV
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void read(file);
              event.target.value = '';
            }}
          />
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{fileName}</strong>
          </p>

          {report.errors.length > 0 ? (
            <>
              <div className="error-banner">Le fichier n’a pas pu être interprété.</div>
              {report.errors.map((error) => (
                <p className="rationale" key={error}>
                  · {error}
                </p>
              ))}
            </>
          ) : (
            <>
              <div className="grid grid-3" style={{ marginBottom: 16 }}>
                <div>
                  <div className="tile-label">À importer</div>
                  <div className="tile-value amount positive">{report.imported}</div>
                </div>
                <div>
                  <div className="tile-label">Doublons écartés</div>
                  <div className="tile-value amount">{report.duplicates}</div>
                </div>
                <div>
                  <div className="tile-label">Lignes ignorées</div>
                  <div className="tile-value amount">{report.skipped}</div>
                </div>
              </div>

              <div className="card-title">Aperçu</div>
              {report.transactions.slice(0, 6).map((transaction, index) => (
                <div className="row" key={index}>
                  <div className="row-main">
                    <div className="row-title">{transaction.label}</div>
                    <div className="row-subtitle">
                      {transaction.date}
                      {transaction.category ? ` · ${categoryLabel(transaction.category)}` : ' · non catégorisé'}
                    </div>
                  </div>
                  <div className={`row-amount amount ${transaction.kind === 'income' ? 'positive' : ''}`}>
                    {transaction.kind === 'income' ? '+ ' : '− '}
                    {transaction.amount.format()}
                  </div>
                </div>
              ))}
              {report.imported > 6 && <p className="rationale">…et {report.imported - 6} autres.</p>}
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="button" onClick={onClose}>
              Annuler
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={report.imported === 0}
              onClick={() => {
                addTransactions(report.transactions);
                onClose();
              }}
            >
              Importer {report.imported} transaction{report.imported > 1 ? 's' : ''}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * Conversion des dépenses récurrentes détectées.
 *
 * Un abonnement enregistré comme dépense variable fausse deux choses à la fois : la
 * projection du mois, qui l'extrapole comme s'il pouvait se répéter, et le disponible,
 * qui ignore qu'il retombera le mois prochain.
 */
export function RecurrenceDialog({ onClose }: { onClose: () => void }) {
  const { profile, addExpense } = useStore();
  const [ignored, setIgnored] = useState<string[]>([]);

  const detected = useMemo(() => {
    const known = new Set(profile.recurringExpenses.map((expense) => normalize(expense.name)));
    return detectRecurrences(profile.transactions).filter(
      (entry) => !known.has(entry.label) && !ignored.includes(entry.label),
    );
  }, [profile.transactions, profile.recurringExpenses, ignored]);

  return (
    <Modal title="Charges récurrentes détectées" onClose={onClose}>
      {detected.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Aucune dépense ne revient à intervalle assez régulier pour être une charge récurrente. Il faut au moins
          trois occurrences espacées de façon comparable.
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Ces dépenses reviennent régulièrement. Les déclarer comme charges les sort du calcul des dépenses
            variables, qui les extrapole à tort.
          </p>
          {detected.map((entry) => (
            <div className="row" key={entry.label} style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">{entry.label}</div>
                <div className="row-subtitle">
                  {entry.averageAmount.roundedTo(2).format()} · {FREQUENCY_LABELS[entry.suggestedFrequency].toLowerCase()}{' '}
                  · {entry.occurrences} occurrences
                </div>
              </div>
              <div className="inline">
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => {
                    addExpense({
                      name: entry.label
                        .toLowerCase()
                        .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
                      amount: entry.averageAmount.roundedTo(2),
                      frequency: entry.suggestedFrequency,
                      category: 'fixed.otherFixed',
                      dayOfMonth: 5,
                      subscription: true,
                      active: true,
                    });
                    setIgnored((current) => [...current, entry.label]);
                  }}
                >
                  Convertir
                </button>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={() => setIgnored((current) => [...current, entry.label])}
                >
                  Ignorer
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Modal>
  );
}

/** Export des transactions au format CSV, relisible par l'import. */
export function downloadTransactionsCsv(transactions: Parameters<typeof exportCsv>[0]): void {
  const blob = new Blob(['﻿' + exportCsv(transactions)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quantara-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
