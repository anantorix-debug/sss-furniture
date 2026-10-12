import { ApiError, getAccessToken } from './api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// Worker ID & bank details (Aadhaar, PAN, bank account) - Admin and above
// only, read/written through /carpenters/:id/kyc and /documents.

export type WorkerDocumentKind = 'AADHAAR' | 'PAN' | 'BANK';

export interface WorkerDocument {
  id: string;
  kind: WorkerDocumentKind;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface WorkerKycDetails {
  aadhaarNumber: string | null;
  panNumber: string | null;
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  bankBranch: string | null;
}

export interface WorkerKyc extends WorkerKycDetails {
  carpenterId: string;
  updatedAt: string | null;
  documents: WorkerDocument[];
}

export type KycForm = Record<keyof WorkerKycDetails, string>;

export const emptyKycForm: KycForm = {
  aadhaarNumber: '',
  panNumber: '',
  bankAccountHolder: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankName: '',
  bankBranch: '',
};

export const DOC_KIND_LABEL: Record<WorkerDocumentKind, string> = {
  AADHAAR: 'Aadhaar Card',
  PAN: 'PAN Card',
  BANK: 'Bank Proof (passbook / cheque)',
};

export const WORKER_DOC_MAX_BYTES = 5 * 1024 * 1024;
export const WORKER_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

export function kycFormFrom(k: WorkerKycDetails | null | undefined): KycForm {
  if (!k) return { ...emptyKycForm };
  return {
    aadhaarNumber: k.aadhaarNumber ? k.aadhaarNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : '',
    panNumber: k.panNumber ?? '',
    bankAccountHolder: k.bankAccountHolder ?? '',
    bankAccountNumber: k.bankAccountNumber ?? '',
    bankIfsc: k.bankIfsc ?? '',
    bankName: k.bankName ?? '',
    bankBranch: k.bankBranch ?? '',
  };
}

// Same rules the server checks, so mistakes show before saving.
export function validateKycForm(f: KycForm): string | null {
  const aadhaar = f.aadhaarNumber.replace(/[\s-]/g, '');
  if (aadhaar && !/^[2-9]\d{11}$/.test(aadhaar)) return 'Aadhaar number must be 12 digits (it never starts with 0 or 1)';
  const pan = f.panNumber.replace(/\s/g, '').toUpperCase();
  if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return 'PAN must look like ABCDE1234F (5 letters, 4 digits, 1 letter)';
  const account = f.bankAccountNumber.replace(/[\s-]/g, '');
  if (account && !/^\d{9,18}$/.test(account)) return 'Bank account number must be 9 to 18 digits';
  const ifsc = f.bankIfsc.replace(/\s/g, '').toUpperCase();
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return 'IFSC must look like SBIN0001234 (4 letters, 0, then 6 letters/digits)';
  return null;
}

export function kycFormHasData(f: KycForm): boolean {
  return Object.values(f).some((v) => v.trim() !== '');
}

// Blank boxes are sent as null, so clearing a field really clears it.
export function kycPayload(f: KycForm) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
}

export function validateWorkerDocFile(file: File): string | null {
  if (file.size > WORKER_DOC_MAX_BYTES) return `"${file.name}" is larger than 5 MB`;
  if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) return `"${file.name}" is not a PDF, JPG, PNG or WEBP file`;
  return null;
}

export async function uploadWorkerDocument(carpenterId: string, kind: WorkerDocumentKind, file: File): Promise<WorkerDocument> {
  const formData = new FormData();
  formData.append('kind', kind);
  formData.append('file', file);
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/carpenters/${carpenterId}/documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = res.status === 413 ? 'File must be 5 MB or less' : Array.isArray(data?.message) ? data.message.join(', ') : data?.message || 'Failed to upload the file';
    throw new ApiError(res.status, message, data);
  }
  return (data?.data ?? data) as WorkerDocument;
}

// Opens the file in a new tab (it's fetched with the login token, so the
// link only works for a signed-in Admin).
export async function openWorkerDocument(carpenterId: string, doc: WorkerDocument) {
  const tab = window.open('', '_blank');
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/carpenters/${carpenterId}/documents/${doc.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) {
    tab?.close();
    throw new ApiError(res.status, 'Could not open the document', null);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function maskAadhaar(v: string | null) {
  return v ? `XXXX XXXX ${v.slice(-4)}` : null;
}
export function maskAccount(v: string | null) {
  return v ? `${'X'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : null;
}
export function maskPan(v: string | null) {
  return v ? `${v.slice(0, 2)}XXXXX${v.slice(-3)}` : null;
}
export function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
