// Authoritative Mocktail definitions & recipe mappings reusing existing station inventory items.
// Each ingredient specifies:
//   - ingredientName: exact existing product name in `products` (no duplicate ingredient rows created)
//   - qty: quantity in the ingredient's exact inventory base unit (e.g. 2 loose x 30ml = 60ml, 1 bottle = 250ml/300ml, 1 each = 1 piece)
//   - display_qty & display_unit: human/reporting unit for consumption logs & reports
export const STATION_MOCKTAILS = [
  {
    name: 'BLUE LAGOON',
    category: 'Mocktails',
    unit: 'glass',
    selling_price: 69.37,
    description: 'Refreshing Blue Curaçao citrus mocktail',
    image: '/uploads/real-blue-lagoon.jpg',
    favourite: 1,
    ingredients: [
      { ingredientName: 'BLUE CURACAO', qty: 2, display_qty: 60, display_unit: 'ml' },
      { ingredientName: 'SOFT 250 ML', qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredientName: 'SODA 300 ML', qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredientName: 'FRESH LIME', qty: 1, display_qty: 1, display_unit: 'piece' },
    ],
  },
  {
    name: 'MINT MOJITO',
    category: 'Mocktails',
    unit: 'glass',
    selling_price: 76.39,
    description: 'Chilled classic virgin mint & lime mojito',
    image: '/uploads/real-mint-mojito.jpg',
    favourite: 1,
    ingredients: [
      { ingredientName: 'MINT SYRUP', qty: 2, display_qty: 60, display_unit: 'ml' },
      { ingredientName: 'SOFT 250 ML', qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredientName: 'SODA 300 ML', qty: 1, display_qty: 250, display_unit: 'ml' },
      { ingredientName: 'FRESH LIME', qty: 1, display_qty: 1, display_unit: 'piece' },
    ],
  },
];

// Packaged carbonated beverages (Coke & Sprite 250 ml regular + 750 ml Party Use Only)
export const STATION_PACKAGED_BEVERAGES = [
  { name: 'Coca-Cola 250 ml', category: 'Soft Drinks', sub_category: 'Soda', brand: 'Coca-Cola', size_ml: 250, unit: 'bottle', party_only: 0, purchase_price: 18, selling_price: 20, stock: 30, description: 'Chilled Coca-Cola · 250 ml Bottle', image: '/uploads/real-coca-cola-250-ml.jpg', favourite: 1 },
  { name: 'Coca-Cola 750 ml', category: 'Soft Drinks', sub_category: 'Soda', brand: 'Coca-Cola', size_ml: 750, unit: 'bottle', party_only: 1, purchase_price: 36, selling_price: 40, stock: 24, description: 'Coca-Cola · 750 ml Bottle (Party Use Only)', image: '/uploads/real-coca-cola-750-ml.jpg', favourite: 0 },
  { name: 'Sprite 250 ml', category: 'Soft Drinks', sub_category: 'Soda', brand: 'Sprite', size_ml: 250, unit: 'bottle', party_only: 0, purchase_price: 18, selling_price: 20, stock: 30, description: 'Chilled Sprite · 250 ml Bottle', image: '/uploads/real-sprite-250-ml.jpg', favourite: 1 },
  { name: 'Sprite 750 ml', category: 'Soft Drinks', sub_category: 'Soda', brand: 'Sprite', size_ml: 750, unit: 'bottle', party_only: 1, purchase_price: 36, selling_price: 40, stock: 24, description: 'Sprite · 750 ml Bottle (Party Use Only)', image: '/uploads/real-sprite-750-ml.jpg', favourite: 0 },
];

// Locally purchased on-demand Miscellaneous products (priced dynamically at Purchase Cost × (1 + margin/100))
export const STATION_LOCAL_MISC = [
  { name: 'Coconut Water', category: 'Miscellaneous', unit: 'unit', description: 'Fresh tender coconut water (locally purchased on demand)', image: '/uploads/real-coconut-water.jpg' },
  { name: 'Fresh Fruit Juices', category: 'Miscellaneous', unit: 'glass', description: 'Fresh seasonal fruit juice (locally purchased on demand)', image: '/uploads/real-fresh-fruit-juices.jpg' },
  { name: 'Sugarcane Juice', category: 'Miscellaneous', unit: 'glass', description: 'Fresh sugarcane juice (locally purchased on demand)', image: '/uploads/real-sugarcane-juice.jpg' },
];
