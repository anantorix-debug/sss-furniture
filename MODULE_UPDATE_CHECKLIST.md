# WhatsApp Integration - Module Update Checklist

## ✅ COMPLETED
- [x] **Purchase Orders** (`purchase-orders/page.tsx`) - WhatsApp button added to each PO row

## ⏳ REMAINING (4 modules)

All follow the exact same pattern. Use this template for each:

### Template Pattern

**File:** `apps/web/src/app/(dashboard)/[MODULE]/page.tsx`

#### 1. Add Imports (after existing imports)
```typescript
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
```

#### 2. Initialize Hook (in component function, with other hooks)
```typescript
const {
  canUseWhatsApp,
  showModal,
  whatsappOptions,
  openWhatsApp,
  closeWhatsApp,
} = useWhatsApp();
```

#### 3. Add Handler Function (before JSX return)
```typescript
function handleSendWhatsApp(item: ItemType) {
  openWhatsApp({
    recipientName: item.recipientName || 'Recipient',
    recipientPhone: item.phone,
    defaultMessage: `Your custom message here\nWith item details`,
  });
}
```

#### 4. Add Button to UI (in the item row/table)
```typescript
<WhatsAppActionButton
  recipientName={item.recipientName || 'Recipient'}
  recipientPhone={item.phone}
  onClick={() => handleSendWhatsApp(item)}
  size="sm"
/>
```

#### 5. Add Modal at End (before closing `</div>` of component JSX)
```typescript
{canUseWhatsApp && (
  <WhatsAppModal
    open={showModal}
    onClose={closeWhatsApp}
    recipientInfo={{
      name: whatsappOptions?.recipientName || '',
      phone: whatsappOptions?.recipientPhone,
    }}
    defaultMessage={whatsappOptions?.defaultMessage}
    onSuccess={() => mutate()}
  />
)}
```

---

## 2. Customer Orders
**File:** `apps/web/src/app/(dashboard)/customer-orders/page.tsx`

**Default Message Template:**
```typescript
defaultMessage: `Order Confirmation
Order ID: ${item.orderId}
Product: ${item.product}
Quantity: ${item.quantity}
Expected Delivery: ${formatDate(item.expectedDeliveryDate)}`
```

**Recipient:** `item.customerName`, `item.phone`

---

## 3. Party Orders
**File:** `apps/web/src/app/(dashboard)/party-orders/page.tsx`

**Default Message Template:**
```typescript
defaultMessage: `New Order
Shop: ${item.shopName}
Model: ${item.model}
Quantity: ${item.qty}
Expected Delivery: ${formatDate(item.actualDeliveryDate)}`
```

**Recipient:** `item.shopName`, `item.phone`

---

## 4. Carpenters
**File:** `apps/web/src/app/(dashboard)/carpenters/[id]/page.tsx`

**Default Message Template:**
```typescript
defaultMessage: `New Work Assigned - SSS Company
Carpenter: ${carpenter.name}
Date: ${workDate}
Product: ${item.productName}
Quantity: ${item.quantity}
Total: ₹${item.total}`
```

**Recipient:** `carpenter.name`, `carpenter.phone`

---

## 5. Purchase Order Detail
**File:** `apps/web/src/app/(dashboard)/purchase-orders/[id]/page.tsx`

Same as Purchase Orders list, but for the detail view:

**Recipient:** `po.supplier?.name`, `po.supplier?.phone`

**Default Message:**
```typescript
defaultMessage: `Purchase Order ${po.poNumber}
Total: ₹${po.totalValue}
Expected by: ${po.expectedDate ? formatDate(po.expectedDate) : 'TBD'}`
```

---

## DO NOT UPDATE
- ❌ Inventory tab
- ❌ Carving tab

---

## Quick Update Steps for Each Module

1. **Copy all 5 lines** of imports
2. **Paste imports** after existing imports (adjust line numbers)
3. **Copy hook initialization** (6 lines with destructuring)
4. **Paste after other hooks** in the component function
5. **Copy handler function** (5-6 lines)
6. **Paste before JSX return statement**
7. **Copy WhatsAppActionButton** (5 lines)
8. **Paste in the item row/table next to other action buttons**
9. **Copy WhatsAppModal** (10 lines)
10. **Paste at the very end before closing `</div>`**

---

## Verification Checklist for Each Module

- [ ] Imports added
- [ ] Hook initialized
- [ ] Handler function defined
- [ ] Button rendered in UI
- [ ] Modal added at end
- [ ] Default message template customized for module
- [ ] Recipient name and phone correct
- [ ] Build succeeds: `npm run build`
- [ ] SUPERADMIN can see button
- [ ] ADMIN cannot see button
- [ ] EMPLOYEE cannot see button

---

## Build & Test

After updating all modules:

```bash
cd apps/web
npm run build
npm run dev
```

Test with:
- **SUPERADMIN account** - Should see all WhatsApp buttons
- **ADMIN account** - Should NOT see any WhatsApp buttons
- **EMPLOYEE account** - Should NOT see any WhatsApp buttons

---

## Total Time Estimate
- Update 4 modules: 10-15 minutes (copy-paste following template)
- Build: 2-3 minutes
- Testing: 5-10 minutes
- **Total: 20-30 minutes**

---

**Status:** Ready for quick copy-paste updates
