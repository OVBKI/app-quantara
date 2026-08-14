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
 */

const SEEN_KEY = 'quantara.notifications.seen';
const MAX_PER_SESSION = 3;

function runningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function seenSignatures(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function remember(signatures: Set<string>): void {
  try {
    // On ne conserve que les cent dernières : le fichier n'a pas vocation à grossir.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...signatures].slice(-100)));
  } catch {
    // Stockage indisponible : au pire une alerte se répète, ce n'est pas grave.
  }
}

export async function notificationsAllowed(): Promise<boolean> {
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
export async function notify(alerts: readonly Alert[], reference: Date = new Date()): Promise<number> {
  if (alerts.length === 0 || !runningInTauri()) return 0;
  if (!(await notificationsAllowed())) return 0;

  const seen = seenSignatures();
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
    remember(seen);
    return pending.length;
  } catch {
    return 0;
  }
}
