export type Role = 'SUPERADMIN' | 'ADMIN' | 'CARPENTER' | 'CARVER' | 'POLISHER';
export type DeliveryStatus = 'PENDING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'CANCELLED';
export type WorkStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'QUALITY_CHECK' | 'REWORK' | 'COMPLETED';
export type PurchaseOrderStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'REJECTED' | 'APPROVED' | 'SENT_TO_SHOP' | 'RECEIVED' | 'CANCELLED';
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  SENT_TO_SHOP: 'Sent to Shop',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};
export type StockMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PaymentType = 'ADVANCE' | 'PARTIAL' | 'BALANCE' | 'FULL';

export interface Payment {
  id: string;
  date: string;
  amount: number;
  type?: PaymentType;
  mode?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface CustomerOrderItem {
  id: string;
  productId?: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  // Stock-first split, computed at create/edit time.
  stockReservedQty?: number;
  productionQty?: number;
}

export interface CustomerOrder {
  id: string;
  orderId: string;
  jobNumber?: string | null;
  orderDate: string;
  customerName: string;
  phone?: string | null;
  address?: string | null;
  product: string;
  size?: string | null;
  sizeUnit?: string | null;
  colour?: string | null;
  specialInstructions?: string | null;
  cotTrack?: string | null;
  actualDeliveryDate?: string | null;
  deliveryStatus: DeliveryStatus;
  createdBy?: { id: string; name: string };
  createdAt: string;
  assignedEmployee?: { id: string; name: string } | null;
  assignedBy?: { id: string; name: string } | null;
  assignedAt?: string | null;
  modelNoUpdatedBy?: { id: string; name: string } | null;
  modelNoUpdatedAt?: string | null;
  // Omitted entirely for Carpenter/Polisher viewers - `paymentStatus`
  // (a non-monetary SETTLED/DUE flag) is all they get instead.
  orderValue?: number;
  items?: CustomerOrderItem[];
  payments?: Payment[];
  totalReceived?: number;
  balanceAmount?: number;
  paymentStatus?: 'SETTLED' | 'DUE';
  // Reference-only Gallery images selected for this order (never re-uploaded).
  galleryImages?: GalleryImage[];
}

export interface PartyOrderItem {
  id: string;
  productId?: string | null;
  productName: string;
  finish?: string | null;
  size?: string | null;
  sizeUnit?: string | null;
  pattern?: string | null;
  details?: string | null;
  qty: number;
  modelNo?: string | null;
  // Stock-first split, computed at create/edit time.
  stockReservedQty?: number;
  productionQty?: number;
  // Omitted entirely for Carpenter/Polisher viewers.
  unitPrice?: number;
  totalValue?: number;
}

export interface PartyOrder {
  id: string;
  cotNo?: string | null;
  jobNumber?: string | null;
  orderDate: string;
  shopName: string;
  shopId?: string | null;
  phone?: string | null;
  // Legacy single-product fields - present only on rows created before the
  // multi-line redesign. New orders use `items` instead.
  model?: string | null;
  size?: string | null;
  sizeUnit?: string | null;
  finish?: string | null;
  details?: string | null;
  qty?: number | null;
  items: PartyOrderItem[];
  courierTrack?: string | null;
  actualDeliveryDate?: string | null;
  deliveryStatus: DeliveryStatus;
  createdBy?: { id: string; name: string };
  createdAt: string;
  assignedEmployee?: { id: string; name: string } | null;
  assignedBy?: { id: string; name: string } | null;
  assignedAt?: string | null;
  modelNoUpdatedBy?: { id: string; name: string } | null;
  modelNoUpdatedAt?: string | null;
  // Omitted entirely for Carpenter/Polisher viewers - `paymentStatus`
  // (a non-monetary SETTLED/DUE flag) is all they get instead.
  price?: number;
  totalAmount?: number;
  payments?: Payment[];
  receivedAmount?: number;
  balanceAmount?: number;
  paymentStatus?: 'SETTLED' | 'DUE';
}

export interface GalleryImage {
  id: string;
  url: string;
  fileName: string;
  fileSize: number;
  modelNo?: string | null;
  caption?: string | null;
  uploadedBy?: { id: string; name: string };
  createdAt: string;
}

export interface Shop {
  id: string;
  name: string;
  contactPhone?: string | null;
  address?: string | null;
  isActive: boolean;
}

export interface SupplierSummary {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  totalPurchaseValue: number;
  totalPaid: number;
  balance: number;
}

export interface SupplierPurchase {
  id: string;
  date: string;
  particulars: string;
  qty?: number | null;
  unit?: string | null;
  price?: number | null;
  value: number;
}

export interface SupplierPayment {
  id: string;
  date: string;
  particulars?: string | null;
  voucherNo?: string | null;
  amount: number;
  mode?: string | null;
  balanceAfter?: number;
}

export interface SupplierDetail extends SupplierSummary {
  purchases: SupplierPurchase[];
  payments: SupplierPayment[];
}

export type WorkerType = 'CARPENTER' | 'POLISHER' | 'CARVER';

export interface WhatsappGroup {
  id: string;
  name: string;
}

export interface WhatsappChat {
  id: string;
  name: string;
  isGroup: boolean;
  unread: number;
  timestamp: number | null;
  archived?: boolean;
  pinned?: boolean;
  isReadOnly?: boolean;
  isLid?: boolean;
  phoneNumber?: string | null;
}

export interface WhatsappGroupSetting {
  id: string;
  workerType: WorkerType;
  groupId: string;
  groupName?: string | null;
  updatedAt: string;
}

export interface CarpenterSummary {
  id: string;
  name: string;
  phone?: string | null;
  workerType: WorkerType;
  // The login (Carpenter/Carver/Polisher role User) this payee profile is
  // linked to, if any - lets that user's "My Work" page find their own jobs.
  user?: { id: string; name: string; role: Role } | null;
  // Omitted entirely for Carpenter/Polisher viewers - they never see
  // wages/balances, including their own or anyone else's.
  totalWorkValue?: number;
  totalPaid?: number;
  balance?: number;
  workItemCount: number;
}

export type ProductionStage = 'CARPENTER' | 'CARVING' | 'POLISH';
export type ProductionSource = 'CUSTOMER_ORDER' | 'PARTY_ORDER' | 'STOCK';

export interface CarpenterWorkItem {
  id: string;
  carpenterId?: string | null;
  carpenter?: { id: string; name: string; phone?: string | null; workerType?: WorkerType } | null;
  stage: ProductionStage;
  workDate: string;
  modelNo?: string | null;
  productName: string;
  category?: string | null;
  size?: string | null;
  // Omitted for Carpenter/Polisher viewers.
  price?: number;
  extra?: number;
  quantity: number;
  total?: number;
  status: WorkStatus;
  qcNote?: string | null;
  createdBy?: { name: string };
  whatsapp?: { sent: boolean; reason?: string };
  stockMovements?: StockMovement[];
  // Which trigger created this item (default STOCK) - drives the
  // completion-time bridge into Godown Stock vs. an order's
  // FinishedStockItem. See CarpenterService.updateWorkStatus.
  source?: ProductionSource;
  sourceCustomerOrderId?: string | null;
  sourcePartyOrderItemId?: string | null;
  productId?: string | null;
  // Sequential Carpenter -> Carving -> Polish engine fields. batchId ties
  // together the stage-rows of one production run - null on legacy rows
  // that predate the sequential pipeline (still shown on the old
  // QC/Finished Stock flow instead of the new Verification tab).
  batchId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  notes?: string | null;
  assignedById?: string | null;
  assignedBy?: { name: string } | null;
}

// Production Control Center - GET /carpenter-work-items/dashboard
export interface ProductionDashboard {
  kpis: {
    activeWorkers: number;
    jobsInProgress: number;
    pendingByStage: Record<ProductionStage, number>;
    readyForVerification: number;
    stockProductionToday: number;
    orderProductionToday: number;
    materialsUsedToday: number;
    completedToday: number;
  };
  groups: {
    todaysWork: CarpenterWorkItem[];
    waiting: CarpenterWorkItem[];
    stockProduction: CarpenterWorkItem[];
    orderProduction: CarpenterWorkItem[];
    completedToday: CarpenterWorkItem[];
  };
}

export type QcResult = 'PASSED' | 'FAILED' | 'REWORK_REQUIRED';

export interface QualityCheck {
  id: string;
  jobNumber: string;
  workItemId?: string | null;
  result: QcResult;
  remarks?: string | null;
  inspectedBy?: { id: string; name: string };
  createdAt: string;
}

export type FinishedStockStatus = 'AVAILABLE' | 'RESERVED' | 'DISPATCHED';

export interface FinishedStockItem {
  id: string;
  jobNumber: string;
  productName: string;
  quantity: number;
  completionDate: string;
  location?: string | null;
  status: FinishedStockStatus;
}

export interface DispatchRecord {
  id: string;
  jobNumber: string;
  finishedStockId?: string | null;
  dispatchDate: string;
  vehicle?: string | null;
  driverName?: string | null;
  driverContact?: string | null;
  remarks?: string | null;
  dispatchedBy?: { id: string; name: string };
}

export interface CarpenterPayment {
  id: string;
  date: string;
  amount: number;
  mode?: string | null;
  note?: string | null;
}

export interface CarpenterDetail extends CarpenterSummary {
  workItems: CarpenterWorkItem[];
  // Omitted entirely for Carpenter/Polisher viewers.
  payments?: CarpenterPayment[];
}

export interface DashboardSummary {
  customerOrders: { count: number; pending: number; delivered: number; totalValue: number; totalReceived: number; totalBalance: number };
  partyOrders: { count: number; pending: number; delivered: number; totalValue: number; totalReceived: number; totalBalance: number };
  suppliers: { count: number; totalPurchaseValue: number; totalPaid: number; totalBalance: number };
  carpenters: { count: number };
}

export interface DashboardTrendPoint {
  date: string; // YYYY-MM-DD
  customerOrders: number;
  partyOrders: number;
  paymentsReceived: number;
  productionCompleted: number;
}

// --- Products & Inventory --------------------------------------------------

export interface ProductImage {
  id: string;
  url: string;
  fileName: string;
  fileSize: number;
  isPrimary: boolean;
}

export interface Product {
  id: string;
  sku?: string | null;
  modelNo?: string | null; // "Not Updated" in the UI until Production Employee assigns one
  name: string;
  category?: string | null;
  modelSize?: string | null;
  materialFinish?: string | null;
  sizeUnit?: string | null;
  pattern?: string | null;
  details?: string | null;
  unit?: string | null;
  retailPrice: number; // Unit Price
  wholesalePrice?: number | null;
  costPrice?: number | null;
  isActive: boolean;
  createdAt: string;
  images: ProductImage[];
  // Godown stock - omitted for Carpenter/Polisher viewers (financial strip).
  quantity?: number;
  availableQuantity?: number;
  reservedQuantity?: number;
}

export type ProductStockMovementType = 'IN' | 'RESERVED' | 'RELEASED' | 'DISPATCHED' | 'ADJUSTMENT';

export interface ProductStockMovement {
  id: string;
  productId: string;
  product?: { id: string; name: string; modelNo?: string | null };
  type: ProductStockMovementType;
  quantity: number;
  previousAvailable: number;
  newAvailable: number;
  orderType?: 'CUSTOMER' | 'PARTY' | null;
  orderId?: string | null;
  reason?: string | null;
  createdBy?: { id: string; name: string };
  createdAt: string;
}

export type MaterialGroup = 'WOOD' | 'CARVING' | 'POLISH' | 'OTHER';

export interface RawMaterial {
  id: string;
  name: string;
  type?: string | null;
  unit: string;
  materialGroup: MaterialGroup;
  reorderLevel?: number | null;
  inStock: number;
  purchaseRate: number;
  stockValue: number;
  isLow: boolean;
}

export interface StockMovement {
  id: string;
  rawMaterialId: string;
  rawMaterial?: { id: string; name: string; unit: string };
  type: StockMovementType;
  quantity: number;
  unitCost?: number | null;
  reason?: string | null;
  workItemId?: string | null;
  workItem?: { id: string; productName: string; carpenter?: { name: string; workerType?: WorkerType } | null } | null;
  purchaseOrderId?: string | null;
  purchaseOrder?: { id: string; poNumber: string } | null;
  date: string;
  createdBy?: { name: string };
}

export interface RawMaterialDetail extends RawMaterial {
  stockMovements: StockMovement[];
}

// --- Purchase Orders --------------------------------------------------------

export interface PurchaseOrderItem {
  id: string;
  rawMaterialId: string;
  rawMaterial?: { id: string; name: string; unit: string };
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier?: { id: string; name: string; phone?: string | null };
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  rejectionReason?: string | null;
  sentToShopAt?: string | null;
  items: PurchaseOrderItem[];
  totalValue: number;
  createdBy?: { name: string };
  approvedBy?: { name: string } | null;
  createdAt: string;
  whatsapp?: { sent: boolean; reason?: string };
}

// --- Unified payments & reports ---------------------------------------------

export type PaymentSource = 'CUSTOMER_ORDER' | 'PARTY_ORDER' | 'SUPPLIER' | 'CARPENTER';

export interface UnifiedPayment {
  id: string;
  source: PaymentSource;
  date: string;
  amount: number;
  mode?: string | null;
  note?: string | null;
  relatedName: string;
  relatedId: string;
  direction: 'IN' | 'OUT';
}

export interface UnifiedPaymentsResponse {
  payments: UnifiedPayment[];
  totalIn: number;
  totalOut: number;
  net: number;
}

export interface SalesReportRow {
  channel: 'Retail' | 'Wholesale';
  date: string;
  reference: string;
  party: string;
  value: number;
  received: number;
  status: DeliveryStatus;
}

export interface SalesReport {
  rows: SalesReportRow[];
  count: number;
  totalValue: number;
  totalReceived: number;
  totalBalance: number;
}

export interface ProfitAndLoss {
  revenue: { retail: number; wholesale: number; total: number };
  costs: { materials: number; labour: number; total: number };
  profit: number;
}

// --- Audit log ---------------------------------------------------------------

// --- Global Job/Model Number tracking -----------------------------------

export interface TrackMaterialPurchase {
  date: string;
  quantity: number;
  poNumber?: string | null;
  supplierName?: string | null;
  supplierPhone?: string | null;
  unitCost?: number | null;
}

export interface TrackMaterial {
  id: string;
  rawMaterialName: string;
  rawMaterialType?: string | null;
  unit: string;
  quantityIssued: number;
  issuedDate: string;
  purchaseHistory: TrackMaterialPurchase[];
}

export interface TrackWorkItem {
  id: string;
  modelNo?: string | null;
  stage: string;
  productName: string;
  category?: string | null;
  size?: string | null;
  quantity: number;
  status: WorkStatus;
  assignedDate: string;
  completedDate?: string | null;
  qcNote?: string | null;
  photoUrl?: string | null;
  carpenter?: { name: string; phone?: string | null; workerType?: WorkerType } | null;
  createdBy?: string;
  price?: number;
  extra?: number;
  total?: number;
  materials: TrackMaterial[];
}

export interface TrackResult {
  query: string;
  found: boolean;
  product: {
    id: string;
    sku?: string | null;
    modelNo?: string | null;
    name: string;
    category?: string | null;
    modelSize?: string | null;
    materialFinish?: string | null;
    unit?: string | null;
    isActive: boolean;
    retailPrice?: number;
    wholesalePrice?: number | null;
    costPrice?: number | null;
  } | null;
  customerOrders: {
    id: string;
    orderId: string;
    jobNumber?: string | null;
    customerName: string;
    phone?: string | null;
    address?: string | null;
    product: string;
    colour?: string | null;
    deliveryStatus: DeliveryStatus;
    orderDate: string;
    expectedDeliveryDate?: string | null;
    actualDeliveryDate?: string | null;
    cotTrack?: string | null;
    carvingRequired?: boolean;
    specialInstructions?: string | null;
    createdBy?: string;
    assignedEmployee?: string | null;
    modelNoUpdatedBy?: string | null;
    modelNoUpdatedAt?: string | null;
    paymentStatus: 'SETTLED' | 'DUE';
    orderValue?: number;
    totalReceived?: number;
    balanceAmount?: number;
  }[];
  partyOrders: {
    id: string;
    cotNo?: string | null;
    shopName: string;
    phone?: string | null;
    model: string;
    finish?: string | null;
    qty: number;
    deliveryStatus: DeliveryStatus;
    orderDate: string;
    actualDeliveryDate?: string | null;
    createdBy?: string;
    assignedEmployee?: string | null;
    modelNoUpdatedBy?: string | null;
    modelNoUpdatedAt?: string | null;
    paymentStatus: 'SETTLED' | 'DUE';
    price?: number;
    totalAmount?: number;
    totalReceived?: number;
    balanceAmount?: number;
  }[];
  // Multi-line Party Order matches (current flow) - one per matching
  // product line, since an order can now hold many different Model Nos.
  partyOrderItems: {
    id: string;
    orderId: string;
    modelNo?: string | null;
    productName: string;
    finish?: string | null;
    size?: string | null;
    qty: number;
    stockReservedQty: number;
    productionQty: number;
    shopName: string;
    phone?: string | null;
    deliveryStatus: DeliveryStatus;
    orderDate: string;
    actualDeliveryDate?: string | null;
    createdBy?: string;
    modelNoUpdatedBy?: string | null;
    modelNoUpdatedAt?: string | null;
    paymentStatus: 'SETTLED' | 'DUE';
    unitPrice?: number;
    totalValue?: number;
    totalReceived?: number;
    balanceAmount?: number;
  }[];
  workItems: TrackWorkItem[];
}

export interface AuditLogEntry {
  id: string;
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  user?: { name: string; role: Role } | null;
}

// Persisted, server-tracked notifications (production stage/material
// events) - distinct from NotificationBell's other, locally-computed
// sources (low stock, QC-pending work items, pending POs).
export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  targetType?: string | null;
  targetId?: string | null;
  isRead: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Expenses (Super Admin financial control center)
// ---------------------------------------------------------------------------

export type ExpenseScope = 'COMPANY' | 'PERSONAL';
export type ExpenseRecordStatus = 'ACTIVE' | 'ARCHIVED';

export interface ExpenseCategory {
  id: string;
  name: string;
  scope: ExpenseScope | null;
  defaultReferenceTypeId?: string | null;
  defaultReferenceType?: ExpenseReferenceType | null;
  isActive: boolean;
}

export interface ExpenseReferenceType {
  id: string;
  code: string;
  label: string;
  isActive: boolean;
}

export interface ExpensePaymentMode {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Expense {
  id: string;
  date: string;
  voucherNumber: number;
  referenceTypeId?: string | null;
  referenceType?: ExpenseReferenceType | null;
  categoryId: string;
  category: ExpenseCategory;
  particulars: string;
  amount: number;
  paymentModeId: string;
  paymentMode: ExpensePaymentMode;
  scope: ExpenseScope;
  paidBy?: string | null;
  employeeId?: string | null;
  employee?: { id: string; name: string; phone?: string | null } | null;
  vendorName?: string | null;
  description?: string | null;
  notes?: string | null;
  attachmentUrl?: string | null;
  tags?: string | null;
  status: ExpenseRecordStatus;
  createdBy?: { id: string; name: string };
  updatedBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseAuditEntry {
  id: string;
  action: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  user?: { id: string; name: string } | null;
  createdAt: string;
}

export interface ExpenseSummary {
  overallTotal: number;
  companyTotal: number;
  personalTotal: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  byCategory: { categoryId: string; categoryName: string; total: number }[];
  byPaymentMode: { paymentModeId: string; paymentModeName: string; total: number }[];
}

export interface ExpenseMonthly {
  year: number;
  month: number;
  total: number;
  company: number;
  personal: number;
  byCategory: { categoryId: string; categoryName: string; total: number }[];
}
