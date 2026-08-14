import { useState } from 'react';
import { useStore } from '../state/store';
import { Field } from './components';

/**
 * Écran de déverrouillage.
 *
 * Aucune donnée n'est chargée en mémoire tant que le mot de passe n'est pas fourni :
 * ce n'est pas un rideau posé devant l'application, le fichier lui-même est illisible.
 */
export function LockScreen() {
  const { unlock } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboarding" style={{ maxWidth: 420 }}>
      <div className="brand" style={{ padding: '0 0 24px', justifyContent: 'center' }}>
        <span className="brand-mark" />
        Quantara
      </div>

      <div className="card">
        <h1 className="page-title" style={{ fontSize: 18, marginTop: 0 }}>
          Profil verrouillé
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Vos données sont chiffrées sur ce poste. Le mot de passe n’est enregistré nulle part : il n’existe
          aucun moyen de le retrouver, ni pour vous ni pour quiconque.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Mot de passe">
            {(id) => (
              <input
                id={id}
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          <button
            type="submit"
            className="button button-primary"
            disabled={password.length === 0 || busy}
            style={{ width: '100%' }}
          >
            {busy ? 'Déchiffrement…' : 'Déverrouiller'}
          </button>
        </form>
      </div>

      <p className="nav-footnote" style={{ textAlign: 'center' }}>
        Le déchiffrement prend une demi-seconde : c’est délibéré. Cette lenteur rend inexploitable une attaque
        par essais successifs.
      </p>
    </div>
  );
}
