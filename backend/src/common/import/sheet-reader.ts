import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import ExcelJS from 'exceljs';

// Shared 'file -> table' reader behind every bulk upload in the app (worker
// Work List / Payments, orders, inventory, purchasing, payments, expenses).
// Reads a PDF, .xlsx or .csv sheet into rows of raw cell text keyed by
// column, using each caller's TableSpec (header names -> columns). It never
// touches the database - callers turn the rows into previews for review.

export interface UploadedSheet {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

// A table read out of the file: each row's raw cell text by column, plus
// the grand total printed at the bottom of the sheet (if any).
export interface RawTable<C extends string> {
  rows: { line: number; cells: Partial<Record<C, string>> }[];
  grandTotal: number | null;
}

export interface TableSpec<C extends string> {
  // Header text -> column, matched after upper-casing and stripping
  // everything but letters ('MODEL-NO', 'Model No.' and 'MODELNO' all match).
  aliases: Record<string, C>;
  // Columns a line must name to count as the header row.
  headerRequired: C[];
  dateColumn: C;
  // PDF only: the column that's filled on every data line and marks where
  // a row is. Defaults to the date column; sheets that write the date only
  // on a day's first row (like Work List & Payment -2) use a number column
  // such as PRICE instead.
  anchorColumn?: C;
  // What the sheet is, for error messages.
  label: string;
}

function headerKey<C extends string>(spec: TableSpec<C>, text: string): C | undefined {
  return spec.aliases[text.toUpperCase().replace(/[^A-Z]/g, '')];
}

// dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy (the sheets' format) or yyyy-mm-dd.
// Built as a string, never through Date/timezones, so 18-09-2025 can't
// turn into the 17th on a UTC server.
export function parseSheetDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    return validDate(year, +m[2], +m[1]);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null; // e.g. 31-02
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]|Rs\.?/gi, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// --- File -> table --------------------------------------------------------

export async function readTable<C extends string>(file: UploadedSheet, spec: TableSpec<C>): Promise<RawTable<C>> {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') return readPdf(file.buffer, spec);
  if (name.endsWith('.xlsx')) return readWorkbook(file.buffer, 'xlsx', spec);
  if (name.endsWith('.csv')) return readWorkbook(file.buffer, 'csv', spec);
  if (name.endsWith('.xls')) {
    throw new BadRequestException('Old .xls files are not supported - open it in Excel and "Save As" .xlsx, then upload again.');
  }
  throw new BadRequestException('Upload a PDF, Excel (.xlsx) or CSV file.');
}

// --- PDF ------------------------------------------------------------------

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
}

// pdf.js's legacy CommonJS build (v3) - the only build that loads with a
// plain require() in this CommonJS NestJS app. isEvalSupported:false closes
// CVE-2024-4367 (font-path code execution) in this version, and we only
// ever ask it for text, never render anything.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const PUNCTUATION = /^[-+*&]$/;

async function readPdf<C extends string>(buffer: Buffer, spec: TableSpec<C>): Promise<RawTable<C>> {
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch {
    throw new BadRequestException('Could not read this PDF - make sure it is a text PDF, not a scanned photo.');
  }

  // Column centres from the header row. Only page 1 of a sheet usually has
  // a header, so the same columns carry on to every later page - a page
  // that does have its own header resets them.
  let columns: { col: C; center: number }[] | null = null;
  const rows: RawTable<C>['rows'] = [];
  let grandTotal: number | null = null;
  let lineNo = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = content.items
      .filter((i: { str?: string }) => i.str && i.str.trim())
      .map((i: { str: string; transform: number[]; width: number }) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));

    const byY = groupByY(items);
    // The header may be one line or stacked over a few ("MODEL-" above
    // "NO", "EXTRA" above "+"), so each line is tried as the top of a ~22pt
    // header band. headerY is the band's bottom - everything below is data.
    let headerY = Infinity;
    for (const lineItems of byY) {
      const top = lineItems[0].y;
      const band = items.filter((i) => i.y <= top + 1 && i.y >= top - 22);
      const found = detectHeader(band, spec);
      if (found) {
        columns = found;
        headerY = Math.min(...band.map((i) => i.y));
        break;
      }
    }
    if (!columns) continue;
    const cols = columns;

    const colOf = (it: PdfTextItem): C => {
      const center = it.x + it.w / 2;
      let best = cols[0];
      for (const c of cols) if (Math.abs(c.center - center) < Math.abs(best.center - center)) best = c;
      return best.col;
    };

    // A row starts at each text line whose anchor cell holds a value - a
    // date by default, or a number for a number anchor column (PRICE).
    const anchorCol = spec.anchorColumn ?? spec.dateColumn;
    const isAnchor = (text: string) => (anchorCol === spec.dateColumn ? !!parseSheetDate(text) : parseAmount(text) != null);
    const anchors: number[] = [];
    for (const lineItems of byY) {
      const y = lineItems[0].y;
      if (y >= headerY) continue;
      if (isAnchor(joinCell(lineItems.filter((i) => colOf(i) === anchorCol)))) anchors.push(y);
    }
    anchors.sort((a, b) => b - a); // top of page first

    // Which row a text piece belongs to: the nearest row line at or below
    // it. Within 24pt it's simply part of that row. Further up, it only
    // counts when it's the top of a cell stacked over several lines
    // ("BOTTOM" / "COT +" / "DRAW") - i.e. a chain of pieces in the same
    // column, each within 24pt of the next, reaches down to the row. A
    // free-standing section title above a row ("+LAMP BOX") has a gap and
    // stays out.
    const rowFor = (it: PdfTextItem): number | undefined => {
      const a = anchors.find((y) => y <= it.y + 1);
      if (a === undefined) return undefined;
      if (it.y - a <= 24) return a;
      if (it.y - a > 90) return undefined;
      const col = colOf(it);
      const below = [...new Set(items.filter((o) => o !== it && o.y < it.y - 1 && o.y >= a - 1 && colOf(o) === col).map((o) => o.y))].sort((x, y) => y - x);
      let cur = it.y;
      for (const y of below) {
        if (cur - y > 24) return undefined;
        cur = y;
        if (cur - a <= 24) return a;
      }
      return undefined;
    };

    const cellsByAnchor = new Map<number, Map<C, PdfTextItem[]>>();
    for (const a of anchors) cellsByAnchor.set(a, new Map());

    for (const it of items) {
      if (it.y >= headerY - 1) continue;
      // Wrapped cells put their first line ~14pt above the row's own line
      // ('ROUTER' above 'CUSHION'), so a non-date line belongs to the
      // nearest row at or just below it.
      const anchor = rowFor(it);
      if (anchor === undefined) {
        // Not part of any row - catch the sheet's grand-total line (its
        // right-most number).
        if (/TOTAL/i.test(it.str)) {
          const totalLine = items.filter((o) => Math.abs(o.y - it.y) < 2 && o !== it).sort((a, b) => b.x - a.x);
          const amount = totalLine.length ? parseAmount(totalLine[0].str) : null;
          if (amount != null) grandTotal = amount;
        }
        continue;
      }
      const cells = cellsByAnchor.get(anchor)!;
      // A lone '-' / '+' / '*' at the end of a wrapped cell can sit nearer
      // the next column's centre ('FRAME & TOP - 2C -' put its last '-'
      // into SIZE). Punctuation goes with whichever word it touches instead.
      let col = colOf(it);
      if (PUNCTUATION.test(it.str.trim())) {
        const neighbour = items
          .filter((o) => o !== it && Math.abs(o.y - it.y) < 2 && !PUNCTUATION.test(o.str.trim()))
          .sort((a, b) => gap(a, it) - gap(b, it))[0];
        if (neighbour && gap(neighbour, it) < 6) col = colOf(neighbour);
      }
      if (!cells.has(col)) cells.set(col, []);
      cells.get(col)!.push(it);
    }

    for (const a of anchors) {
      lineNo++;
      const cells: Partial<Record<C, string>> = {};
      for (const [col, cellItems] of cellsByAnchor.get(a)!) cells[col] = joinCell(cellItems);
      rows.push({ line: lineNo, cells });
    }
  }

  if (!columns) {
    throw new BadRequestException(`No header row found in this PDF - expected columns like ${spec.label}.`);
  }
  return { rows, grandTotal };
}

// Horizontal distance between two text pieces (0 when they touch/overlap).
function gap(a: PdfTextItem, b: PdfTextItem): number {
  return Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
}

function groupByY(items: PdfTextItem[]): PdfTextItem[][] {
  const lines: PdfTextItem[][] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) < 2);
    if (line) line.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines;
}

// 'MODEL' '-' 'NO' arrive as separate pieces; glue pieces that touch, put a
// space between ones that don't, and stack wrapped lines top to bottom.
function joinCell(items: PdfTextItem[]): string {
  return groupByY(items)
    .map((line) => {
      let out = '';
      let prevEnd: number | null = null;
      for (const it of line) {
        if (prevEnd !== null && it.x - prevEnd > 1.5) out += ' ';
        out += it.str;
        prevEnd = it.x + it.w;
      }
      return out.trim();
    })
    // A word broken across lines ('RE-' / 'WORK') joins back without a space.
    .reduce((acc, line) => (!acc ? line : acc.endsWith('-') ? acc + line : `${acc} ${line}`), '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectHeader<C extends string>(band: PdfTextItem[], spec: TableSpec<C>): { col: C; center: number }[] | null {
  // 1. Per line, merge pieces of one heading into a word - touching
  // ('MODEL' '-' 'NO') or a space apart ('SSS' '-' 'V'). Separate column
  // headings are always much further apart than 6pt.
  const words: PdfTextItem[] = [];
  for (const line of groupByY(band)) {
    let prev: PdfTextItem | null = null;
    for (const it of line) {
      if (prev && it.x - (prev.x + prev.w) <= 6) {
        prev.str += it.str;
        prev.w = it.x + it.w - prev.x;
      } else {
        prev = { ...it };
        words.push(prev);
      }
    }
  }
  // 2. Words stacked in the same column (horizontal spans overlap) are one
  // heading, read top to bottom: "MODEL-" + "NO", "EXTRA" + "+".
  const stacks: { x0: number; x1: number; parts: string[] }[] = [];
  for (const w of words) {
    const s = stacks.find((c) => w.x < c.x1 && w.x + w.w > c.x0);
    if (s) {
      s.parts.push(w.str);
      s.x0 = Math.min(s.x0, w.x);
      s.x1 = Math.max(s.x1, w.x + w.w);
    } else {
      stacks.push({ x0: w.x, x1: w.x + w.w, parts: [w.str] });
    }
  }
  // 3. Map each heading to a column (whole stack first, else any one word).
  const cols: { col: C; center: number }[] = [];
  for (const s of stacks) {
    const col = headerKey(spec, s.parts.join('')) ?? s.parts.map((p) => headerKey(spec, p)).find(Boolean);
    if (col && !cols.some((c) => c.col === col)) cols.push({ col, center: (s.x0 + s.x1) / 2 });
  }
  return spec.headerRequired.every((c) => cols.some((x) => x.col === c)) ? cols : null;
}

// --- Excel / CSV ----------------------------------------------------------

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) {
    // Excel dates come back as JS Dates at UTC midnight.
    return `${String(value.getUTCDate()).padStart(2, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${value.getUTCFullYear()}`;
  }
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText(value.result as ExcelJS.CellValue); // formula
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text); // hyperlink
    return '';
  }
  return String(value);
}

async function readWorkbook<C extends string>(buffer: Buffer, kind: 'xlsx' | 'csv', spec: TableSpec<C>): Promise<RawTable<C>> {
  const workbook = new ExcelJS.Workbook();
  try {
    if (kind === 'xlsx') {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } else {
      // map: keep every CSV value as the raw text. exceljs otherwise
      // converts date-looking text itself, US-style - "08-10-2025" became
      // 10 Aug instead of 8 Oct - before parseSheetDate ever sees it.
      await workbook.csv.read(Readable.from(buffer), { map: (value: string) => value, parserOptions: { trim: true } });
    }
  } catch {
    throw new BadRequestException(kind === 'xlsx' ? 'Could not read this Excel file - save it as .xlsx and try again.' : 'Could not read this CSV file.');
  }

  const sheet = workbook.worksheets.find((ws) => ws.rowCount > 0);
  if (!sheet) throw new BadRequestException('The file has no rows.');

  // The header is the first row (within the first 20) naming every
  // required column.
  let headerRow = 0;
  let colMap = new Map<number, C>();
  for (let r = 1; r <= Math.min(20, sheet.rowCount) && !headerRow; r++) {
    const map = new Map<number, C>();
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const col = headerKey(spec, cellText(cell.value));
      if (col && ![...map.values()].includes(col)) map.set(c, col);
    });
    if (spec.headerRequired.every((c) => [...map.values()].includes(c))) {
      headerRow = r;
      colMap = map;
    }
  }
  if (!headerRow) {
    throw new BadRequestException(`No header row found - the first rows should name the columns, like ${spec.label}.`);
  }

  const rows: RawTable<C>['rows'] = [];
  let grandTotal: number | null = null;
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: Partial<Record<C, string>> = {};
    for (const [c, col] of colMap) cells[col] = cellText(row.getCell(c).value);
    if (!Object.values<string | undefined>(cells).some((t) => t && t.trim())) continue;
    if (!parseSheetDate(cells[spec.dateColumn] ?? '')) {
      // A row with no date but 'TOTAL' somewhere is the grand-total line -
      // take its right-most number.
      // row.values is sparse (index 0 and empty cells are holes) - Array.from
      // fills the holes so every entry is a real string.
      const values = Array.from(row.values as ExcelJS.CellValue[], (v) => cellText(v));
      if (values.some((v) => /TOTAL/i.test(v))) {
        const amount = [...values].reverse().map(parseAmount).find((n) => n != null);
        if (amount != null) grandTotal = amount;
        continue;
      }
    }
    rows.push({ line: r, cells });
  }
  return { rows, grandTotal };
}
