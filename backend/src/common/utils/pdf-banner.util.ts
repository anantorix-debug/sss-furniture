import { readFileSync } from 'fs';
import { join } from 'path';

// The branded letterhead (logo, tagline, contact/address/proprietor) - the
// same image already sent alongside every WhatsApp order-confirmation
// message - embedded as a data URI so Puppeteer (running server-side, no
// web server to fetch a relative /public path from) can render it without
// a network round-trip. Read once and cached; the file lives in src/ (not
// dist/) since nest-cli isn't configured to copy assets, but process.cwd()
// at runtime is the backend project root either way (dev or PM2-run
// dist/src/main), so this path resolves the same in both.
let cachedBannerDataUri: string | null = null;

export function getPdfBannerDataUri(): string {
  if (!cachedBannerDataUri) {
    const bytes = readFileSync(join(process.cwd(), 'src/assets/wa-template.jpeg'));
    cachedBannerDataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  }
  return cachedBannerDataUri;
}
