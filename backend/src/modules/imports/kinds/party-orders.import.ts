import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PartyOrdersService } from '../../orders/party/party-orders.service';
import { CreatePartyOrderDto } from '../../orders/party/dto/create-party-order.dto';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { blankToUndef, commitGrouped, day, gridNum, GridRow, groupTotal, HandlerPreviewRow, ImportContext, ImportHandler, matchByName, num, sheetDate, text, validOrThrow } from '../import-handler';

// Party Orders: one sheet row per product line. Lines sharing an Order Ref
// become one order; with no Order Ref column, a shop's lines on the same
// date are one order. Shops are matched by name against the Shop list -
// an unknown shop is flagged, never created.
@Injectable()
export class PartyOrdersImport implements ImportHandler {
  readonly kind = 'party-orders';
  readonly minRole = Role.ADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      ORDERREF: 'orderRef',
      REF: 'orderRef',
      ORDERNO: 'orderRef',
      ORDER: 'orderRef',
      BILLNO: 'orderRef',
      DATE: 'orderDate',
      ORDERDATE: 'orderDate',
      SHOP: 'shop',
      SHOPNAME: 'shop',
      PARTY: 'shop',
      PARTYNAME: 'shop',
      PHONE: 'phone',
      MOBILE: 'phone',
      PRODUCTNAME: 'productName',
      PRODUTCNAME: 'productName',
      PRODUCT: 'productName',
      ITEM: 'productName',
      SIZE: 'size',
      PATTERN: 'pattern',
      DETAILS: 'details',
      DETAIL: 'details',
      COLOUR: 'color',
      COLOR: 'color',
      POLISHCOLOUR: 'color',
      POLISHCOLOR: 'color',
      QTY: 'qty',
      QUANTITY: 'qty',
      NO: 'qty',
      NOS: 'qty',
      UNITPRICE: 'unitPrice',
      PRICE: 'unitPrice',
      RATE: 'unitPrice',
    },
    headerRequired: ['orderDate', 'shop', 'productName'],
    dateColumn: 'orderDate',
    label: 'ORDER REF, DATE, SHOP, PHONE, PRODUCT NAME, SIZE, PATTERN, DETAILS, COLOUR, QTY, UNIT PRICE',
  };

  constructor(
    private prisma: PrismaService,
    private orders: PartyOrdersService,
  ) {}

  rowTotal(v: GridRow) {
    return (gridNum(v.qty) ?? 1) * (gridNum(v.unitPrice) ?? 0);
  }

  groupKey(row: GridRow) {
    return (row.orderRef ?? '').trim().toUpperCase();
  }

  // An order = same shop, same day, same order total (party orders have no
  // order number of their own until they're created).
  duplicateKey(row: GridRow, all: GridRow[]) {
    if (!row.shopId || !row.orderDate) return null;
    const total = groupTotal(row, all, (r) => this.groupKey(r), (r) => this.rowTotal(r));
    return `${row.shopId}|${row.orderDate}|${total.toFixed(2)}`;
  }

  async existingKeys(rows: GridRow[]) {
    const shopIds = [...new Set(rows.map((r) => r.shopId).filter(Boolean))];
    const existing = await this.prisma.partyOrder.findMany({ where: { shopId: { in: shopIds } }, select: { shopId: true, orderDate: true, totalAmount: true } });
    return new Set(existing.map((o) => `${o.shopId}|${day(o.orderDate)}|${Number(o.totalAmount).toFixed(2)}`));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    const shops = await this.prisma.shop.findMany({ select: { id: true, name: true } });
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const shopName = text(cells, 'shop');
      const shopId = matchByName(shops, shopName, 'Shop', warnings, 'add it under Party Orders > Manage Shops, then pick it here');
      const orderDate = sheetDate(text(cells, 'orderDate'), 'Date', warnings);
      const price = num(text(cells, 'unitPrice'));
      if (price == null) warnings.push('Unit Price is missing');
      const qty = num(text(cells, 'qty'));
      return {
        line,
        warnings,
        values: {
          // No ref column: one order per shop per day - named after the
          // matched shop, so "test shop a" and "Test Shop A" are one order.
          orderRef: text(cells, 'orderRef') || `${shops.find((s) => s.id === shopId)?.name ?? shopName} ${orderDate}`.trim(),
          orderDate,
          shopId,
          phone: text(cells, 'phone'),
          productName: text(cells, 'productName'),
          size: text(cells, 'size'),
          pattern: text(cells, 'pattern'),
          details: text(cells, 'details'),
          color: text(cells, 'color'),
          qty: String(qty && qty > 0 ? Math.round(qty) : 1),
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
        const dto = await validOrThrow(CreatePartyOrderDto, {
          orderDate: head.orderDate,
          shopId: head.shopId,
          phone: blankToUndef(head.phone),
          items: lines.map((l) => ({
            productName: l.productName.trim(),
            size: blankToUndef(l.size),
            pattern: blankToUndef(l.pattern),
            details: blankToUndef(l.details),
            color: blankToUndef(l.color),
            qty: Math.round(gridNum(l.qty) ?? 1),
            unitPrice: gridNum(l.unitPrice),
          })),
        });
        await this.orders.create(dto, ctx.userId);
      },
    );
  }
}
