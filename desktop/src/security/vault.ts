/**
 * Chiffrement du profil (§17 du cahier des charges).
 *
 * Un fichier de budget contient plus d'informations personnelles qu'un carnet d'adresses :
 * revenus, dettes, habitudes, parfois la santé par le détour d'une pharmacie. Sur une
 * machine partagée, il n'a rien à faire en clair.
 *
 * Le chiffrement est **facultatif et explicite** : sans mot de passe, le fichier reste
 * lisible — et l'application le dit, plutôt que de laisser croire à une protection qui
 * n'existe pas.
 *
 * Clé dérivée par PBKDF2-SHA256, chiffrement AES-GCM 256 bits, sel et vecteur
 * d'initialisation tirés au sort à chaque enregistrement. Le mot de passe n'est jamais
 * écrit sur le disque : il ne vit qu'en mémoire, le temps de la session.
 */

const FORMAT = 'quantara-encrypted-1';

/**
 * 600 000 itérations : la recommandation OWASP pour PBKDF2-SHA256. Environ une demi-seconde
 * sur une machine de bureau — imperceptible à l'ouverture, très coûteux pour qui tente
 * des millions de mots de passe.
 */
const ITERATIONS = 600_000;

export interface EncryptedEnvelope {
  readonly format: typeof FORMAT;
  readonly salt: string;
  readonly iv: string;
  readonly data: string;
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EncryptedEnvelope).format === FORMAT &&
    typeof (value as EncryptedEnvelope).data === 'string'
  );
}

/** `crypto.subtle` exige un contexte sécurisé. Absent, on refuse plutôt que de faire semblant. */
export function encryptionAvailable(): boolean {
  return typeof globalThis.crypto?.subtle?.deriveKey === 'function';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(plaintext: string, password: string): Promise<EncryptedEnvelope> {
  if (!encryptionAvailable()) {
    throw new Error('Le chiffrement n’est pas disponible dans cet environnement.');
  }
  // Sel et vecteur neufs à chaque écriture : deux enregistrements du même contenu ne
  // produisent pas le même fichier, et rien ne fuit par comparaison.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );

  return {
    format: FORMAT,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encrypted)),
  };
}

export async function decrypt(envelope: EncryptedEnvelope, password: string): Promise<string> {
  const key = await deriveKey(password, fromBase64(envelope.salt));
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
      key,
      fromBase64(envelope.data) as BufferSource,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // AES-GCM authentifie le contenu : un échec signifie mot de passe faux ou fichier
    // altéré. On ne distingue pas les deux, cela n'apprendrait rien d'utile à un attaquant.
    throw new Error('Mot de passe incorrect, ou fichier altéré.');
  }
}

/** Force du mot de passe, pour informer sans bloquer. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  const length = password.length;
  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));

  if (length < 8) return { score: 0, label: 'Trop court — huit caractères au minimum' };
  if (length >= 16 || (length >= 12 && variety >= 3)) return { score: 3, label: 'Solide' };
  if (length >= 12 || variety >= 3) return { score: 2, label: 'Correct' };
  return { score: 1, label: 'Faible — allongez-le plutôt que d’ajouter des symboles' };
}
