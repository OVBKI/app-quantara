import { useEffect, useState } from 'react';

/**
 * Navigation par ancre.
 *
 * L'écran courant vit dans l'URL (`#/budget`) plutôt que dans un état React. Deux
 * conséquences concrètes : le bouton « précédent » fonctionne, et recharger la fenêtre
 * ramène là où on était plutôt qu'à l'accueil.
 *
 * L'ancre, et non le chemin : une application servie depuis un fichier local n'a pas de
 * serveur pour répondre à `/budget`, et l'historique HTML5 y renverrait une page absente.
 */

export function readRoute<T extends string>(allowed: readonly T[], fallback: T): T {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function useHashRoute<T extends string>(allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [route, setRoute] = useState<T>(() => readRoute(allowed, fallback));

  useEffect(() => {
    const onChange = () => setRoute(readRoute(allowed, fallback));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
    // `allowed` et `fallback` sont des constantes de module : les lister ferait
    // réabonner à chaque rendu sans rien changer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navigate(next: T): void {
    if (next === route) return;
    // Écrire l'ancre suffit : l'événement `hashchange` met l'état à jour, et le
    // navigateur empile l'entrée d'historique qui rend le retour arrière possible.
    window.location.hash = `/${next}`;
  }

  return [route, navigate];
}
