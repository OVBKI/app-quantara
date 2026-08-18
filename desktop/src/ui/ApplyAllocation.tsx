import { useMemo, useState } from 'react';
import { ALLOCATION_PART_LABELS, type AllocationPart } from '../core/model';
import { formatYearMonth, parseDate } from '../core/yearMonth';
import {
  applicationTransactions,
  appliedAllocation,
  appliedTotal,
  destinationAccounts,
  planApplication,
  spendingAccounts,
} from '../core/engine/applyAllocation';
import { useStore } from '../state/store';
import { Field, Modal } from './components';
import { ALLOCATION_PART_COLORS } from './allocationVisual';

/**
 * « Oui » — le moment où le partage cesse d'être un tableau.
 *
 * Le calcul ne sert à rien s'il reste à l'écran : tant que la part de sécurité dort sur
 * le compte courant, elle finit dépensée. Ce bouton la déplace vraiment, et le solde
 * disponible baisse d'autant.
 *
 * Trois précautions, parce qu'il s'agit d'argent :
 *  — la fenêtre décrit chaque mouvement, montant et compte, avant confirmation ;
 *  — un mois déjà partagé le dit, et propose de défaire plutôt que de recommencer ;
 *  — tout se défait d'un geste, et `Ctrl+Z` fonctionne aussi.
 *
 * Ces écritures sont internes : elles enregistrent ce que vous faites de votre argent.
 * L'application ne parle à aucune banque, et ne commande aucun virement réel.
 */
export function ApplyAllocationButton({ compact = false }: { readonly compact?: boolean }) {
  const { profile, analysis, period, addTransactions, removeTransactions } = useStore();
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Partial<Record<AllocationPart | 'source', string>>>({});

  const applied = useMemo(() => appliedAllocation(profile, period), [profile, period]);
  const application = useMemo(
    () => planApplication(profile, analysis.allocation, period, overrides),
    [profile, analysis, period, overrides],
  );

  const accountName = (id: string | null | undefined): string =>
    profile.accounts.find((account) => account.id === id)?.name ?? 'compte inconnu';

  if (applied.length > 0) {
    const when = applied[0]?.date;
    return (
      <div className="apply-done">
        <span className="apply-done-mark" aria-hidden="true">
          ✓
        </span>
        <div>
          <div className="apply-done-title">
            {appliedTotal(profile, period).roundedToUnit.format()} déjà mis de côté
          </div>
          <div className="tertiary">
            {when ? `Partagé le ${parseDate(when).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : ''} ·
            retiré de votre solde disponible
          </div>
        </div>
        <button
          type="button"
          className="button button-small"
          onClick={() => removeTransactions(applied.map((transaction) => transaction.id))}
        >
          Annuler le partage
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={compact ? 'button button-small' : 'button button-primary'}
        disabled={application.blocked !== null}
        title={application.blocked ?? undefined}
        onClick={() => setOpen(true)}
      >
        Mettre de côté maintenant
      </button>

      {application.blocked !== null && !compact && <p className="rationale">{application.blocked}</p>}

      {open && (
        <Modal title="Confirmer le partage" onClose={() => setOpen(false)}>
          <p>
            Cet argent quittera <strong>{accountName(application.fromAccountId)}</strong> pour vos autres comptes.
            Votre solde disponible baissera de{' '}
            <strong className="amount">{application.total.roundedToUnit.format()}</strong> — vous ne perdez rien,
            vous le rangez ailleurs.
          </p>

          <div className="apply-list">
            {application.moves.map((move) => {
              const candidates = destinationAccounts(profile, move.part);
              return (
                <div className="apply-move" key={move.part}>
                  <span className="dot" style={{ background: ALLOCATION_PART_COLORS[move.part] }} aria-hidden="true" />
                  <div className="apply-move-main">
                    <div className="row-title">{move.label}</div>
                    {candidates.length > 1 ? (
                      <select
                        value={move.toAccountId}
                        aria-label={`Compte destinataire pour ${move.label}`}
                        onChange={(event) =>
                          setOverrides((current) => ({ ...current, [move.part]: event.target.value }))
                        }
                      >
                        {candidates.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="row-subtitle">vers {accountName(move.toAccountId)}</div>
                    )}
                  </div>
                  <div className="row-amount amount">{move.amount.roundedToUnit.format()}</div>
                </div>
              );
            })}

            {application.stays.isPositive && (
              <div className="apply-move">
                <span className="dot" style={{ background: ALLOCATION_PART_COLORS.free }} aria-hidden="true" />
                <div className="apply-move-main">
                  <div className="row-title">{ALLOCATION_PART_LABELS.free}</div>
                  <div className="row-subtitle">reste sur {accountName(application.fromAccountId)}</div>
                </div>
                <div className="row-amount amount tertiary">{application.stays.roundedToUnit.format()}</div>
              </div>
            )}
          </div>

          {application.missingAccounts.length > 0 && (
            <p className="rationale warning">
              Aucun compte pour :{' '}
              {application.missingAccounts.map((part) => ALLOCATION_PART_LABELS[part].toLowerCase()).join(', ')}. Cette
              part reste sur votre compte courant tant que vous n’avez pas créé le compte dans les Réglages.
            </p>
          )}

          {spendingAccounts(profile).length > 1 && (
            <Field label="Depuis quel compte ?">
              {(id) => (
                <select
                  id={id}
                  value={application.fromAccountId ?? ''}
                  onChange={(event) => setOverrides((current) => ({ ...current, source: event.target.value }))}
                >
                  {spendingAccounts(profile).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <p className="rationale">
            Écriture datée du {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, sur{' '}
            {formatYearMonth(period)}. Ce sont des écritures internes à
            Quantara : aucun virement n’est envoyé à votre banque, à vous de le faire de votre côté. Vous pourrez tout
            annuler d’un clic.
          </p>

          <div className="modal-actions">
            <button type="button" className="button" onClick={() => setOpen(false)}>
              Pas maintenant
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                addTransactions(applicationTransactions(application));
                setOpen(false);
              }}
            >
              Oui, mettre de côté
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
