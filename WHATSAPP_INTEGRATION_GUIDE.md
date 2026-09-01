# WhatsApp Integration Guide - All Modules

## Overview

This guide explains how to integrate WhatsApp messaging into all modules with proper role-based access control.

**Key Features:**
- ✅ Popup modal for chat/group selection
- ✅ SUPERADMIN only (no access for ADMIN or EMPLOYEE)
- ✅ Reusable across all modules
- ✅ Excludes Inventory and Carving tabs

## Components Created

### 1. **WhatsAppModal** (`WhatsAppModal.tsx`)
- Popup modal for selecting contacts/groups
- Message text area
- Search/filter chat list
- Status indicators
- Automatically fetches chats from backend

### 2. **WhatsAppActionButton** (`WhatsAppActionButton.tsx`)
- Simple button to trigger modal
- Role-gated (SUPERADMIN only)
- Shows/hides based on user role

### 3. **useWhatsApp Hook** (`useWhatsApp.ts`)
- Manages modal state
- Handles role checking
- Provides open/close functions

## Integration Steps

### Step 1: Import Components in Module

```typescript
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
```

### Step 2: Add Hook to Component

```typescript
export default function MyModule() {
  const {
    canUseWhatsApp,
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  // ... rest of component
}
```

### Step 3: Add Button to UI

```typescript
<WhatsAppActionButton
  recipientName="Supplier Name"
  recipientPhone="919876543210"
  onClick={() => openWhatsApp({
    recipientName: 'Supplier Name',
    recipientPhone: '919876543210',
    defaultMessage: 'Your custom message here',
  })}
  disabled={isDisabled}
  size="sm"
/>
```

### Step 4: Add Modal to Component

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
    onSuccess={() => {
      // Optional: refresh data or show notification
      mutate();
    }}
  />
)}
```

## Modules to Update

### ✅ Include WhatsApp

1. **Purchase Orders** (`purchase-orders/page.tsx`, `[id]/page.tsx`)
   - Send PO to suppliers
   - Recipient: supplier.name, supplier.phone

2. **Customer Orders** (`customer-orders/page.tsx`)
   - Send order confirmation to customers
   - Recipient: customerName, phone

3. **Party Orders** (`party-orders/page.tsx`)
   - Send order to party/shop
   - Recipient: partyName, phone

4. **Carpenters** (`carpenters/[id]/page.tsx`)
   - Send work assignment
   - Recipient: carpenterName, phone

### ❌ Exclude from Integration

- **Inventory Tab** - No WhatsApp needed
- **Carving Tab** - No WhatsApp needed

## Example: Purchase Orders Implementation

### File: `apps/web/src/app/(dashboard)/purchase-orders/page.tsx`

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

  // ... existing code

  function handleSendWhatsApp(po: PurchaseOrder) {
    const message = `Purchase Order ${po.poNumber}\nTotal: ₹${po.totalValue}\nExpected by: ${po.expectedDate}`;
    
    openWhatsApp({
      recipientName: po.supplier?.name || 'Supplier',
      recipientPhone: po.supplier?.phone,
      defaultMessage: message,
    });
  }

  return (
    <>
      {/* Existing PO list */}
      <div className="space-y-4">
        {purchaseOrders?.map((po) => (
          <div key={po.id} className="card p-4 flex justify-between items-center">
            <div>
              <p className="font-semibold">{po.poNumber}</p>
              <p className="text-sm text-brand-500">{po.supplier?.name}</p>
            </div>
            <div className="flex gap-2">
              {/* Other buttons */}
              <WhatsAppActionButton
                recipientName={po.supplier?.name || 'Supplier'}
                recipientPhone={po.supplier?.phone}
                onClick={() => handleSendWhatsApp(po)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* WhatsApp Modal */}
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

## Permission System

### SUPERADMIN
- ✅ See WhatsApp button
- ✅ Open modal
- ✅ Select chats/groups
- ✅ Send messages
- ✅ See sharing features

### ADMIN
- ❌ No WhatsApp button visible
- ❌ No access to modal
- ❌ No access to sharing

### EMPLOYEE
- ❌ No WhatsApp button visible
- ❌ No access to modal
- ❌ No access to sharing

## Role Gate Check

The `useWhatsApp` hook automatically checks:
```typescript
const canUseWhatsApp = hasRole('SUPERADMIN');
```

This ensures:
- Button only renders if user is SUPERADMIN
- Modal only opens if SUPERADMIN
- No way for other roles to access WhatsApp

## Default Messages by Module

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

### Carpenters (Work Assignment)
```
New Work Assigned - SSS Company
Carpenter: {carpenterName}
Date: {workDate}
Product: {productName}
Quantity: {quantity}
Total: ₹{total}
```

## Testing Checklist

### For Each Module:
- [ ] Button appears for SUPERADMIN
- [ ] Button hidden for ADMIN
- [ ] Button hidden for EMPLOYEE
- [ ] Click button opens modal
- [ ] Modal shows recipient info
- [ ] Can search/select chats
- [ ] Can type message
- [ ] Send button works
- [ ] Success message appears
- [ ] Modal closes after send
- [ ] Data refreshes after send

### Edge Cases:
- [ ] WhatsApp not connected → shows warning
- [ ] No chats available → shows "No chats"
- [ ] Message empty → send button disabled
- [ ] No chat selected → send button disabled
- [ ] LID chats display correctly
- [ ] Group chats show badge
- [ ] Unread count displays

## File Locations

```
Components:
  apps/web/src/components/WhatsAppModal.tsx
  apps/web/src/components/WhatsAppActionButton.tsx

Hooks:
  apps/web/src/hooks/useWhatsApp.ts

Guide:
  WHATSAPP_INTEGRATION_GUIDE.md (this file)
```

## Backend Endpoints Used

- `GET /whatsapp/status` - Check if WhatsApp is connected
- `GET /whatsapp/chats` - Get list of available chats/groups
- `POST /whatsapp/send/:chatId` - Send message to chat

All endpoints require SUPERADMIN role (enforced on backend).

## Troubleshooting

### Button not showing
- Check user role is SUPERADMIN
- Check `useWhatsApp` hook is imported
- Check `WhatsAppActionButton` is rendered

### Modal not opening
- Check `canUseWhatsApp` is true
- Check modal is rendered in component
- Check WhatsApp is connected

### Chats not loading
- Check WhatsApp status is operational
- Check internet connection
- Check backend `/whatsapp/status` endpoint

### Message not sending
- Check chat is selected
- Check message is not empty
- Check WhatsApp is connected
- Check backend logs for errors

## Next Steps

1. ✅ Components created
2. ⏳ Update each module (follow example above)
3. ⏳ Test all modules
4. ⏳ Deploy and monitor

---

**Status:** Ready for integration into all modules
**Created:** 2026-09-01
**Last Updated:** 2026-09-01
