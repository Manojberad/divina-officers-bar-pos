// Actual Bar Sundries Stock (54 items) – Officers' Mess Makarpura, Vadodara.
// Format: [serialNo, category, subCategory, foodType, name, unit, qty, purchaseRate, description, imageFile, favourite]
export const STATION_SUNDRIES = [
  // Soft Drinks (24 items – Soft drinks, Juices, Syrups & mixers, Fresh lime, Ice; no sub-category)
  [2, 'Soft Drinks', null, null, 'SODA 750 ML', 'bottle', 95, 15.00, 'Soft drinks · 750 ml Bottle', 'prod-soda-750ml.jpg', 1],
  [3, 'Soft Drinks', null, null, 'SODA 300 ML', 'bottle', 56, 9.15, 'Soft drinks · 300 ml Bottle', 'prod-soda-750ml.jpg', 1],
  [4, 'Soft Drinks', null, null, 'SOFT 250 ML', 'bottle', 57, 18.00, 'Soft drinks · 250 ml Bottle', 'prod-cola-300ml.jpg', 1],
  [5, 'Soft Drinks', null, null, 'SOFT 750 ML', 'bottle', 169, 36.00, 'Soft drinks · 750 ml Bottle', 'prod-cola-300ml.jpg', 1],
  [6, 'Soft Drinks', null, null, 'SOFT 1.25 LTR', 'bottle', 11, 43.00, 'Soft drinks · 1.25 Ltr Bottle', 'prod-cola-300ml.jpg', 0],
  [7, 'Soft Drinks', null, null, 'APPY FIZZ', 'pkt', 0, 20.00, 'Soft drinks · Appy Fizz', 'prod-cola-300ml.jpg', 0],

  [8, 'Soft Drinks', null, null, 'REAL JUICE GUAVA/LITCHI/MIX FRUIT 200 ML', 'pkt', 17, 20.00, 'Juices · 200 ml Pack', 'prod-tonic-water.jpg', 0],
  [9, 'Soft Drinks', null, null, 'REAL JUICE GRAPE 01 LTR', 'pkt', 0, 122.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [10, 'Soft Drinks', null, null, 'REAL JUICE PINEAPPLE 01 LTR', 'pkt', 6, 125.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [11, 'Soft Drinks', null, null, 'REAL JUICE ORANGE 01 LTR', 'pkt', 2, 115.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [12, 'Soft Drinks', null, null, 'REAL JUICE GUAVA 01 LTR', 'pkt', 4, 105.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [13, 'Soft Drinks', null, null, 'REAL JUICE MIX FRUIT 01 LTR', 'pkt', 2, 115.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [14, 'Soft Drinks', null, null, 'REAL JUICE LITCHI 01 LTR', 'pkt', 0, 110.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [15, 'Soft Drinks', null, null, 'REAL JUICE APPLE 01 LTR', 'pkt', 0, 105.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [16, 'Soft Drinks', null, null, 'REAL JUICE CRENBERRY 01 LTR', 'pkt', 5, 130.00, 'Juices · Cranberry 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [17, 'Soft Drinks', null, null, 'REAL JUICE POMEGRANATE 01 LTR', 'pkt', 0, 118.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],
  [18, 'Soft Drinks', null, null, 'REAL JUICE JAMUN 01 LTR', 'pkt', 0, 142.00, 'Juices · 1 Ltr Pack', 'prod-tonic-water.jpg', 0],

  [19, 'Soft Drinks', null, null, 'BLUE CURACAO', 'loose', 42, 11.20, 'Syrups & mixers · Loose', 'prod-tonic-water.jpg', 0],
  [20, 'Soft Drinks', null, null, 'GRENADINE SYRUP', 'loose', 3, 30.38, 'Syrups & mixers · Loose', 'prod-tonic-water.jpg', 0],
  [21, 'Soft Drinks', null, null, 'MINT SYRUP', 'loose', 63, 11.96, 'Syrups & mixers · Loose', 'prod-tonic-water.jpg', 0],
  [22, 'Soft Drinks', null, null, 'KOKAM SYRUP', 'loose', 0, 6.40, 'Syrups & mixers · Loose', 'prod-tonic-water.jpg', 0],
  [23, 'Soft Drinks', null, null, 'TONIC WATER', 'bottle', 20, 60.00, 'Syrups & mixers · Bottle', 'prod-tonic-water.jpg', 1],

  [34, 'Soft Drinks', null, null, 'FRESH LIME', 'each', 20, 15.50, 'Fresh items · Lime', 'prod-mineral-water-1l.jpg', 1],
  [35, 'Soft Drinks', null, null, 'ICE CUBE', 'pkt', 4, 30.00, 'Ice · Cube Pack', 'prod-mineral-water-1l.jpg', 1],

  // Food -> Packed (12 items – Packaged snacks, Cigarettes, Disposables)
  [1, 'Food', 'Packed', null, 'SNACKS 60 GM', 'pkt', 117, 10.00, 'Snacks · 60 gm Pack', 'prod-roasted-peanuts.jpg', 1],
  [24, 'Food', 'Packed', null, 'CLASSIC MILD CONNECT', 'pkt', 6, 410.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [25, 'Food', 'Packed', null, 'CLASSIC MILD DOUBLE BURST', 'pkt', 12, 455.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [26, 'Food', 'Packed', null, 'CLASSIC MILD', 'pkt', 0, 230.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [27, 'Food', 'Packed', null, 'CLASSIC ULTRA MILD', 'pkt', 7, 455.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [28, 'Food', 'Packed', null, 'GOLD FLAKE KING', 'pkt', 5, 230.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [29, 'Food', 'Packed', null, 'GOLD FLAKE LIGHT (BIG)', 'pkt', 15, 455.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [30, 'Food', 'Packed', null, 'GOLD FLAKE LIGHT (SMALL)', 'pkt', 6, 230.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [31, 'Food', 'Packed', null, 'GOLD FLAKE SMALL', 'pkt', 0, 90.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [32, 'Food', 'Packed', null, 'WILLS', 'pkt', 23, 124.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [33, 'Food', 'Packed', null, 'DANIL', 'pkt', 0, 320.00, 'Cigarettes · Pack', 'prod-roasted-peanuts.jpg', 0],
  [54, 'Food', 'Packed', null, 'DISPOSAL GLASS', 'pkt', 0, 166.67, 'Disposables · Pack', 'prod-mineral-water-1l.jpg', 0],

  // Food -> Veg (8 items)
  [36, 'Food', 'Veg', 'veg', 'SMILEY', 'pkt', 0, 112.50, 'Veg Snack · Smiley', 'prod-french-fries.jpg', 0],
  [37, 'Food', 'Veg', 'veg', 'FRENCH FRY', 'pkt', 0, 102.44, 'Veg Snack · French Fries', 'prod-french-fries.jpg', 0],
  [38, 'Food', 'Veg', 'veg', 'POTATO BITES', 'pkt', 0, 204.16, 'Veg Snack · Potato Bites', 'prod-french-fries.jpg', 0],
  [39, 'Food', 'Veg', 'veg', 'VEGGI CHEESE CORN NUGGETS', 'pkt', 0, 208.33, 'Veg Snack · Cheese Corn Nuggets', 'prod-french-fries.jpg', 0],
  [43, 'Food', 'Veg', 'veg', 'VEGGI MASALA NUGGETS', 'pkt', 0, 145.83, 'Veg Snack · Masala Nuggets', 'prod-french-fries.jpg', 0],
  [44, 'Food', 'Veg', 'veg', 'VEGGI PANEER POPS', 'pkt', 0, 245.83, 'Veg Snack · Paneer Pops', 'prod-french-fries.jpg', 0],
  [45, 'Food', 'Veg', 'veg', 'VEGGI FINGER', 'pkt', 0, 116.67, 'Veg Snack · Veg Finger', 'prod-french-fries.jpg', 0],
  [53, 'Food', 'Veg', 'veg', 'PIZZA POCKET', 'pkt', 0, 258.19, 'Veg Snack · Pizza Pocket', 'prod-french-fries.jpg', 0],

  // Food -> Non-Veg (10 items)
  [40, 'Food', 'Non-Veg', 'nonveg', 'CHICKEN GARLIC FINGER', 'pkt', 0, 225.40, 'Non-Veg · Chicken Garlic Finger', 'prod-chicken-tikka.jpg', 0],
  [41, 'Food', 'Non-Veg', 'nonveg', 'FISH FINGER', 'pkt', 0, 196.00, 'Non-Veg · Fish Finger', 'prod-chicken-tikka.jpg', 0],
  [42, 'Food', 'Non-Veg', 'nonveg', 'SEEK KABAB', 'pkt', 0, 225.40, 'Non-Veg · Seekh Kabab', 'prod-chicken-tikka.jpg', 0],
  [46, 'Food', 'Non-Veg', 'nonveg', 'CHILLY/PEPER HERBER SAUSAGES', 'pkt', 0, 158.35, 'Non-Veg · Chilli/Pepper Herb Sausages', 'prod-chicken-tikka.jpg', 0],
  [47, 'Food', 'Non-Veg', 'nonveg', 'CHILLY/PEPER HERBER SALAMI', 'pkt', 0, 158.35, 'Non-Veg · Chilli/Pepper Herb Salami', 'prod-chicken-tikka.jpg', 0],
  [48, 'Food', 'Non-Veg', 'nonveg', 'PANJABI TIKKA', 'pkt', 0, 158.35, 'Non-Veg · Punjabi Tikka', 'prod-chicken-tikka.jpg', 0],
  [49, 'Food', 'Non-Veg', 'nonveg', 'HARIYALI KABAB', 'pkt', 0, 266.39, 'Non-Veg · Hariyali Kabab', 'prod-chicken-tikka.jpg', 0],
  [50, 'Food', 'Non-Veg', 'nonveg', 'CHICKEN CRISPY FRY', 'pkt', 0, 309.92, 'Non-Veg · Chicken Crispy Fry', 'prod-chicken-tikka.jpg', 0],
  [51, 'Food', 'Non-Veg', 'nonveg', 'CHICKEN NUGGETS', 'pkt', 0, 325.00, 'Non-Veg · Chicken Nuggets', 'prod-chicken-tikka.jpg', 0],
  [52, 'Food', 'Non-Veg', 'nonveg', 'LAKHNAWI KABAB', 'pkt', 0, 161.48, 'Non-Veg · Lakhnawi Kabab', 'prod-chicken-tikka.jpg', 0],
];
