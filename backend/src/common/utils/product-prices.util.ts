import { Role } from '../enums/role.enum';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.CARVER, Role.POLISHER];

// Decimal fields serialize to strings by default (e.g. "9200"), which
// silently turns numeric use on the client into string concatenation
// (0 + "9200" + "24000" -> "0920024000"). Convert them to real numbers here
// so every consumer of this API gets correctly-typed data. Also strips
// pricing entirely for Carpenter/Polisher viewers - they need the catalogue
// for product identification (name, image, size), never cost/margin.
// Shared by ProductsService and ModelNoService so the Model No lookup can
// never expose prices the product list itself would hide.
export function withNumericPrices<T extends { retailPrice: any; wholesalePrice: any; costPrice: any }>(product: T, viewerRole?: Role) {
  if (viewerRole && HIDE_FINANCIALS_FOR.includes(viewerRole)) {
    const { retailPrice, wholesalePrice, costPrice, ...rest } = product as any;
    return rest;
  }
  return {
    ...product,
    retailPrice: Number(product.retailPrice),
    wholesalePrice: product.wholesalePrice != null ? Number(product.wholesalePrice) : null,
    costPrice: product.costPrice != null ? Number(product.costPrice) : null,
  };
}
