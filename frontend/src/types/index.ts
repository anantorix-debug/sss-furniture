export type Role = 'SUPERADMIN' | 'ADMIN' | 'CARPENTER' | 'POLISHER';
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

export interface Payment {
  id: string;
  date: string;
  amount: number;
  mode?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface CustomerOrderItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
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
}

export interface PartyOrder {
  id: string;
  cotNo?: string | null;
  jobNumber?: string | null;
  orderDate: string;
  shopName: string;
  phone?: string | null;
  model: string;
  finish?: string | null;
  details?: string | null;
  qty: number;
  cashTrack?: string | null;
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
  // Omitted entirely for Carpenter/Polisher viewers - they never see
  // wages/balances, including their own or anyone else's.
  totalWorkValue?: number;
  totalPaid?: number;
  balance?: number;
  workItemCount: number;
}

export type ProductionStage = 'CARPENTER' | 'CARVING' | 'POLISH';

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
  modelNo?: string | null;
  name: string;
  category?: string | null;
  modelSize?: string | null;
  materialFinish?: string | null;
  unit?: string | null;
  retailPrice: number;
  wholesalePrice?: number | null;
  costPrice?: number | null;
  isActive: boolean;
  createdAt: string;
  images: ProductImage[];
}

export interface RawMaterial {
  id: string;
  name: string;
  type?: string | null;
  unit: string;
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
