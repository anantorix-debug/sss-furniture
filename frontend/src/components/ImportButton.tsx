'use client';

import { useState } from 'react';
import useSWR, { mutate as revalidate } from 'swr';
import { fetcher } from '@/lib/swr';
import { boardFeetPreview } from '@/lib/boardFeet';
import { useAuth } from '@/context/AuthContext';
import { BulkImportModal, type BulkColumn, type GridRow } from './BulkImportModal';

// "Upload / Add Multiple" for every page - one button per page, each opening
// the shared BulkImportModal with that page's columns. Column labels double
// as the downloadable template's headings, chosen to match what the upload
// recognises, so a filled-in template uploads cleanly.

export type ImportKind =
  | 'customer-orders'
  | 'party-orders'
  | 'products'
  | 'raw-materials'
  | 'suppliers'
  | 'purchases'
  | 'supplier-purchases'
  | 'supplier-payments'
  | 'production-work'
  | 'worker-work'
  | 'worker-payments'
  | 'payments'
  | 'expenses';

type Named = { id: string; name: string; isActive?: boolean };
type Material = Named & { measurementKind?: string };

const today = () => new Date().toISOString().slice(0, 10);
const n = (v: string | undefined) => parseFloat(v ?? '') || 0;
const opts = (list: Named[] | undefined) => (list ?? []).filter((x) => x.isActive !== false).map((x) => ({ value: x.id, label: x.name }));

const STAGES = [
  { value: 'CARPENTER', label: 'Carpenter' },
  { value: 'CARVING', label: 'Carving' },
  { value: 'POLISH', label: 'Polish' },
];
const WORKER_PAYMENT_TYPES = [
  { value: 'SALARY', label: 'Salary' },
  { value: 'ADVANCE', label: 'Advance' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'EXTRA_WORK', label: 'Extra Work' },
  { value: 'DEDUCTION', label: 'Deduction' },
  { value: 'OTHER', label: 'Other' },
];
const workTotal = (r: GridRow) => (n(r.price) + n(r.extra)) * (n(r.quantity) || 1);

// Old (already finished) work entries - same columns on the worker page and
// in Production Control (which adds a Worker column in front).
const WORK_COLUMNS: BulkColumn[] = [
  { key: 'stage', label: 'Stage', type: 'select', options: STAGES },
  { key: 'workDate', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
  { key: 'modelNo', label: 'Model No', type: 'text', width: 'min-w-[90px]' },
  { key: 'productName', label: 'Product Name', type: 'text', required: true, width: 'min-w-[170px]' },
  { key: 'category', label: 'Category', type: 'text', width: 'min-w-[150px]' },
  { key: 'size', label: 'Size', type: 'text', width: 'min-w-[90px]' },
  { key: 'quantity', label: 'Qty', type: 'number', required: true, width: 'min-w-[70px]' },
  { key: 'price', label: 'Price', type: 'number', required: true, width: 'min-w-[100px]' },
  { key: 'extra', label: 'Extra', type: 'number', width: 'min-w-[90px]' },
];
const emptyWork = (): GridRow => ({ stage: 'CARPENTER', workDate: today(), modelNo: '', productName: '', category: '', size: '', quantity: '1', price: '', extra: '0' });

interface Config {
  title: string;
  hint?: string;
  columns: BulkColumn[];
  emptyRow: () => GridRow;
  rowTotal?: (r: GridRow) => number;
  switches?: { key: string; label: string }[];
  templateFileName: string;
  needs: ('shops' | 'suppliers' | 'materials' | 'workers' | 'categories' | 'modes')[];
}

function configFor(kind: ImportKind, lists: Record<string, Named[] | undefined>, isSuperAdmin: boolean): Config {
  switch (kind) {
    case 'customer-orders':
      return {
        title: 'Upload / Add Multiple Customer Orders',
        hint: 'One row per product - rows with the same Order ID become one order.',
        templateFileName: 'customer-orders-template',
        needs: [],
        columns: [
          { key: 'orderId', label: 'Order ID', type: 'text', required: true, width: 'min-w-[110px]' },
          { key: 'orderDate', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'customerName', label: 'Customer Name', type: 'text', required: true, width: 'min-w-[150px]' },
          { key: 'phone', label: 'Phone', type: 'text', width: 'min-w-[120px]' },
          { key: 'address', label: 'Address', type: 'text', width: 'min-w-[160px]' },
          { key: 'productName', label: 'Product Name', type: 'text', required: true, width: 'min-w-[160px]' },
          { key: 'category', label: 'Category', type: 'text', width: 'min-w-[130px]' },
          { key: 'size', label: 'Size', type: 'text', width: 'min-w-[90px]' },
          { key: 'color', label: 'Colour', type: 'text', width: 'min-w-[110px]' },
          { key: 'quantity', label: 'Qty', type: 'number', required: true, width: 'min-w-[70px]' },
          { key: 'unitPrice', label: 'Unit Price', type: 'number', required: true, width: 'min-w-[100px]' },
        ],
        emptyRow: () => ({ orderId: 'SSS-', orderDate: today(), customerName: '', phone: '', address: '', productName: '', category: '', size: '', color: '', quantity: '1', unitPrice: '' }),
        rowTotal: (r) => (n(r.quantity) || 1) * n(r.unitPrice),
      };
    case 'party-orders':
      return {
        title: 'Upload / Add Multiple Party Orders',
        hint: 'One row per product - rows with the same Order Ref become one order (with no ref, one order per shop per day). Shops must already exist.',
        templateFileName: 'party-orders-template',
        needs: ['shops'],
        columns: [
          { key: 'orderRef', label: 'Order Ref', type: 'text', required: true, width: 'min-w-[110px]' },
          { key: 'orderDate', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'shopId', label: 'Shop', type: 'select', required: true, options: opts(lists.shops), width: 'min-w-[160px]' },
          { key: 'phone', label: 'Phone', type: 'text', width: 'min-w-[120px]' },
          { key: 'productName', label: 'Product Name', type: 'text', required: true, width: 'min-w-[160px]' },
          { key: 'size', label: 'Size', type: 'text', width: 'min-w-[90px]' },
          { key: 'pattern', label: 'Pattern', type: 'text', width: 'min-w-[110px]' },
          { key: 'details', label: 'Details', type: 'text', width: 'min-w-[130px]' },
          { key: 'color', label: 'Colour', type: 'text', width: 'min-w-[110px]' },
          { key: 'qty', label: 'Qty', type: 'number', required: true, width: 'min-w-[70px]' },
          { key: 'unitPrice', label: 'Unit Price', type: 'number', required: true, width: 'min-w-[100px]' },
        ],
        emptyRow: () => ({ orderRef: '1', orderDate: today(), shopId: '', phone: '', productName: '', size: '', pattern: '', details: '', color: '', qty: '1', unitPrice: '' }),
        rowTotal: (r) => (n(r.qty) || 1) * n(r.unitPrice),
      };
    case 'products':
      return {
        title: 'Upload / Add Multiple Stock Products',
        hint: 'One row = one physical piece (quantity 1), like Add Product.',
        templateFileName: 'products-template',
        needs: [],
        columns: [
          { key: 'name', label: 'Name', type: 'text', required: true, width: 'min-w-[160px]' },
          { key: 'modelNo', label: 'Model No', type: 'text', width: 'min-w-[100px]' },
          { key: 'sku', label: 'SKU', type: 'text', width: 'min-w-[100px]' },
          { key: 'category', label: 'Category', type: 'text', width: 'min-w-[130px]' },
          { key: 'modelSize', label: 'Size', type: 'text', width: 'min-w-[90px]' },
          { key: 'materialFinish', label: 'Finish', type: 'text', width: 'min-w-[120px]' },
          { key: 'pattern', label: 'Pattern', type: 'text', width: 'min-w-[110px]' },
          { key: 'details', label: 'Details', type: 'text', width: 'min-w-[130px]' },
          { key: 'unit', label: 'Unit', type: 'text', width: 'min-w-[80px]' },
          { key: 'retailPrice', label: 'Price', type: 'number', required: true, width: 'min-w-[100px]' },
          { key: 'wholesalePrice', label: 'Wholesale', type: 'number', width: 'min-w-[100px]' },
          { key: 'costPrice', label: 'Cost', type: 'number', width: 'min-w-[100px]' },
        ],
        emptyRow: () => ({ name: '', modelNo: '', sku: '', category: '', modelSize: '', materialFinish: '', pattern: '', details: '', unit: '', retailPrice: '', wholesalePrice: '', costPrice: '' }),
        rowTotal: (r) => n(r.retailPrice),
      };
    case 'raw-materials':
      return {
        title: 'Upload / Add Multiple Raw Materials',
        hint: 'The material list only - add opening stock with Stock In.',
        templateFileName: 'raw-materials-template',
        needs: [],
        columns: [
          { key: 'name', label: 'Name', type: 'text', required: true, width: 'min-w-[170px]' },
          {
            key: 'materialGroup',
            label: 'Group',
            type: 'select',
            options: [
              { value: 'WOOD', label: 'Wood' },
              { value: 'CARVING', label: 'Carving' },
              { value: 'POLISH', label: 'Polish' },
              { value: 'OTHER', label: 'Other' },
            ],
          },
          {
            key: 'measurementKind',
            label: 'Measurement',
            type: 'select',
            options: [
              { value: 'BOARD_FEET', label: 'Board Feet' },
              { value: 'SHEET', label: 'Sheet' },
              { value: 'LIQUID', label: 'Liquid' },
              { value: 'COUNT', label: 'Count' },
              { value: 'OTHER', label: 'Other' },
            ],
            width: 'min-w-[130px]',
          },
          { key: 'unit', label: 'Unit', type: 'text', width: 'min-w-[90px]' },
          { key: 'reorderLevel', label: 'Reorder Level', type: 'number', width: 'min-w-[110px]' },
        ],
        emptyRow: () => ({ name: '', materialGroup: 'WOOD', measurementKind: 'BOARD_FEET', unit: 'CFT', reorderLevel: '' }),
      };
    case 'suppliers':
      return {
        title: 'Upload / Add Multiple Suppliers',
        templateFileName: 'suppliers-template',
        needs: [],
        columns: [
          { key: 'name', label: 'Name', type: 'text', required: true, width: 'min-w-[180px]' },
          { key: 'phone', label: 'Phone', type: 'text', width: 'min-w-[130px]' },
          { key: 'address', label: 'Address', type: 'text', width: 'min-w-[220px]' },
        ],
        emptyRow: () => ({ name: '', phone: '', address: '' }),
      };
    case 'purchases': {
      const materials = (lists.materials ?? []) as Material[];
      const isBoardFeet = (id: string) => materials.find((m) => m.id === id)?.measurementKind === 'BOARD_FEET';
      // Board-feet timber: quantity comes from the sizes, same formula the
      // server applies when the purchase is saved.
      const qty = (r: GridRow) => (isBoardFeet(r.rawMaterialId) ? (boardFeetPreview(r.thicknessIn, r.widthIn, r.lengthFt, r.pieces)?.total ?? 0) : n(r.quantity));
      return {
        title: 'Upload / Add Multiple Purchases',
        hint: 'One row per material - rows with the same Purchase Ref become one purchase. Timber (board feet) takes its quantity from Thickness × Width × Length × Pieces.',
        templateFileName: 'purchases-template',
        needs: ['suppliers', 'materials'],
        columns: [
          { key: 'purchaseRef', label: 'Purchase Ref', type: 'text', required: true, width: 'min-w-[110px]' },
          { key: 'purchaseDate', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'supplierId', label: 'Supplier', type: 'select', required: true, options: opts(lists.suppliers), width: 'min-w-[160px]' },
          { key: 'rawMaterialId', label: 'Material', type: 'select', required: true, options: opts(lists.materials), width: 'min-w-[160px]' },
          { key: 'quantity', label: 'Qty', type: 'number', width: 'min-w-[80px]' },
          { key: 'unitPrice', label: 'Rate', type: 'number', required: true, width: 'min-w-[90px]' },
          { key: 'thicknessIn', label: 'Thickness', type: 'number', width: 'min-w-[90px]' },
          { key: 'widthIn', label: 'Width', type: 'number', width: 'min-w-[80px]' },
          { key: 'lengthFt', label: 'Length', type: 'number', width: 'min-w-[80px]' },
          { key: 'pieces', label: 'Pieces', type: 'number', width: 'min-w-[80px]' },
          { key: 'notes', label: 'Notes', type: 'text', width: 'min-w-[140px]' },
        ],
        emptyRow: () => ({ purchaseRef: '1', purchaseDate: today(), supplierId: '', rawMaterialId: '', quantity: '', unitPrice: '', thicknessIn: '', widthIn: '', lengthFt: '', pieces: '', notes: '' }),
        rowTotal: (r) => qty(r) * n(r.unitPrice),
        switches: isSuperAdmin ? [{ key: 'directRecord', label: 'Already received - record directly and add to stock (otherwise saved as pending approval)' }] : undefined,
      };
    }
    case 'supplier-purchases': {
      const materials = (lists.materials ?? []) as Material[];
      const isBoardFeet = (id: string) => materials.find((m) => m.id === id)?.measurementKind === 'BOARD_FEET';
      const qty = (r: GridRow) => (isBoardFeet(r.rawMaterialId) ? (boardFeetPreview(r.thicknessIn, r.widthIn, r.lengthFt, r.pieces)?.total ?? 0) : n(r.quantity));
      return {
        title: 'Add Multiple Purchases / Upload PDF·Excel',
        hint: 'One row per material - rows with the same Purchase Ref become one purchase. Timber (board feet) takes its quantity from Thickness × Width × Length × Pieces.',
        templateFileName: 'supplier-purchases-template',
        needs: ['materials'],
        columns: [
          { key: 'purchaseRef', label: 'Purchase Ref', type: 'text', required: true, width: 'min-w-[110px]' },
          { key: 'purchaseDate', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'rawMaterialId', label: 'Material', type: 'select', required: true, options: opts(lists.materials), width: 'min-w-[160px]' },
          { key: 'quantity', label: 'Qty', type: 'number', width: 'min-w-[80px]' },
          { key: 'unitPrice', label: 'Rate', type: 'number', required: true, width: 'min-w-[90px]' },
          { key: 'thicknessIn', label: 'Thickness', type: 'number', width: 'min-w-[90px]' },
          { key: 'widthIn', label: 'Width', type: 'number', width: 'min-w-[80px]' },
          { key: 'lengthFt', label: 'Length', type: 'number', width: 'min-w-[80px]' },
          { key: 'pieces', label: 'Pieces', type: 'number', width: 'min-w-[80px]' },
          { key: 'notes', label: 'Notes', type: 'text', width: 'min-w-[140px]' },
        ],
        emptyRow: () => ({ purchaseRef: '1', purchaseDate: today(), rawMaterialId: '', quantity: '', unitPrice: '', thicknessIn: '', widthIn: '', lengthFt: '', pieces: '', notes: '' }),
        rowTotal: (r) => qty(r) * n(r.unitPrice),
        switches: isSuperAdmin ? [{ key: 'directRecord', label: 'Already received - record directly and add to stock (otherwise saved as pending approval)' }] : undefined,
      };
    }
    case 'supplier-payments':
      return {
        title: 'Add Multiple Payments / Upload PDF·Excel',
        templateFileName: 'supplier-payments-template',
        needs: [],
        columns: [
          { key: 'date', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'voucherNo', label: 'Voucher No', type: 'text', width: 'min-w-[120px]' },
          { key: 'amount', label: 'Amount', type: 'number', required: true, width: 'min-w-[110px]' },
          { key: 'mode', label: 'Mode', type: 'text', width: 'min-w-[90px]' },
          { key: 'particulars', label: 'Particulars', type: 'text', width: 'min-w-[160px]' },
        ],
        emptyRow: () => ({ date: today(), voucherNo: '', amount: '', mode: 'CASH', particulars: '' }),
        rowTotal: (r) => n(r.amount),
      };
    case 'production-work':
      return {
        title: 'Upload / Add Multiple Old Work Entries',
        hint: 'Finished work for any workers, recorded like Record Old Entry (completed, price kept, no WhatsApp).',
        templateFileName: 'old-work-entries-template',
        needs: ['workers'],
        columns: [{ key: 'carpenterId', label: 'Worker', type: 'select', required: true, options: opts(lists.workers), width: 'min-w-[150px]' }, ...WORK_COLUMNS],
        emptyRow: () => ({ carpenterId: '', ...emptyWork() }),
        rowTotal: workTotal,
      };
    case 'worker-work':
      return {
        title: 'Add Multiple Old Entries',
        hint: "PDF / Excel of this worker's work list (DATE, MODEL-NO, PRODUCT NAME, PRODUCT, SIZE, PRICE, EXTRA, NO, TOTAL).",
        templateFileName: 'work-list-template',
        needs: [],
        columns: WORK_COLUMNS,
        emptyRow: emptyWork,
        rowTotal: workTotal,
      };
    case 'worker-payments':
      return {
        title: 'Add Multiple Payments',
        templateFileName: 'worker-payments-template',
        needs: [],
        columns: [
          { key: 'date', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'paymentType', label: 'Type', type: 'select', options: WORKER_PAYMENT_TYPES, width: 'min-w-[130px]' },
          { key: 'reference', label: 'Voucher No', type: 'text', width: 'min-w-[120px]' },
          { key: 'amount', label: 'Amount', type: 'number', required: true, width: 'min-w-[110px]' },
          { key: 'mode', label: 'Mode', type: 'text', width: 'min-w-[90px]' },
          { key: 'note', label: 'Note', type: 'text', width: 'min-w-[160px]' },
        ],
        emptyRow: () => ({ date: today(), paymentType: 'SALARY', reference: '', amount: '', mode: 'CASH', note: '' }),
        rowTotal: (r) => n(r.amount),
      };
    case 'payments':
      return {
        title: 'Upload / Add Multiple Payments',
        hint: 'Reference = Order ID (customer), Job No (party), supplier name, or worker name. Expenses are uploaded on the Expenses page.',
        templateFileName: 'payments-template',
        needs: [],
        columns: [
          {
            key: 'source',
            label: 'Source',
            type: 'select',
            required: true,
            options: [
              { value: 'CUSTOMER_ORDER', label: 'Customer Order' },
              { value: 'PARTY_ORDER', label: 'Party Order' },
              { value: 'SUPPLIER', label: 'Supplier' },
              { value: 'CARPENTER', label: 'Worker' },
            ],
            width: 'min-w-[140px]',
          },
          { key: 'reference', label: 'Reference', type: 'text', required: true, width: 'min-w-[150px]' },
          { key: 'date', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'amount', label: 'Amount', type: 'number', required: true, width: 'min-w-[110px]' },
          { key: 'type', label: 'Type', type: 'text', width: 'min-w-[100px]' },
          { key: 'mode', label: 'Mode', type: 'text', width: 'min-w-[90px]' },
          { key: 'voucherNo', label: 'Voucher No', type: 'text', width: 'min-w-[110px]' },
          { key: 'note', label: 'Note', type: 'text', width: 'min-w-[150px]' },
        ],
        emptyRow: () => ({ source: '', reference: '', date: today(), amount: '', type: '', mode: 'CASH', voucherNo: '', note: '' }),
        rowTotal: (r) => n(r.amount),
      };
    case 'expenses':
      return {
        title: 'Upload / Add Multiple Expenses',
        hint: 'Category and Mode must exist in Expenses > Settings.',
        templateFileName: 'expenses-template',
        needs: ['categories', 'modes'],
        columns: [
          { key: 'date', label: 'Date', type: 'date', required: true, width: 'min-w-[140px]' },
          { key: 'categoryId', label: 'Category', type: 'select', required: true, options: opts(lists.categories), width: 'min-w-[160px]' },
          { key: 'particulars', label: 'Particulars', type: 'text', required: true, width: 'min-w-[170px]' },
          { key: 'amount', label: 'Amount', type: 'number', required: true, width: 'min-w-[110px]' },
          { key: 'paymentModeId', label: 'Mode', type: 'select', required: true, options: opts(lists.modes), width: 'min-w-[130px]' },
          {
            key: 'scope',
            label: 'Scope',
            type: 'select',
            options: [
              { value: 'COMPANY', label: 'Company' },
              { value: 'PERSONAL', label: 'Personal' },
            ],
          },
          { key: 'paidBy', label: 'Paid By', type: 'text', width: 'min-w-[110px]' },
          { key: 'vendorName', label: 'Vendor', type: 'text', width: 'min-w-[130px]' },
          { key: 'notes', label: 'Notes', type: 'text', width: 'min-w-[150px]' },
        ],
        emptyRow: () => ({ date: today(), categoryId: '', particulars: '', amount: '', paymentModeId: '', scope: 'COMPANY', paidBy: '', vendorName: '', notes: '' }),
        rowTotal: (r) => n(r.amount),
      };
  }
}

function ImportWindow({ kind, scope, onClose, onSaved }: { kind: ImportKind; scope?: Record<string, string>; onClose: () => void; onSaved: (r: { created: number; total: number }) => void }) {
  const { user } = useAuth();
  const needs = configFor(kind, {}, false).needs;
  const want = (k: Config['needs'][number], url: string) => (needs.includes(k) ? url : null);
  const { data: shops } = useSWR<Named[]>(want('shops', '/shops'), fetcher);
  const { data: suppliers } = useSWR<Named[]>(want('suppliers', '/suppliers'), fetcher);
  const { data: materials } = useSWR<Material[]>(want('materials', '/raw-materials'), fetcher);
  const { data: workers } = useSWR<Named[]>(want('workers', '/carpenters'), fetcher);
  const { data: categories } = useSWR<Named[]>(want('categories', '/expense-config/categories'), fetcher);
  const { data: modes } = useSWR<Named[]>(want('modes', '/expense-config/payment-modes'), fetcher);
  const c = configFor(kind, { shops, suppliers, materials, workers, categories, modes }, user?.role === 'SUPERADMIN');
  return (
    <BulkImportModal
      kind={kind}
      scope={scope}
      title={c.title}
      hint={c.hint}
      columns={c.columns}
      emptyRow={c.emptyRow}
      rowTotal={c.rowTotal}
      switches={c.switches}
      templateFileName={c.templateFileName}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

export function ImportButton({
  kind,
  scope,
  label = 'Upload / Add Multiple',
  className = 'btn-secondary',
  onSaved,
}: {
  kind: ImportKind;
  scope?: Record<string, string>;
  label?: string;
  className?: string;
  // Optional - every list on the page is refreshed automatically after a save.
  onSaved?: (result: { created: number; total: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const saved = (result: { created: number; total: number }) => {
    revalidate(() => true);
    onSaved?.(result);
  };
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <ImportWindow kind={kind} scope={scope} onClose={() => setOpen(false)} onSaved={saved} />}
    </>
  );
}
