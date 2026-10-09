import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../../inventory/products/products.service';
import { CreateProductDto } from '../../inventory/products/dto/create-product.dto';
import { RawMaterialsService } from '../../inventory/raw-materials/raw-materials.service';
import { CreateRawMaterialDto } from '../../inventory/raw-materials/dto/create-raw-material.dto';
import { Role } from '../../../common/enums/role.enum';
import { TableSpec } from '../../../common/import/sheet-reader';
import { blankToUndef, commitEach, gridNum, GridRow, HandlerPreviewRow, ImportContext, ImportHandler, normName, num, text, validOrThrow } from '../import-handler';

// Inventory > Products: one row = one physical stock piece (the app's rule -
// every product row is quantity 1 with its own Model No), saved through
// ProductsService.create so the "Added to stock" movement is written too.
@Injectable()
export class ProductsImport implements ImportHandler {
  readonly kind = 'products';
  readonly minRole = Role.ADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      NAME: 'name',
      PRODUCTNAME: 'name',
      PRODUTCNAME: 'name',
      PRODUCT: 'name',
      MODELNO: 'modelNo',
      MODEL: 'modelNo',
      SKU: 'sku',
      CATEGORY: 'category',
      TYPE: 'category',
      SIZE: 'modelSize',
      MODELSIZE: 'modelSize',
      FINISH: 'materialFinish',
      MATERIALFINISH: 'materialFinish',
      MATERIAL: 'materialFinish',
      COLOUR: 'materialFinish',
      POLISHCOLOUR: 'materialFinish',
      PATTERN: 'pattern',
      DETAILS: 'details',
      UNIT: 'unit',
      PRICE: 'retailPrice',
      RETAILPRICE: 'retailPrice',
      UNITPRICE: 'retailPrice',
      MRP: 'retailPrice',
      RATE: 'retailPrice',
      WHOLESALE: 'wholesalePrice',
      WHOLESALEPRICE: 'wholesalePrice',
      COST: 'costPrice',
      COSTPRICE: 'costPrice',
    },
    headerRequired: ['name', 'retailPrice'],
    dateColumn: 'name', // stock sheets have no date - any row with a name is a row
    label: 'NAME, MODEL NO, SKU, CATEGORY, SIZE, FINISH, PATTERN, DETAILS, UNIT, PRICE, WHOLESALE, COST',
  };

  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
  ) {}

  rowTotal(v: GridRow) {
    return gridNum(v.retailPrice) ?? 0;
  }

  // A stock piece is identified by its Model No, else its SKU (both unique).
  // Without either, two identical rows are genuinely two pieces.
  duplicateKey(row: GridRow) {
    if (normName(row.modelNo)) return `M:${normName(row.modelNo)}`;
    if (normName(row.sku)) return `S:${normName(row.sku)}`;
    return null;
  }

  async existingKeys() {
    const existing = await this.prisma.product.findMany({ where: { OR: [{ modelNo: { not: null } }, { sku: { not: null } }] }, select: { modelNo: true, sku: true } });
    const keys = new Set<string>();
    for (const p of existing) {
      if (p.modelNo) keys.add(`M:${normName(p.modelNo)}`);
      if (p.sku) keys.add(`S:${normName(p.sku)}`);
    }
    return keys;
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      const price = num(text(cells, 'retailPrice'));
      if (price == null) warnings.push('Price is missing');
      const opt = (k: string) => {
        const n = num(text(cells, k));
        return n != null ? String(n) : '';
      };
      return {
        line,
        warnings,
        values: {
          name: text(cells, 'name'),
          modelNo: text(cells, 'modelNo'),
          sku: text(cells, 'sku'),
          category: text(cells, 'category'),
          modelSize: text(cells, 'modelSize'),
          materialFinish: text(cells, 'materialFinish'),
          pattern: text(cells, 'pattern'),
          details: text(cells, 'details'),
          unit: text(cells, 'unit'),
          retailPrice: price != null ? String(price) : '',
          wholesalePrice: opt('wholesalePrice'),
          costPrice: opt('costPrice'),
        },
      };
    });
  }

  commit(items: GridRow[], ctx: ImportContext) {
    return commitEach(items, async (r) => {
      const dto = await validOrThrow(CreateProductDto, {
        name: r.name.trim(),
        modelNo: blankToUndef(r.modelNo),
        sku: blankToUndef(r.sku),
        category: blankToUndef(r.category),
        modelSize: blankToUndef(r.modelSize),
        materialFinish: blankToUndef(r.materialFinish),
        pattern: blankToUndef(r.pattern),
        details: blankToUndef(r.details),
        unit: blankToUndef(r.unit),
        retailPrice: gridNum(r.retailPrice),
        wholesalePrice: gridNum(r.wholesalePrice),
        costPrice: gridNum(r.costPrice),
      });
      await this.products.create(dto, ctx.userId);
    });
  }
}

// Free-text group/measurement ("Board feet", "cft", "Litre") -> the enums.
function groupOf(raw: string): string | null {
  const t = normName(raw);
  if (!t) return 'WOOD';
  if (t.startsWith('WOOD') || t === 'TIMBER') return 'WOOD';
  if (t.startsWith('CARV')) return 'CARVING';
  if (t.startsWith('POLISH') || t === 'PAINT') return 'POLISH';
  if (t === 'OTHER' || t === 'OTHERS') return 'OTHER';
  return null;
}
function measureOf(raw: string): string | null {
  const t = normName(raw);
  if (!t) return 'OTHER';
  if (t === 'BOARDFEET' || t === 'BF' || t === 'CFT' || t === 'BOARDFOOT') return 'BOARD_FEET';
  if (t.startsWith('SHEET')) return 'SHEET';
  if (t === 'LIQUID' || t.startsWith('LIT') || t === 'L' || t === 'ML') return 'LIQUID';
  if (t === 'COUNT' || t === 'NOS' || t === 'PCS' || t === 'PIECES') return 'COUNT';
  if (t === 'OTHER') return 'OTHER';
  return null;
}

// Same unit rules as RawMaterialsService.resolveUnit, applied up front so
// the preview shows the unit that will actually be saved: board feet /
// sheet / count have a fixed unit, liquids take Litre / Kg / Gram (common
// abbreviations accepted), anything else needs a unit.
function unitFor(measure: string, raw: string, warnings: string[]): string {
  const FIXED: Record<string, string> = { BOARD_FEET: 'CFT', SHEET: 'Sheet', COUNT: 'Nos' };
  if (FIXED[measure]) return FIXED[measure];
  const t = normName(raw);
  if (measure === 'LIQUID') {
    if (['L', 'LT', 'LTR', 'LTRS', 'LITRE', 'LITRES', 'LITER', 'LITERS'].includes(t)) return 'Litre';
    if (['KG', 'KGS', 'KILO', 'KILOS', 'KILOGRAM', 'KILOGRAMS'].includes(t)) return 'Kg';
    if (['G', 'GM', 'GMS', 'GRAM', 'GRAMS'].includes(t)) return 'Gram';
    if (!t) {
      warnings.push('Unit not given - set to Litre');
      return 'Litre';
    }
    warnings.push(`Unit "${raw}" isn't allowed for a liquid - use Litre, Kg or Gram`);
    return raw;
  }
  if (!t) warnings.push('Unit is required');
  return raw;
}

// Inventory > Raw Materials: the material list only (name, group, how it's
// measured, unit, reorder level). Opening stock still goes through Stock In,
// so every stock change keeps its own movement record.
@Injectable()
export class RawMaterialsImport implements ImportHandler {
  readonly kind = 'raw-materials';
  readonly minRole = Role.ADMIN as const;
  readonly spec: TableSpec<string> = {
    aliases: {
      NAME: 'name',
      MATERIAL: 'name',
      MATERIALNAME: 'name',
      ITEM: 'name',
      GROUP: 'materialGroup',
      MATERIALGROUP: 'materialGroup',
      CATEGORY: 'materialGroup',
      MEASUREMENT: 'measurementKind',
      MEASUREMENTKIND: 'measurementKind',
      MEASUREDIN: 'measurementKind',
      KIND: 'measurementKind',
      UNIT: 'unit',
      UOM: 'unit',
      REORDERLEVEL: 'reorderLevel',
      REORDER: 'reorderLevel',
      MINSTOCK: 'reorderLevel',
    },
    headerRequired: ['name'],
    dateColumn: 'name',
    label: 'NAME, GROUP, MEASUREMENT, UNIT, REORDER LEVEL',
  };

  constructor(
    private prisma: PrismaService,
    private materials: RawMaterialsService,
  ) {}

  rowTotal() {
    return 0;
  }

  // A material is identified by its name.
  duplicateKey(row: GridRow) {
    return normName(row.name) || null;
  }

  async existingKeys() {
    return new Set((await this.prisma.rawMaterial.findMany({ select: { name: true } })).map((m) => normName(m.name)));
  }

  async preview(rows: { line: number; cells: Partial<Record<string, string>> }[]): Promise<HandlerPreviewRow[]> {
    return rows.map(({ line, cells }) => {
      const warnings: string[] = [];
      let group = groupOf(text(cells, 'materialGroup'));
      if (!group) {
        warnings.push(`Group "${text(cells, 'materialGroup')}" not recognised - set to Other`);
        group = 'OTHER';
      }
      let measure = measureOf(text(cells, 'measurementKind'));
      if (!measure) {
        warnings.push(`Measurement "${text(cells, 'measurementKind')}" not recognised - set to Other`);
        measure = 'OTHER';
      }
      const reorder = num(text(cells, 'reorderLevel'));
      const unit = unitFor(measure, text(cells, 'unit'), warnings);
      return {
        line,
        warnings,
        values: { name: text(cells, 'name'), materialGroup: group, measurementKind: measure, unit, reorderLevel: reorder != null ? String(reorder) : '' },
      };
    });
  }

  commit(items: GridRow[]) {
    return commitEach(items, async (r) => {
      const dto = await validOrThrow(CreateRawMaterialDto, {
        name: r.name.trim(),
        materialGroup: r.materialGroup || undefined,
        measurementKind: r.measurementKind || undefined,
        unit: blankToUndef(r.unit),
        reorderLevel: gridNum(r.reorderLevel),
      });
      await this.materials.create(dto);
    });
  }
}
