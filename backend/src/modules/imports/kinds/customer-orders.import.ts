import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerOrdersService } from '../../orders/customer/customer-orders.service';
import { CreateCustomerOrderDto } from '../../orders/customer/dto/create-customer-order.dto';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { blankToUndef, commitGrouped, gridNum, GridRow, HandlerPreviewRow, ImportContext, ImportHandler, num, sheetDate, text, validOrThrow } from '../import-handler';

// Customer Orders: one sheet row per product line. Lines sharing an Order
// ID become one order with several products (the order's own date,
// customer, phone and address are taken from its first line).
@Injectable()
export class CustomerOrdersImport implements ImportHandler {
  readonly kind = 'customer-orders';
  readonly minRole = Role.ADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      ORDERID: 'orderId',
      ORDERNO: 'orderId',
      ORDERNUMBER: 'orderId',
      ORDER: 'orderId',
      DATE: 'orderDate',
      ORDERDATE: 'orderDate',
      CUSTOMER: 'customerName',
      CUSTOMERNAME: 'customerName',
      PHONE: 'phone',
      PHONENO: 'phone',
      MOBILE: 'phone',
      CONTACT: 'phone',
      ADDRESS: 'address',
      PRODUCTNAME: 'productName',
      PRODUTCNAME: 'productName',
      PRODUCT: 'productName',
      ITEM: 'productName',
      CATEGORY: 'category',
      TYPE: 'category',
      SIZE: 'size',
      COLOUR: 'color',
      COLOR: 'color',
      POLISHCOLOUR: 'color',
      POLISHCOLOR: 'color',
      POLISH: 'color',
      QTY: 'quantity',
      QUANTITY: 'quantity',
      NO: 'quantity',
      NOS: 'quantity',
      UNITPRICE: 'unitPrice',
      PRICE: 'unitPrice',
      RATE: 'unitPrice',
    },
    headerRequired: ['orderDate', 'customerName', 'productName'],
    dateColumn: 'orderDate',
    label: 'ORDER ID, DATE, CUSTOMER NAME, PHONE, ADDRESS, PRODUCT NAME, CATEGORY, SIZE, COLOUR, QTY, UNIT PRICE',
  };

  constructor(
    private prisma: PrismaService,
    private orders: CustomerOrdersService,
  ) {}

  rowTotal(v: GridRow) {
    return (gridNum(v.quantity) ?? 1) * (gridNum(v.unitPrice) ?? 0);
  }

  // An order is identified by its Order ID (unique in the database).
  duplicateKey(row: GridRow) {
    return row.orderId?.trim() ? row.orderId.trim().toUpperCase() : null;
  }

  groupKey(row: GridRow) {
    return row.orderId?.trim().toUpperCase() ?? '';
  }

  async existingKeys(rows: GridRow[]) {
    const ids = [...new Set(rows.map((r) => r.orderId?.trim()).filter(Boolean))];
    const found = await this.prisma.customerOrder.findMany({ where: { orderId: { in: ids } }, select: { orderId: true } });
    return new Set(found.map((o) => o.orderId.toUpperCase()));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    const firstLineOf = new Map<string, Partial<Record<string, string>>>();

    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const orderId = text(cells, 'orderId');
      if (!orderId) warnings.push('Order ID is missing - lines are grouped into orders by Order ID');
      const qty = num(text(cells, 'quantity'));
      const price = num(text(cells, 'unitPrice'));
      if (price == null) warnings.push('Unit Price is missing');

      // Lines of one order should agree on the order-level fields.
      const first = firstLineOf.get(orderId);
      if (orderId && !first) firstLineOf.set(orderId, cells);
      if (first && text(first, 'customerName') !== text(cells, 'customerName')) {
        warnings.push(`Customer differs from this order's first line ("${text(first, 'customerName')}") - the first line's is used`);
      }

      return {
        line,
        warnings,
        values: {
          orderId,
          orderDate: sheetDate(text(cells, 'orderDate'), 'Date', warnings),
          customerName: text(cells, 'customerName'),
          phone: text(cells, 'phone'),
          address: text(cells, 'address'),
          productName: text(cells, 'productName'),
          category: text(cells, 'category'),
          size: text(cells, 'size'),
          color: text(cells, 'color'),
          quantity: String(qty && qty > 0 ? Math.round(qty) : 1),
          unitPrice: price != null ? String(price) : '',
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitGrouped(
      items,
      (r) => this.groupKey(r),
      async (lines) => {
        const head = lines[0];
        const dto = await validOrThrow(CreateCustomerOrderDto, {
          orderId: head.orderId.trim(),
          orderDate: head.orderDate,
          customerName: head.customerName.trim(),
          phone: blankToUndef(head.phone),
          address: blankToUndef(head.address),
          items: lines.map((l) => ({
            productName: l.productName.trim(),
            category: blankToUndef(l.category),
            size: blankToUndef(l.size),
            color: blankToUndef(l.color),
            quantity: Math.round(gridNum(l.quantity) ?? 1),
            unitPrice: gridNum(l.unitPrice),
          })),
        });
        await this.orders.create(dto, ctx.userId);
      },
    );
  }
}
