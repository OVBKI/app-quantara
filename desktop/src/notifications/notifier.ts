import type { Alert } from '../core/engine/alerts';
import { alertSignature } from '../core/engine/alerts';

/**
 * Notifications système.
 *
 * Limite à énoncer franchement : **l'application doit être ouverte**. Une application de
 * bureau qui ne tourne pas ne peut rien notifier — contrairement à un téléphone, où le
 * système prend le relais. Les alertes apparaissent donc à l'ouverture, et pendant
 * l'utilisation.
 *
 * Le suivi de ce qui a déjà été notifié vit dans le stockage local : une même alerte
 * n'interrompt qu'une fois par jour, sans quoi elle deviendrait du bruit et serait ignorée.
 *
 * **Sauf si le profil est chiffré.** Une signature comme « overdraft|2026-08-21 » ou
 * « emergencyFund.3 » est une information financière : elle dit qu'un découvert était
 * prévu ce jour-là, ou combien de mois l'épargne couvre. Quelqu'un qui chiffre son profil
 * le fait précisément pour qu'un accès au disque n'apprenne rien — laisser cette trace en
 * clair à côté annulerait une partie de ce qu'il a demandé.
 *
 * Le suivi reste alors en mémoire, le temps de la session. Le prix est modeste et assumé :
 * une alerte persistante peut réapparaître une fois par lancement au lieu d'une fois par
 * jour. C'est exactement l'échange que le chiffrement propose.
 */

const SEEN_KEY = 'quantara.notifications.seen';
const MAX_PER_SESSION = 3;

/** Suivi de session, utilisé quand le profil est chiffré. */
let inMemorySeen = new Set<string>();

function runningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function seenSignatures(persist: boolean): Set<string> {
  if (!persist) return new Set(inMemorySeen);
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function remember(signatures: Set<string>, persist: boolean): void {
  if (!persist) {
    inMemorySeen = signatures;
    return;
  }
  try {
    // On ne conserve que les cent dernières : le fichier n'a pas vocation à grossir.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...signatures].slice(-100)));
  } catch {
    // Stockage indisponible : au pire une alerte se répète, ce n'est pas grave.
  }
}

/** Efface la trace en clair. Appelé quand le chiffrement est activé : ce qui a été noté
 *  avant ne doit pas rester sur le disque. */
export function forgetPersistedNotifications(): void {
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // Rien à faire : le stockage est indisponible, donc il n'y a rien à effacer.
  }
}

async function notificationsAllowed(): Promise<boolean> {
  if (!runningInTauri()) return false;
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Envoie les alertes non encore vues aujourd'hui.
 *
 * Renvoie le nombre effectivement notifié — zéro dans un navigateur, où l'application
 * n'a pas accès au centre de notifications du système.
 */
export async function notify(
  alerts: readonly Alert[],
  reference: Date = new Date(),
  /** Profil chiffré : le suivi ne quitte pas la mémoire. */
  encrypted = false,
): Promise<number> {
  if (alerts.length === 0 || !runningInTauri()) return 0;
  if (!(await notificationsAllowed())) return 0;

  const persist = !encrypted;
  const seen = seenSignatures(persist);
  const pending = alerts
    .filter((alert) => !seen.has(alertSignature(alert, reference)))
    .slice(0, MAX_PER_SESSION);

  if (pending.length === 0) return 0;

  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    for (const alert of pending) {
      sendNotification({ title: alert.title, body: alert.body });
      seen.add(alertSignature(alert, reference));
    }
    remember(seen, persist);
    return pending.length;
  } catch {
    return 0;
  }
}
