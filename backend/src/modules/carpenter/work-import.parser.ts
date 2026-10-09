import { clean, parseAmount, parseSheetDate, TableSpec } from '../../common/import/sheet-reader';
import { extractModelNumber } from '../../common/utils/model-no.util';

// Worker sheets - the "Work List & Payment" sheet and a payments sheet - for
// the worker page's import preview. The file reading itself is the shared
// sheet-reader; this file only knows the columns and row rules. Parsing is
// best-effort by design: every row carries its own warnings so a misread
// value is visible in the preview, never silently saved.

// --- Work List sheet ------------------------------------------------------

export type WorkColumn = 'date' | 'modelNo' | 'productName' | 'category' | 'size' | 'price' | 'extra' | 'quantity' | 'total';

export const WORK_SPEC: TableSpec<WorkColumn> = {
  aliases: {
    DATE: 'date',
    WORKDATE: 'date',
    MODELNO: 'modelNo',
    MODEL: 'modelNo',
    MODELNUMBER: 'modelNo',
    PRODUCTNAME: 'productName',
    PRODUTCNAME: 'productName', // the sheet's own spelling
    NAME: 'productName',
    DESIGN: 'productName',
    PRODUCT: 'category',
    CATEGORY: 'category',
    TYPE: 'category',
    SIZE: 'size',
    PRICE: 'price',
    RATE: 'price',
    EXTRA: 'extra',
    NO: 'quantity',
    QTY: 'quantity',
    QUANTITY: 'quantity',
    NOS: 'quantity',
    TOTAL: 'total',
    AMOUNT: 'total',
  },
  headerRequired: ['date', 'productName', 'price'],
  dateColumn: 'date',
  // Every work line has a price; some sheets only date a day's first row.
  anchorColumn: 'price',
  label: 'DATE, MODEL-NO, PRODUCT NAME, PRODUCT, SIZE, PRICE, EXTRA, NO, TOTAL',
};

export interface ParsedWorkRow {
  line: number; // 1-based row number in the sheet (for "row 12: ..." messages)
  workDate: string | null; // YYYY-MM-DD
  modelNo: string;
  productName: string;
  category: string;
  size: string;
  quantity: number;
  price: number;
  extra: number;
  sheetTotal: number | null; // the TOTAL column as written on the sheet
  warnings: string[];
}

// Exact text so fillDownDates can recognise and replace it.
export const DATE_MISSING = 'Date is missing';

// Sheets often write the date once, on a day's first row only. A row with
// no date at all takes the date of the row above, and says so.
export function fillDownDates<T extends { workDate: string | null; warnings: string[] }>(rows: T[]): T[] {
  let last: string | null = null;
  for (const r of rows) {
    if (r.workDate) last = r.workDate;
    else if (last && r.warnings.includes(DATE_MISSING)) {
      r.workDate = last;
      const [y, m, d] = last.split('-');
      r.warnings = r.warnings.map((w) => (w === DATE_MISSING ? `No date on this row - used the date above (${d}-${m}-${y})` : w));
    }
  }
  return rows;
}

export function buildWorkRow(line: number, cells: Partial<Record<WorkColumn, string>>): ParsedWorkRow {
  const warnings: string[] = [];
  const text = (c: WorkColumn) => clean(cells[c]);

  const workDate = parseSheetDate(text('date'));
  if (!workDate) warnings.push(text('date') ? `Date "${text('date')}" not recognised` : DATE_MISSING);

  let modelNo = text('modelNo');
  let productName = text('productName');
  // Some custom-job rows have a description ("WOODEN SOFA") written in the
  // Model-No column instead of a number. Model Nos always contain a digit,
  // so anything without one is moved into the product name rather than
  // being saved as a Model No.
  if (modelNo && !/\d/.test(modelNo)) {
    productName = productName ? `${modelNo} ${productName}` : modelNo;
    warnings.push(`"${modelNo}" was in the Model No column - moved into Product Name`);
    modelNo = '';
  }
  // A Model No is only a number: "A-12" / "No. 12" become 12. A Job No
  // (JOB-2026-00008) is not a Model No and is left alone.
  const modelNumber = extractModelNumber(modelNo);
  if (modelNumber) modelNo = modelNumber;
  if (!productName) warnings.push('Product Name is empty');

  const price = parseAmount(text('price'));
  const extra = parseAmount(text('extra')) ?? 0;
  const sheetTotal = parseAmount(text('total'));
  let quantity = parseAmount(text('quantity'));
  if (price == null) warnings.push('Price is missing');

  // A blank NO cell (the sheet's very first row) still means 1 piece - work
  // it back out from the written total when possible.
  if (quantity == null || quantity <= 0) {
    const unit = (price ?? 0) + extra;
    quantity = sheetTotal && unit > 0 && Number.isInteger(sheetTotal / unit) ? sheetTotal / unit : 1;
  }
  if (!Number.isInteger(quantity)) {
    warnings.push(`Qty "${text('quantity')}" is not a whole number - rounded`);
    quantity = Math.max(1, Math.round(quantity));
  }

  const computed = ((price ?? 0) + extra) * quantity;
  if (sheetTotal != null && price != null && Math.abs(computed - sheetTotal) > 0.5) {
    warnings.push(`Sheet total ₹${sheetTotal} doesn't match (Price + Extra) × Qty = ₹${computed}`);
  }

  return { line, workDate, modelNo, productName, category: text('category'), size: text('size'), quantity, price: price ?? 0, extra, sheetTotal, warnings };
}

// --- Payments sheet -------------------------------------------------------

export type PaymentColumn = 'date' | 'type' | 'reference' | 'amount' | 'mode' | 'note';

export const WORKER_PAYMENT_SPEC: TableSpec<PaymentColumn> = {
  aliases: {
    DATE: 'date',
    PAYMENTDATE: 'date',
    TYPE: 'type',
    PAYMENTTYPE: 'type',
    REPORT: 'type', // the salary voucher sheet's SALARY / ADVANCE column
    VOUCHERNO: 'reference',
    SSSV: 'reference', // "SSS - V" voucher number on the salary sheet
    VOUCHER: 'reference',
    VOUCHERNUMBER: 'reference',
    VNO: 'reference',
    REFERENCE: 'reference',
    REF: 'reference',
    REFNO: 'reference',
    AMOUNT: 'amount',
    TOTAL: 'amount',
    PAID: 'amount',
    PAYMENT: 'amount',
    MODE: 'mode',
    PAYMENTMODE: 'mode',
    NOTE: 'note',
    NOTES: 'note',
    REMARK: 'note',
    REMARKS: 'note',
    PARTICULARS: 'note',
    DESCRIPTION: 'note',
  },
  headerRequired: ['date', 'amount'],
  dateColumn: 'date',
  label: 'DATE, TYPE, VOUCHER NO, AMOUNT, MODE, NOTE',
};

export type ParsedPaymentType = 'SALARY' | 'ADVANCE' | 'BONUS' | 'EXTRA_WORK' | 'DEDUCTION' | 'OTHER';

// Free-text type ("Adv", "salary", "Cut") -> the app's payment types.
export function paymentTypeOf(raw: string): ParsedPaymentType | null {
  const t = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (!t) return 'SALARY';
  if (t.startsWith('SAL') || t === 'WAGES' || t === 'WAGE') return 'SALARY';
  if (t.startsWith('ADV')) return 'ADVANCE';
  if (t.startsWith('BONUS')) return 'BONUS';
  if (t.startsWith('EXTRA')) return 'EXTRA_WORK';
  if (t.startsWith('DEDUCT') || t === 'CUT' || t === 'FINE') return 'DEDUCTION';
  if (t === 'OTHER' || t === 'OTHERS') return 'OTHER';
  return null;
}
