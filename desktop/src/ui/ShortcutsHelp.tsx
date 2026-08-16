import { Modal } from './components';

export interface Shortcut {
  readonly keys: string;
  readonly action: string;
}

/**
 * Raccourcis clavier.
 *
 * Peu nombreux, et tous rappelés au même endroit : un raccourci que personne ne connaît
 * n'existe pas. `?` ouvre cette liste, ce qui est la convention la plus répandue.
 *
 * Aucun ne se déclenche pendant une saisie — taper « 3 » dans un montant doit écrire 3,
 * pas changer d'écran.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: '1 … 6', action: 'Aller à l’un des six écrans principaux' },
  { keys: 'N', action: 'Noter une dépense' },
  { keys: 'M / P', action: 'Mois précédent / mois suivant' },
  { keys: 'Ctrl + Z', action: 'Annuler la dernière modification' },
  { keys: 'Échap', action: 'Fermer la fenêtre ouverte' },
  { keys: '?', action: 'Afficher cette liste' },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Raccourcis clavier" onClose={onClose}>
      {SHORTCUTS.map((shortcut) => (
        <div className="row" key={shortcut.keys}>
          <div className="row-main">{shortcut.action}</div>
          <kbd
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '3px 9px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-raised)',
              whiteSpace: 'nowrap',
            }}
          >
            {shortcut.keys}
          </kbd>
        </div>
      ))}
      <p className="rationale" style={{ marginTop: 14 }}>
        Aucun raccourci ne se déclenche pendant une saisie : dans un champ, les touches
        écrivent ce qu’elles disent.
      </p>
      <div className="modal-actions">
        <button type="button" className="button button-primary" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Modal>
  );
}
