import { randomInt } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/l/I) since this is read
// off a phone screen and typed back in by hand.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

// Cryptographically secure (crypto.randomInt, not Math.random) - this
// becomes a real, working login password the moment it's generated.
export function generateSecurePassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  return out;
}
