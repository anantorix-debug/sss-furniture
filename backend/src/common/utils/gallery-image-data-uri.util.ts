import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Embeds an uploaded Gallery image (served from /uploads, see main.ts's
// useStaticAssets) as a base64 data URI for a PDF - same reasoning as
// getPdfBannerDataUri: Puppeteer's page.setContent() has no base URL to
// resolve a relative <img src> against, and no guarantee the app server is
// reachable from wherever Puppeteer/Chromium happens to be running. Reads
// straight off disk instead of round-tripping through HTTP. Returns null
// (never throws) if the file is missing/unreadable, so one bad image never
// fails the whole PDF - the caller just omits the <img> for that item.
export function galleryImageDataUri(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const cleanUrl = url.split('?')[0];
    const ext = extname(cleanUrl).toLowerCase();
    const mime = EXT_MIME[ext] || 'image/jpeg';

    if (url.startsWith('data:image/')) return url;

    const rel = cleanUrl.replace(/^\/+/, '');
    const candidates = [
      join(process.cwd(), rel),
      join(process.cwd(), 'backend', rel),
      join(process.cwd(), '..', rel),
      join(__dirname, '..', '..', '..', '..', rel),
      join(__dirname, '..', '..', '..', rel),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        const bytes = readFileSync(c);
        return `data:${mime};base64,${bytes.toString('base64')}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
