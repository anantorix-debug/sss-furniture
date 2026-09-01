# WhatsApp Integration - Complete Setup

## ✅ WHAT'S READY

### Components Created
1. **WhatsAppModal.tsx** - Reusable popup for chat selection & messaging
2. **WhatsAppActionButton.tsx** - Button to trigger modal (SUPERADMIN only)
3. **useWhatsApp.ts** - Hook for managing modal state & permissions

### Features Implemented
- ✅ Popup modal with chat/group selection
- ✅ Message text area with character count
- ✅ Search/filter chats by name or ID
- ✅ Role-based access (SUPERADMIN only)
- ✅ Status indicators (@lid, Group badges)
- ✅ Auto-fetches chats from backend
- ✅ Success/error messages
- ✅ Proper timeout handling (45 seconds)
- ✅ No access for ADMIN or EMPLOYEE roles

### Documentation
- ✅ Comprehensive integration guide
- ✅ Example implementations
- ✅ Testing checklist
- ✅ Troubleshooting guide

---

## 📋 WHAT NEEDS TO BE DONE

### Module Updates Required

#### 1. **Purchase Orders** (`apps/web/src/app/(dashboard)/purchase-orders/page.tsx`)
- Add WhatsApp button to each PO row
- Send button with default message: PO number, total, expected date
- Message to supplier phone

#### 2. **Purchase Order Detail** (`apps/web/src/app/(dashboard)/purchase-orders/[id]/page.tsx`)
- Add WhatsApp button to supplier info
- Pre-fill with PO details

#### 3. **Customer Orders** (`apps/web/src/app/(dashboard)/customer-orders/page.tsx`)
- Add WhatsApp button for each order
- Message to customer phone
- Include order ID, product, quantity, delivery date

#### 4. **Party Orders** (`apps/web/src/app/(dashboard)/party-orders/page.tsx`)
- Add WhatsApp button per order
- Message to party phone
- Include shop name, model, quantity, delivery date

#### 5. **Carpenters** (`apps/web/src/app/(dashboard)/carpenters/[id]/page.tsx`)
- Add WhatsApp button for work assignment
- Message to carpenter phone
- Format work details

### DO NOT Update
- ❌ Inventory tab
- ❌ Carving tab

---

## 🚀 IMPLEMENTATION STEPS

### For Each Module:

```typescript
// Step 1: Add imports
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';

// Step 2: Add hook
const {
  canUseWhatsApp,
  showModal,
  whatsappOptions,
  openWhatsApp,
  closeWhatsApp,
} = useWhatsApp();

// Step 3: Add button to UI
<WhatsAppActionButton
  recipientName="Name"
  recipientPhone="9876543210"
  onClick={() => openWhatsApp({
    recipientName: 'Name',
    recipientPhone: '9876543210',
    defaultMessage: 'Your message',
  })}
/>

// Step 4: Add modal to JSX
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

See `WHATSAPP_INTEGRATION_GUIDE.md` for detailed examples.

---

## 👤 PERMISSION MATRIX

| Feature | SUPERADMIN | ADMIN | EMPLOYEE |
|---------|:----------:|:-----:|:--------:|
| WhatsApp Button | ✅ | ❌ | ❌ |
| Send Messages | ✅ | ❌ | ❌ |
| Share Features | ✅ | ❌ | ❌ |
| View Reports | ✅ | ✅ | ✅ |
| Edit Data | ✅ | ✅ | ✅ |

---

## 📱 DEFAULT MESSAGES

### Purchase Orders
```
Purchase Order {poNumber}
Total: ₹{totalValue}
Expected by: {expectedDate}
Items: {itemCount} items
```

### Customer Orders
```
Order Confirmation
Order ID: {orderId}
Product: {productName}
Quantity: {quantity}
Expected Delivery: {deliveryDate}
```

### Party Orders
```
New Order
Shop: {shopName}
Model: {model}
Quantity: {qty}
Expected Delivery: {deliveryDate}
```

### Carpenters
```
New Work Assigned - SSS Company
Carpenter: {carpenterName}
Date: {workDate}
Product: {productName}
Quantity: {quantity}
Total: ₹{total}
```

---

## 🔧 EXAMPLE: Purchase Orders

**File:** `apps/web/src/app/(dashboard)/purchase-orders/page.tsx`

```typescript
'use client';

import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';

export default function PurchaseOrdersPage() {
  const {
    canUseWhatsApp,
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  function handleSendWhatsApp(po: PurchaseOrder) {
    openWhatsApp({
      recipientName: po.supplier?.name || 'Supplier',
      recipientPhone: po.supplier?.phone,
      defaultMessage: `Purchase Order ${po.poNumber}
Total: ₹${po.totalValue}
Expected by: ${po.expectedDate}`,
    });
  }

  return (
    <>
      <div className="space-y-2">
        {purchaseOrders?.map((po) => (
          <div key={po.id} className="card p-4 flex justify-between">
            <div>
              <p className="font-semibold">{po.poNumber}</p>
              <p className="text-sm text-brand-500">{po.supplier?.name}</p>
            </div>
            <div className="flex gap-2">
              <WhatsAppActionButton
                recipientName={po.supplier?.name || 'Supplier'}
                recipientPhone={po.supplier?.phone}
                onClick={() => handleSendWhatsApp(po)}
              />
            </div>
          </div>
        ))}
      </div>

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
    </>
  );
}
```

---

## ✅ TESTING CHECKLIST

For each module, verify:
- [ ] Button visible for SUPERADMIN
- [ ] Button hidden for ADMIN
- [ ] Button hidden for EMPLOYEE
- [ ] Button opens modal
- [ ] Default message pre-filled
- [ ] Recipient info shows correctly
- [ ] Can search chats
- [ ] Can select chat/group
- [ ] Can type and send message
- [ ] Success message appears
- [ ] Modal closes after send
- [ ] Data refreshes

---

## 📊 BACKEND VERIFICATION

All endpoints are already integrated:
- ✅ `GET /whatsapp/status` - Check connection
- ✅ `GET /whatsapp/chats` - List contacts/groups
- ✅ `POST /whatsapp/send/:chatId` - Send message
- ✅ Role guards enforced on backend (SUPERADMIN only)
- ✅ 45-second timeout configured
- ✅ Polling disabled (on-demand only)

---

## 📁 FILES CREATED

```
Components:
  ✅ apps/web/src/components/WhatsAppModal.tsx
  ✅ apps/web/src/components/WhatsAppActionButton.tsx

Hooks:
  ✅ apps/web/src/hooks/useWhatsApp.ts

Documentation:
  ✅ WHATSAPP_INTEGRATION_GUIDE.md
  ✅ WHATSAPP_SETUP_SUMMARY.md (this file)
```

---

## 🎯 NEXT STEPS

1. **Update 5 modules** using the template above
2. **Test each module** with SUPERADMIN account
3. **Verify** ADMIN and EMPLOYEE can't see buttons
4. **Check** default messages work correctly
5. **Deploy** when all modules are updated

---

## 💡 QUICK REFERENCE

**Add to any module:**
```
Import → Hook → Button → Modal
```

**Role check:**
```
const { canUseWhatsApp } = useWhatsApp();
```

**Only SUPERADMIN see button:**
```
<WhatsAppActionButton ... />  // Automatically hidden for non-SUPERADMIN
```

---

**Status:** ✅ Framework complete, awaiting module integration
**Estimated time to integrate all modules:** 15-20 minutes
**Testing time:** 10-15 minutes
**Total:** ~30-35 minutes

Ready to proceed! 🚀
