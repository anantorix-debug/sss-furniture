import { getAccessToken } from './api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// Genuinely separate from both "Download PDF" and "Send PDF via WhatsApp" -
// this doesn't depend on the backend's own WhatsApp connection being up at
// all. It hands the file to the device's native share sheet (WhatsApp,
// email, anything installed), which is what "I'm not able to share"
// actually needs when the automated send is failing/unavailable. Falls
// back to a normal download on browsers with no file-sharing support
// (most desktop browsers today).
export async function sharePdf(path: string, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  const blob = await res.blob();
  const file = new File([blob], filename, { type: 'application/pdf' });

  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean; share?: (data: ShareData) => Promise<void> };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      // AbortError means the user closed the native share sheet - not a
      // failure worth falling back from.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // Any other failure (e.g. no matching app) falls through to download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
