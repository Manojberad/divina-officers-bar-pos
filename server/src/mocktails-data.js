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
