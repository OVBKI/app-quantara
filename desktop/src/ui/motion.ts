import { useEffect, useRef, useState } from 'react';

/**
 * Mouvement.
 *
 * Une animation n'est pas là pour décorer : elle sert à montrer d'où vient un chiffre,
 * à relier un état au suivant, à confirmer qu'une action a été prise en compte. Tout
 * mouvement qui n'explique rien est du bruit, et sur un écran de finances le bruit
 * finit par cacher les montants.
 *
 * D'où trois règles tenues partout :
 *  — rien ne dure plus de 700 ms ; au-delà, on attend l'interface au lieu de la lire ;
 *  — rien ne se rejoue à chaque rendu, seulement à l'apparition ou au changement ;
 *  — `prefers-reduced-motion` coupe tout, sans exception et sans dégrader l'information.
 */

/**
 * Le système demande-t-il moins de mouvement ?
 *
 * Suivi en direct : quelqu'un qui active le réglage pendant que l'application tourne
 * n'a pas à la redémarrer — et c'est souvent parce qu'un mouvement vient de le gêner.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Décélération : rapide au départ, posée à l'arrivée. Un compteur linéaire s'arrête
 *  net et donne l'impression d'un bug plutôt que d'une fin. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export interface CountUp {
  /** Valeur intermédiaire, à afficher pendant le décompte. */
  readonly value: number;
  /** `true` une fois arrivé : c'est alors le montant exact qu'il faut afficher, pas
   *  l'approximation du dernier pas. */
  readonly done: boolean;
}

/**
 * Décompte animé vers une valeur.
 *
 * Le chiffre monte depuis le précédent — depuis zéro à la première apparition. C'est le
 * seul mouvement qui porte une information : on voit *dans quel sens* le montant a
 * bougé depuis la dernière fois qu'on l'a regardé.
 *
 * Le drapeau `done` compte autant que la valeur : pendant l'animation on montre une
 * approximation, à l'arrivée le montant réel formaté par le moteur. Sans quoi un arrondi
 * d'affichage pourrait figer un centime faux.
 */
export function useCountUp(target: number, durationMs = 650): CountUp {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<CountUp>({ value: 0, done: false });
  // Zéro au départ : à la première apparition, le montant se construit sous les yeux.
  // Ensuite c'est la valeur précédente qui sert de point de départ, et l'animation dit
  // alors dans quel sens le chiffre a bougé.
  const from = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      from.current = target;
      setState({ value: target, done: true });
      return;
    }

    const start = from.current;
    if (start === target) {
      setState({ value: target, done: true });
      return;
    }

    let startedAt: number | null = null;
    const step = (now: number) => {
      startedAt ??= now;
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const value = start + (target - start) * easeOut(progress);
      if (progress >= 1) {
        from.current = target;
        setState({ value: target, done: true });
        return;
      }
      setState({ value, done: false });
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, durationMs, reduced]);

  return state;
}
