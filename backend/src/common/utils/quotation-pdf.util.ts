import { getQuotationLogoDataUri } from './pdf-banner.util';

// Customer Order / Party Order PDF in the SSS "Quotation" layout: header,
// one block per product (name, size chips, four spec boxes, price bar) and
// a total. No product drawing/photo. Spec boxes only show what was filled
// in on the order line (see ItemSpecsDto); empty boxes are left out.

export interface ItemSpecs {
  overallSize?: string | null;
  headboardHeight?: string | null;
  frameHeight?: string | null;
  plywood?: string | null;
  innerSide?: string | null;
  outerSide?: string | null;
  work?: string | null;
  polish?: string | null;
  finishType?: string | null;
  foam?: string | null;
  headboard?: string | null;
  assemblyMethod?: string | null;
  fittings?: string | null;
}

export interface QuotationLine {
  productName: string;
  modelNo?: string | null;
  category?: string | null;
  size?: string | null;
  color?: string | null;
  pattern?: string | null;
  details?: string | null;
  qty: number;
  unitPrice: number;
  specs?: ItemSpecs | null;
}

export interface QuotationInput {
  title: string; // QUOTATION / ORDER DETAILS
  docNo: string; // Job No / Order ID
  date: Date;
  partyLabel: string; // Customer / Shop / Assigned to
  partyName: string;
  phone?: string | null;
  lines: QuotationLine[];
  showPrices: boolean;
  received?: number; // shown only when > 0
  note?: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function readSpecs(raw: unknown): ItemSpecs {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ItemSpecs) : {};
}

function specBoxes(line: QuotationLine): string {
  const s = readSpecs(line.specs);
  const groups: { title: string; rows: [string, string | null][] }[] = [
    { title: 'Material Details', rows: [['Plywood', clean(s.plywood)], ['Inner Side', clean(s.innerSide)], ['Outer Side', clean(s.outerSide)]] },
    { title: 'Process', rows: [['Work', clean(s.work)], ['Polish', clean(s.polish) ?? clean(line.color)], ['Finish Type', clean(s.finishType)]] },
    { title: 'Headboard Cushion', rows: [['Foam', clean(s.foam)], ['Headboard', clean(s.headboard)]] },
    { title: 'Assembly', rows: [['Method', clean(s.assemblyMethod)], ['Fittings', clean(s.fittings)]] },
  ];
  const filled = groups.map((g) => ({ ...g, rows: g.rows.filter(([, v]) => v) })).filter((g) => g.rows.length);
  if (!filled.length) return '';
  return `<div class="specs">${filled
    .map(
      (g, i) => `<div class="spec">
        <div class="spec-no">${String(i + 1).padStart(2, '0')}</div>
        <div class="spec-title">${esc(g.title.toUpperCase())}</div>
        ${g.rows.map(([k, v]) => `<div class="spec-k">${esc(k.toUpperCase())}</div><div class="spec-v">${esc(v!)}</div>`).join('')}
      </div>`,
    )
    .join('')}</div>`;
}

function formatModelChip(raw?: string | null): string | null {
  const v = clean(raw);
  if (!v) return null;
  return /^(model|serial|no|#)/i.test(v) ? v : `Model No: ${v}`;
}

function formatModelEyebrow(raw?: string | null): string | null {
  const v = clean(raw);
  if (!v) return null;
  const num = v.replace(/^(model\s*(no\.?)?|serial\s*(no\.?)?|#)\s*:?\s*/i, '').trim();
  return /serial/i.test(v) ? `SERIAL NO: ${num || v}` : `MODEL NO: ${num || v}`;
}

function chips(line: QuotationLine): string {
  const s = readSpecs(line.specs);
  const size = clean(s.overallSize) ?? clean(line.size);
  const model = formatModelChip(line.modelNo);
  const list = [
    model ? { text: model, isModel: true } : null,
    size ? { text: `Overall ${size}`, isModel: false } : null,
    clean(s.headboardHeight) ? { text: `Headboard height ${clean(s.headboardHeight)}`, isModel: false } : null,
    clean(s.frameHeight) ? { text: `Frame height ${clean(s.frameHeight)}`, isModel: false } : null,
    /dismant/i.test(s.assemblyMethod ?? '') ? { text: 'Fully dismantlable', isModel: false } : null,
    clean(line.pattern) ? { text: `Pattern ${clean(line.pattern)}`, isModel: false } : null,
  ].filter((c): c is { text: string; isModel: boolean } => Boolean(c));
  return list.length
    ? `<div class="chips">${list.map((c) => `<span class="chip${c.isModel ? ' chip-model' : ''}">${esc(c.text)}</span>`).join('')}</div>`
    : '';
}

export function buildQuotationHtml(q: QuotationInput): string {
  const total = q.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
  const blocks = q.lines
    .map((l, idx) => {
      const lineTotal = l.qty * l.unitPrice;
      const modelEyebrow = formatModelEyebrow(l.modelNo);
      const modelBadge = formatModelChip(l.modelNo);
      return `<section class="product">
        <div class="product-head">
          <div>
            <div class="eyebrow">${q.lines.length > 1 ? `PRODUCT ${idx + 1}` : 'PRODUCT'}${modelEyebrow ? ` · ${esc(modelEyebrow)}` : ''}${clean(l.category) ? ` · ${esc(l.category!.toUpperCase())}` : ''}</div>
            <h2>${esc(l.productName)}${modelBadge ? ` <span class="model-badge">${esc(modelBadge)}</span>` : ''}</h2>
          </div>
          ${idx === 0 ? `<div class="meta">Date: <b>${q.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b><br/>${q.lines.length === 1 ? `Quantity: <b>${l.qty} Nos</b>` : `Items: <b>${q.lines.length}</b>`}</div>` : `<div class="meta">Quantity: <b>${l.qty} Nos</b></div>`}
        </div>
        ${chips(l)}
        ${specBoxes(l)}
        ${clean(l.details) ? `<p class="details">${esc(l.details!)}</p>` : ''}
        ${
          q.showPrices
            ? `<div class="pricebar">
          <div class="pb-cell"><div class="pb-label">PRICE · SINGLE PIECE</div><div class="pb-value">${rupees(l.unitPrice)}</div></div>
          <div class="pb-cell pb-qty"><div class="pb-label">QUANTITY</div><div class="pb-value">× ${l.qty}</div></div>
          <div class="pb-cell pb-total"><div class="pb-label">${q.lines.length > 1 ? 'AMOUNT' : 'TOTAL AMOUNT'}</div><div class="pb-value big">${rupees(lineTotal)}</div></div>
        </div>`
            : `<div class="qtybar">Quantity: <b>${l.qty} Nos</b></div>`
        }
      </section>`;
    })
    .join('');

  const received = q.received ?? 0;
  const grand =
    q.showPrices && (q.lines.length > 1 || received > 0)
      ? `<div class="grand">
      ${q.lines.length > 1 ? `<div class="grand-row"><span>TOTAL AMOUNT (${q.lines.length} items)</span><b>${rupees(total)}</b></div>` : ''}
      ${received > 0 ? `<div class="grand-row small"><span>Amount received</span><span>${rupees(received)}</span></div><div class="grand-row small"><span>Balance</span><b>${rupees(total - received)}</b></div>` : ''}
    </div>`
      : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Noto Sans', Arial, Helvetica, sans-serif; color: #2b2321; background: #f9f8f3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { min-height: 297mm; display: flex; flex-direction: column; }
  .edge { height: 8px; background: #8e0d16; }
  .page { flex: 1; }
  .page { padding: 26px 46px 30px; }
  .brand { text-align: center; }
  .brand img { width: 88%; display: inline-block; }
  .doc-title { display: flex; align-items: center; gap: 18px; margin: 20px 0 22px; }
  .doc-title .line { flex: 1; height: 1px; background: #d9cfc0; }
  .doc-title .t { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; letter-spacing: 10px; color: #8e0d16; }
  .to { display: flex; justify-content: space-between; font-size: 11.5px; color: #6b5f58; margin-bottom: 14px; }
  .to b { color: #2b2321; }
  .product { break-inside: avoid; page-break-inside: avoid; margin-bottom: 22px; }
  .product-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .eyebrow { font-size: 10px; letter-spacing: 2px; font-weight: bold; color: #9a6a3a; }
  h2 { font-family: Georgia, 'Times New Roman', serif; font-weight: normal; font-size: 30px; margin: 4px 0 0; color: #1f1a19; }
  .meta { text-align: right; font-size: 11.5px; color: #6b5f58; line-height: 1.7; white-space: nowrap; }
  .meta b { color: #1f1a19; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }
  .chip { border: 1px solid #e3d9c6; background: #f3efe7; border-radius: 999px; padding: 5px 14px; font-size: 11px; color: #3b3230; }
  .chip.chip-model { background: #8e0d16; color: #ffffff; border-color: #8e0d16; font-weight: 700; letter-spacing: 0.3px; }
  .model-badge { display: inline-block; font-family: 'Noto Sans', Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; color: #8e0d16; background: #fbf3f3; border: 1px solid #ecc2c6; padding: 2px 10px; border-radius: 999px; vertical-align: middle; margin-left: 8px; }
  .specs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 14px; }
  .spec { background: #fff; border: 1px solid #e6dfd3; padding: 12px 14px; min-height: 120px; }
  .spec-no { color: #8e0d16; font-weight: bold; font-size: 15px; }
  .spec-title { font-size: 9.5px; letter-spacing: 1.6px; font-weight: bold; color: #1f1a19; margin: 1px 0 8px; }
  .spec-k { font-size: 8.5px; letter-spacing: 1.4px; color: #8a7d73; margin-top: 7px; }
  .spec-v { font-size: 12.5px; color: #1f1a19; font-weight: 600; }
  .details { font-size: 11.5px; color: #3b3230; background: #fff; border: 1px solid #e6dfd3; padding: 8px 12px; margin: 12px 0 0; white-space: pre-wrap; }
  .pricebar { display: flex; margin-top: 14px; color: #fff; }
  .pb-cell { background: #970d16; padding: 12px 18px; flex: 1.25; }
  .pb-qty { flex: 0.8; border-left: 1px solid #b23a40; }
  .pb-total { background: #6e0710; flex: 1.4; text-align: right; }
  .pb-label { font-size: 9.5px; letter-spacing: 2px; opacity: 0.9; }
  .pb-value { font-size: 22px; font-weight: bold; margin-top: 4px; }
  .pb-value.big { font-size: 28px; }
  .qtybar { margin-top: 14px; background: #970d16; color: #fff; padding: 10px 18px; font-size: 13px; }
  .grand { border-top: 2px solid #8e0d16; padding-top: 10px; break-inside: avoid; page-break-inside: avoid; }
  .grand-row { display: flex; justify-content: space-between; font-size: 15px; padding: 3px 0; color: #1f1a19; }
  .grand-row b { color: #6e0710; }
  .grand-row.small { font-size: 12px; color: #6b5f58; }
  .note { font-size: 11px; color: #6b5f58; margin-top: 12px; }
  .foot { text-align: center; border-top: 1px solid #d9cfc0; margin-top: 26px; padding-top: 14px; break-inside: avoid; page-break-inside: avoid; }
  .foot .motto { font-size: 12px; letter-spacing: 5px; font-weight: bold; color: #1f1a19; }
  .foot .addr { font-size: 11px; color: #3b3230; margin-top: 8px; }
  .foot .ph { font-size: 11.5px; color: #8e0d16; font-weight: bold; margin-top: 4px; }
</style></head>
<body>
<div class="sheet">
  <div class="edge"></div>
  <div class="page">
    <div class="brand"><img src="${getQuotationLogoDataUri()}" alt="SSS Furniture" /></div>
    <div class="doc-title"><div class="line"></div><div class="t">${esc(q.title.toUpperCase())}</div><div class="line"></div></div>
    <div class="to">
      <div>${esc(q.partyLabel)}: <b>${esc(q.partyName)}</b>${q.phone ? ` · ${esc(q.phone)}` : ''}</div>
      <div>No: <b>${esc(q.docNo)}</b></div>
    </div>
    ${blocks}
    ${grand}
    ${q.note ? `<p class="note">${esc(q.note)}</p>` : ''}
    <div class="foot">
      <div class="motto">QUALITY | TRUST | COMFORT</div>
      <div class="addr">100/179, Erumapalayam Pallikuduthar Kadu (Near Govt Ration Store), Saniyasi Gundu, Salem – 636015, Tamil Nadu</div>
      <div class="ph">Ph: 93420-83981 · www.sssfurniture.co.in</div>
    </div>
  </div>
  <div class="edge"></div>
</div>
</body></html>`;
}
