import { formatDate } from '@/lib/format';
import type { CustomerOrder, PartyOrder, MessageRecipientType } from '@/types';

// Shared WhatsApp order-confirmation message builders for Customer Orders
// and Party Orders - the single place this "Dear Sir/employee..." template
// is generated, reused by the list pages, the Party Order detail page, and
// the WhatsAppModal's Customer/Employee toggle. 'customer' mode reproduces
// the original per-order-type templates verbatim (no behavior change);
// 'employee' mode strips every price/payment figure, since a production
// employee should only ever see operational details.

export function buildCustomerOrderMessage(order: CustomerOrder, recipientType: MessageRecipientType): string {
  if (recipientType === 'employee') {
    const greetName = order.assignedEmployee?.name;
    const lines = [
      greetName ? `Dear ${greetName},` : `Dear Team,`,
      ``,
      `Please proceed with the following order:`,
      ``,
      `*ORDER DETAILS*`,
      `Order ID: ${order.orderId}`,
      order.size ? `Size: ${order.size}${order.sizeUnit ? ` ${order.sizeUnit}` : ''}` : null,
      order.colour ? `Colour: ${order.colour}` : null,
      ``,
      ...(order.items?.length
        ? order.items.map(
            (i) => `${i.productName}${i.size ? ` (${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''})` : ''} - Qty: ${i.quantity}`,
          )
        : [`Product: ${order.product}`]),
      ``,
      `*DELIVERY*`,
      `Delivery Date: ${formatDate(order.actualDeliveryDate)}`,
      order.specialInstructions ? `` : null,
      order.specialInstructions ? `Special Instructions: ${order.specialInstructions}` : null,
      ``,
      `Thank you.`,
    ].filter((l): l is string => l !== null);
    return lines.join('\n');
  }

  const lines = [
    `Dear Sir,`,
    ``,
    `Kindly check and confirm the following order details:`,
    ``,
    `*ORDER DETAILS*`,
    `Order ID: ${order.orderId}`,
    order.size ? `Size: ${order.size}${order.sizeUnit ? ` ${order.sizeUnit}` : ''}` : null,
    order.colour ? `Colour: ${order.colour}` : null,
    ``,
    ...(order.items?.length
      ? order.items.map((i) => `${i.productName} - Qty: ${i.quantity} x ₹${i.unitPrice}`)
      : [`Product: ${order.product}`]),
    order.specialInstructions ? `` : null,
    order.specialInstructions ? `Special Instructions: ${order.specialInstructions}` : null,
    ``,
    `*PAYMENT DETAILS*`,
    `Order Value: ₹${order.orderValue ?? 0}`,
    order.totalReceived ? `Advance Paid: ₹${order.totalReceived}` : null,
    `Balance Amount: ₹${order.balanceAmount ?? order.orderValue ?? 0}`,
    ``,
    `Please check all the above details carefully. Once confirmed, changes cannot be made. If everything is correct, kindly reply:`,
    ``,
    `"Confirmed – All Details OK."`,
    ``,
    `Thank you.`,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}

export function buildPartyOrderMessage(order: PartyOrder, recipientType: MessageRecipientType): string {
  if (recipientType === 'employee') {
    const greetName = order.assignedEmployee?.name;
    // No specialInstructions equivalent on PartyOrder - omit that line
    // entirely rather than print "Special Instructions: undefined".
    const lines = [
      greetName ? `Dear ${greetName},` : `Dear Team,`,
      ``,
      `Please proceed with the following order:`,
      ``,
      `*ORDER DETAILS*`,
      `Shop: ${order.shopName}`,
      ...order.items.map(
        (i) => `${i.productName}${i.finish ? ` (${i.finish})` : ''} - Qty ${i.qty}${i.size ? `, ${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''}` : ''}`,
      ),
      ``,
      `*DELIVERY*`,
      `Delivery Date: ${formatDate(order.actualDeliveryDate)}`,
      ``,
      `Thank you.`,
    ];
    return lines.join('\n');
  }

  const lines = [
    `Dear Sir,`,
    ``,
    `Kindly check and confirm the following order details:`,
    ``,
    `*ORDER DETAILS*`,
    `Shop: ${order.shopName}`,
    ...order.items.map(
      (i) => `${i.productName}${i.finish ? ` (${i.finish})` : ''} - Qty ${i.qty}${i.size ? `, ${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''}` : ''}`,
    ),
    ``,
    `*PAYMENT DETAILS*`,
    `Total Amount: ₹${order.totalAmount ?? 0}`,
    order.receivedAmount ? `Received: ₹${order.receivedAmount}` : null,
    `Balance Amount: ₹${order.balanceAmount ?? order.totalAmount ?? 0}`,
    ``,
    `Please check all the above details carefully. Once confirmed, changes cannot be made. If everything is correct, kindly reply:`,
    ``,
    `"Confirmed – All Details OK."`,
    ``,
    `Thank you.`,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}
