import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

// Lets Super Admin recover a user's CURRENT login password to share it
// (e.g. via WhatsApp) - separate from the bcrypt hash used for actual
// login verification, which stays untouched and one-way. AES-256-GCM with
// a random IV per call; output is "iv:authTag:ciphertext" (all base64).
// PASSWORD_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Losing/rotating
// this key only breaks recovery of previously-encrypted passwords - it
// has no effect on login, which never reads this field.
function getKey(): Buffer {
  const hex = process.env.PASSWORD_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new InternalServerErrorException('PASSWORD_ENCRYPTION_KEY is not configured correctly (expected 64 hex chars)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptPassword(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptPassword(encrypted: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new InternalServerErrorException('Stored password is not in the expected encrypted format');
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
