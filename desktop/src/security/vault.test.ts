import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, encryptionAvailable, isEncryptedEnvelope, passwordStrength } from './vault';

describe('Chiffrement du profil', () => {
  it('est disponible dans cet environnement', () => {
    expect(encryptionAvailable()).toBe(true);
  });

  it('rend le contenu illisible puis le restitue à l’identique', async () => {
    const secret = JSON.stringify({ salaire: 3200, dettes: ['crédit auto'] });
    const envelope = await encrypt(secret, 'un mot de passe correct');

    expect(isEncryptedEnvelope(envelope)).toBe(true);
    // Aucun fragment du contenu ne doit transparaître dans le fichier écrit.
    expect(envelope.data).not.toContain('salaire');
    expect(envelope.data).not.toContain('3200');

    expect(await decrypt(envelope, 'un mot de passe correct')).toBe(secret);
  });

  it('refuse un mot de passe incorrect sans laisser deviner pourquoi', async () => {
    const envelope = await encrypt('données', 'le bon mot de passe');
    await expect(decrypt(envelope, 'le mauvais')).rejects.toThrow(/incorrect|altéré/);
  });

  it('détecte une altération du fichier', async () => {
    const envelope = await encrypt('données', 'mot de passe');
    // AES-GCM authentifie le contenu : un octet modifié invalide tout le message.
    const corrupted = { ...envelope, data: `${envelope.data.slice(0, -4)}AAAA` };
    await expect(decrypt(corrupted, 'mot de passe')).rejects.toThrow();
  });

  it('produit deux fichiers différents pour un même contenu', async () => {
    // Sel et vecteur neufs à chaque écriture : sans cela, comparer deux sauvegardes
    // révélerait qu'elles portent les mêmes données.
    const first = await encrypt('identique', 'mot de passe');
    const second = await encrypt('identique', 'mot de passe');

    expect(first.data).not.toBe(second.data);
    expect(first.salt).not.toBe(second.salt);
    expect(await decrypt(second, 'mot de passe')).toBe('identique');
  });

  it('juge la force d’un mot de passe sur la longueur avant la variété', () => {
    expect(passwordStrength('Ab1!').score).toBe(0);
    expect(passwordStrength('correcthorsebatterystaple').score).toBe(3);
    // Court et « complexe » vaut moins qu'une longue phrase simple.
    expect(passwordStrength('Ab1!Ab1!').score).toBeLessThan(passwordStrength('correcthorsebattery').score);
  });
});
