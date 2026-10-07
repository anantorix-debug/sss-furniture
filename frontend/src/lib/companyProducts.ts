// Static Product Name / Product (type) / Size / Price reference list, taken
// directly from the company's own carpenter work-list & payment sheets (the
// handwritten ledger of what's actually been made and sold) - not the live
// Products/stock table, which holds one row per individual physical piece
// (each with its own real Model No, almost always already "Sold"), making
// it a poor source for "what product names exist" suggestions.
//
// One entry per unique Product Name (its most recent size/category/price on
// the sheet wins) - the same design recurs across many dates at slightly
// different sizes/prices, and listing every variant made the dropdown look
// like duplicate entries for the same name.
//
// Used only as autocomplete suggestions on the Customer Order / Party Order
// "Product Name" field (see ProductSelector) - picking one fills in Product
// Name, Category/Product and Size/Unit Price where the target form has that
// field. It never sets a Model No or links to a real stock piece; Model No
// stays exactly as today - unassigned until Production enters it, or
// picked separately via the existing Catalog Model No. search.
//
// Hand-maintained: add a new row here whenever a genuinely new design is
// introduced, the same way a new row is added to the paper ledger.
export interface CompanyProductEntry {
  name: string;
  category: string;
  size?: string;
  price: number;
}

export const COMPANY_PRODUCTS: CompanyProductEntry[] = [
  { name: 'HEARTEN', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'NEW-DOLLAR', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'HEAM-ROSLI', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'JALLY CARVING', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: 'MOOGKIL', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'ROUTER CUSHION', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: 'RAM-LOTTAN', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: 'ROUTER-PLAIN', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: 'CHAKKURA', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'HEAM-ROUND', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'S-BEND', category: 'BOTTOM COT', size: '4FT', price: 1250 },
  { name: 'SIDE-FLOWER', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: 'KUNJA', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'DOLLAR', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'R-MODEL', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'RIBBON-CNC', category: 'HEAD BOX', size: '5FT', price: 1800 },
  { name: 'NEW-ROUTER', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: '7-LEAF CARVING', category: 'BOTTOM COT + DRAW', size: '6FT', price: 1800 },
  { name: 'ROUTER', category: 'BOTTOM COT + DRAW', size: '6FT', price: 1800 },
  { name: 'FULL MAIL', category: 'BOTTOM COT', size: '6FT', price: 1800 },
  { name: 'LEAF-CARVING', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'PILLER-CARVING', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'V-CARVING', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'NEW-HEAM ROSLI', category: 'BOTTOM COT', size: '5FT', price: 1600 },
  { name: 'LIPSTICK', category: 'BOTTOM COT + DRAW', size: '6FT', price: 1800 },
  { name: 'DINING SET', category: 'FRAME & TOP - 4C', size: '4x4', price: 1800 },
  { name: 'HEMBU SET', category: 'FRAME-4C', size: '5x3', price: 1800 },
  { name: 'DINING', category: 'FRAME & TOP', size: '48"x33"', price: 500 },
  { name: 'BEND-CUSHION', category: 'BOTTOM - REWORK', size: '5FT', price: 500 },
  { name: 'DIWAN', category: 'BOTTOM + DRAW', size: '78"x36"', price: 1000 },
  { name: 'STOLL', category: 'PLAIN', size: '2\'x15"', price: 300 },
  { name: 'LAMP BOX', category: 'MDF', size: '18"x18"', price: 300 },
  { name: 'L-CORNER SOFA', category: '2+2+DIWAN', size: '36"x27"', price: 4000 },
  { name: 'TEPAI', category: 'DESIGN - MODEL', size: '3\'x18"', price: 300 },
  { name: 'OST-PALIN', category: '2+2+DIWAN', size: '30"x27"', price: 4000 },
  { name: 'FRAME & TOP', category: 'FINGER JOINT', size: '4x3', price: 1800 },
  { name: 'PLAIN MODEL', category: '3 SEATER', price: 1800 },
  { name: 'SIDE BAR', category: 'RE-WORK', price: 500 },
  { name: 'SQURE DINING', category: 'FRAME & TOP', size: '4x3', price: 500 },
  { name: 'OVAL DINING', category: 'FRAME & TOP', size: '5x3', price: 600 },
];
