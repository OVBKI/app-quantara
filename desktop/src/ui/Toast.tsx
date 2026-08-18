import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Confirmations éphémères.
 *
 * Une action qui ne dit rien laisse un doute : « est-ce que ça a marché ? ». Un message
 * qui s'affiche puis s'efface répond sans obliger à cliquer sur « OK ».
 *
 * Deux exigences, parce qu'il s'agit d'argent :
 *  — le message dit **ce qui a changé**, chiffré, pas « Opération réussie » ;
 *  — quand l'action se défait, le message porte le bouton pour la défaire, là où l'œil
 *    est déjà. Chercher « annuler » ailleurs, c'est l'annulation qui n'arrive jamais.
 *
 * Le lecteur d'écran reçoit le texte par une région `polite` : annoncé, mais sans couper
 * ce qui est en train d'être lu.
 */

export type ToastTone = 'neutral' | 'positive' | 'critical';

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastRequest {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
  /** Durée d'affichage. Un message porteur d'une annulation reste plus longtemps. */
  readonly durationMs?: number;
}

interface Toast extends ToastRequest {
  readonly id: number;
}

const ToastContext = createContext<((request: ToastRequest) => void) | null>(null);

export function useToast(): (request: ToastRequest) => void {
  const push = useContext(ToastContext);
  // Hors fournisseur — un test unitaire, par exemple — le message est simplement perdu.
  // Une action ne doit jamais échouer parce que sa confirmation n'a pas pu s'afficher.
  return push ?? (() => {});
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((request: ToastRequest) => {
    nextId.current += 1;
    const id = nextId.current;
    // Trois messages au plus : au-delà, la pile masque le contenu qu'elle commente.
    setToasts((current) => [...current.slice(-2), { ...request, id }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { readonly toast: Toast; readonly onDismiss: () => void }) {
  const duration = toast.durationMs ?? (toast.action ? 8000 : 4000);

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className={`toast toast-${toast.tone ?? 'neutral'}`}>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Fermer" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
