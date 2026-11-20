// Actual Bar Alcohol Inventory (58 items) from Station Stock Register.
// Format: [serialNo, name, subCategory, cellarQty, purchaseRate, looseQty30mlOrUnits, isPeg, sizeMl, unit, description, imageFile, favourite]
// Note: For 750ml spirits & wines (isPeg=1), 1 bottle = 25 x 30ml pegs, so 30ml peg rate = round(purchaseRate / 25, 2)
// and total opening stock (ml) = cellarQty * 750 + looseQty * 30.
// For Beers (isPeg=0), total opening stock (units) = cellarQty + looseQty.
export const STATION_ALCOHOL = [
  // Whisky (25)
  [1, 'TEACHERS', 'Whisky', 7, 725.82, 66, 1, 750, 'bottle', 'Blended Scotch Whisky', 'prod-royal-oak-reserve.jpg', 1],
  [2, 'TEACHERS 50', 'Whisky', 0, 998.96, 0, 1, 750, 'bottle', 'Blended Scotch Whisky (12 YO)', 'prod-royal-oak-reserve.jpg', 0],
  [3, 'VAT 69', 'Whisky', 0, 701.03, 8, 1, 750, 'bottle', 'Blended Scotch Whisky', 'prod-royal-oak-reserve.jpg', 0],
  [4, 'SINGLE MALT GODAWAN', 'Whisky', 0, 2086.16, 19, 1, 750, 'bottle', 'Artisanal Indian Single Malt Whisky', 'prod-highland-single-malt-12y.jpg', 1],
  [5, '100 PIPER', 'Whisky', 6, 750.59, 30, 1, 750, 'bottle', 'Blended Scotch Whisky', 'prod-royal-oak-reserve.jpg', 1],
  [6, '100 PIPER 12 YEAR', 'Whisky', 0, 1030.33, 151, 1, 750, 'bottle', 'Aged 12 Years Blended Scotch', 'prod-royal-oak-reserve.jpg', 1],
  [7, 'INDRI', 'Whisky', 0, 2244.32, 19, 1, 750, 'bottle', 'Trini Single Malt Indian Whisky', 'prod-highland-single-malt-12y.jpg', 1],
  [8, 'BLACK DOG CENTEN', 'Whisky', 11, 754.30, 13, 1, 750, 'bottle', 'Black Dog Centenary Blended Scotch', 'prod-royal-oak-reserve.jpg', 1],
  [9, 'BLACK DOG (DLX)', 'Whisky', 0, 1073.91, 36, 1, 750, 'bottle', 'Black Dog Triple Gold Reserve / Deluxe', 'prod-royal-oak-reserve.jpg', 0],
  [10, 'RAMPUR SINGLE MALT', 'Whisky', 0, 4540.99, 0, 1, 750, 'bottle', 'Rampur Indian Single Malt Whisky', 'prod-highland-single-malt-12y.jpg', 0],
  [11, 'JIMBEAM', 'Whisky', 0, 776.11, 0, 1, 750, 'bottle', 'Kentucky Straight Bourbon Whiskey', 'prod-royal-oak-reserve.jpg', 0],
  [12, 'BLACK & WHITE CHOICE', 'Whisky', 3, 747.38, 73, 1, 750, 'bottle', 'Blended Scotch Whisky', 'prod-royal-oak-reserve.jpg', 1],
  [13, 'RAMPUR INDIAN ASAY', 'Whisky', 0, 5221.74, 36, 1, 750, 'bottle', 'Rampur Asava Indian Single Malt', 'prod-highland-single-malt-12y.jpg', 0],
  [14, 'PAUL JOHN BOLD', 'Whisky', 3, 1692.00, 13, 1, 750, 'bottle', 'Peated Indian Single Malt Whisky', 'prod-highland-single-malt-12y.jpg', 1],
  [15, 'AMRUT AMALGAM', 'Whisky', 6, 1370.66, 22, 1, 750, 'bottle', 'Amrut Amalgam Malt Whisky', 'prod-highland-single-malt-12y.jpg', 1],
  [16, 'AMRUT FUSION SINGLE', 'Whisky', 0, 1626.77, 25, 1, 750, 'bottle', 'Amrut Fusion Single Malt Whisky', 'prod-highland-single-malt-12y.jpg', 0],
  [17, 'RANTHAMBORE', 'Whisky', 0, 779.62, 0, 1, 750, 'bottle', 'Royal Ranthambore Heritage Whisky', 'prod-royal-oak-reserve.jpg', 0],
  [18, 'DEWARS WHITE LABLE', 'Whisky', 0, 779.22, 0, 1, 750, 'bottle', "Dewar's White Label Scotch Whisky", 'prod-royal-oak-reserve.jpg', 0],
  [19, 'BALLENTINE', 'Whisky', 0, 1015.17, 28, 1, 750, 'bottle', "Ballantine's Finest Blended Scotch", 'prod-royal-oak-reserve.jpg', 0],
  [20, 'ROYAL CHALLENGE', 'Whisky', 0, 196.25, 0, 1, 750, 'bottle', 'Indian Blended Whisky', 'prod-blenders-choice.jpg', 0],
  [21, 'ROYAL STAG', 'Whisky', 0, 302.86, 0, 1, 750, 'bottle', 'Indian Blended Whisky', 'prod-blenders-choice.jpg', 0],
  [22, 'SIGNATURE', 'Whisky', 0, 379.94, 0, 1, 750, 'bottle', 'Rare Aged Whisky', 'prod-blenders-choice.jpg', 0],
  [23, 'BLENDERS PRIDE', 'Whisky', 3, 432.96, 23, 1, 750, 'bottle', 'Rare Premium Whisky', 'prod-blenders-choice.jpg', 1],
  [24, 'PETERSCOT', 'Whisky', 0, 311.28, 4, 1, 750, 'bottle', 'Peter Scot Malt Whisky', 'prod-blenders-choice.jpg', 0],
  [25, 'ANTIQUITY BLUE', 'Whisky', 0, 435.41, 0, 1, 750, 'bottle', 'Ultra Premium Whisky', 'prod-blenders-choice.jpg', 0],

  // Rum (9)
  [26, '1965 VICTORY RUM', 'Rum', 0, 182.36, 0, 1, 750, 'bottle', '1965 Spirit of Victory Lemon/Dark Rum', 'prod-old-navy-xxx-rum.jpg', 0],
  [27, 'OLD MONK (OLD)', 'Rum', 6, 274.49, 17, 1, 750, 'bottle', 'Classic Vatted XXX Dark Rum', 'prod-old-navy-xxx-rum.jpg', 1],
  [28, 'OLD MONK (NEW)', 'Rum', 0, 172.02, 0, 1, 750, 'bottle', 'Old Monk XXX Dark Rum', 'prod-old-navy-xxx-rum.jpg', 0],
  [29, 'CONTESSA', 'Rum', 0, 165.78, 0, 1, 750, 'bottle', 'Contessa XXX Rum', 'prod-old-navy-xxx-rum.jpg', 0],
  [30, 'OLD SMUGGLER RUM', 'Rum', 0, 166.76, 0, 1, 750, 'bottle', 'Dark Rum', 'prod-old-navy-xxx-rum.jpg', 0],
  [31, 'GRENDE RUM', 'Rum', 0, 281.73, 0, 1, 750, 'bottle', 'Premium Rum', 'prod-old-navy-xxx-rum.jpg', 0],
  [32, 'BACARDI LEMON', 'Rum', 3, 278.73, 46, 1, 750, 'bottle', 'Bacardi Limon Citrus Rum', 'prod-coconut-white-rum.jpg', 1],
  [33, 'BACARDI', 'Rum', 0, 231.56, 0, 1, 750, 'bottle', 'Bacardi Carta Blanca White Rum', 'prod-coconut-white-rum.jpg', 0],
  [34, 'BACARDI BLACK', 'Rum', 0, 193.27, 0, 1, 750, 'bottle', 'Bacardi Carta Negra Dark Rum', 'prod-old-navy-xxx-rum.jpg', 0],

  // Vodka (4)
  [35, 'SMIRN OFF', 'Vodka', 0, 353.19, 23, 1, 750, 'bottle', 'Smirnoff Triple Distilled Vodka', 'prod-arctic-vodka.jpg', 0],
  [36, 'SMIRN OFF GREEN APPLE', 'Vodka', 0, 411.46, 0, 1, 750, 'bottle', 'Smirnoff Green Apple Flavoured Vodka', 'prod-citrus-vodka.jpg', 0],
  [37, 'SMOKE CLASSIC VODKA', 'Vodka', 0, 675.28, 0, 1, 750, 'bottle', 'Smoke Lab Classic Indian Vodka', 'prod-arctic-vodka.jpg', 0],
  [38, 'SMOKE ANISEED', 'Vodka', 0, 785.43, 22, 1, 750, 'bottle', 'Smoke Lab Aniseed Vodka', 'prod-arctic-vodka.jpg', 0],

  // Gin (6)
  [39, 'GIN STRANGER SONS', 'Gin', 0, 942.59, 42, 1, 750, 'bottle', 'Stranger & Sons Indian Craft Gin', 'prod-london-dry-gin.jpg', 0],
  [40, 'INVINCIBLE', 'Gin', 0, 541.42, 0, 1, 750, 'bottle', 'Craft Gin', 'prod-london-dry-gin.jpg', 0],
  [41, 'GIN BOMBAY BALNNCE DRY', 'Gin', 0, 750.86, 9, 1, 750, 'bottle', 'Bombay Dry Gin', 'prod-london-dry-gin.jpg', 0],
  [42, 'GIN AMRUT NILGIRI', 'Gin', 0, 769.44, 0, 1, 750, 'bottle', 'Amrut Nilgiris Indian Dry Gin', 'prod-london-dry-gin.jpg', 0],
  [43, 'GIN JAISALMER', 'Gin', 4, 2015.00, 107, 1, 750, 'bottle', 'Jaisalmer Indian Craft Gin', 'prod-london-dry-gin.jpg', 1],
  [44, 'GIN GREATER THAN', 'Gin', 0, 453.59, 3, 1, 750, 'bottle', 'Greater Than London Dry Gin', 'prod-london-dry-gin.jpg', 0],

  // Brandy (2)
  [45, 'BEJOISE', 'Brandy', 0, 247.26, 0, 1, 750, 'bottle', 'Bejois VSOP Brandy', 'prod-royal-oak-reserve.jpg', 0],
  [46, 'MORPHEUS', 'Brandy', 3, 481.36, 7, 1, 750, 'bottle', 'Morpheus XO Blended Premium Brandy', 'prod-royal-oak-reserve.jpg', 1],

  // Wine (5)
  [47, 'SULA BURT METHODE', 'Wine', 0, 588.15, 0, 1, 750, 'bottle', 'Sparkling Wine · Sula Brut Méthode Traditionnelle', 'prod-white-wine-chenin.jpg', 0],
  [48, 'RASA SYRAH RED WINE', 'Wine', 0, 849.46, 0, 1, 750, 'bottle', 'Red Wine · Sula Rasa Syrah', 'prod-red-wine-shiraz.jpg', 0],
  [49, 'FRATELLI SHIRAZ ROSE WINE', 'Wine', 0, 424.03, 50, 1, 750, 'bottle', 'Rosé Wine · Fratelli Shiraz Rosé', 'prod-white-wine-chenin.jpg', 0],
  [50, 'THE SOURCE GRENACHE ROSE', 'Wine', 0, 703.03, 0, 1, 750, 'bottle', 'Rosé Wine · The Source Grenache Rosé', 'prod-white-wine-chenin.jpg', 0],
  [51, 'SULA SWCO SPARKLING WINE', 'Wine', 3, 330.39, 0, 1, 750, 'bottle', 'Sparkling Wine · Sula Seco', 'prod-white-wine-chenin.jpg', 0],

  // Beer (7)
  [52, 'BEER BIRA 91 SUMMER LAGER', 'Beer', 0, 64.28, 0, 0, 650, 'bottle', 'Bira 91 Summer Lager Beer', 'prod-premium-lager-650ml.jpg', 0],
  [53, 'BEER KING FISHER LAGER', 'Beer', 0, 36.77, 0, 0, 650, 'bottle', 'Kingfisher Premium Lager Beer', 'prod-premium-lager-650ml.jpg', 0],
  [54, 'BEER BUDWISER PREMIUM', 'Beer', 0, 40.39, 1, 0, 650, 'bottle', 'Budweiser Premium Lager Beer', 'prod-premium-lager-650ml.jpg', 0],
  [55, 'BEER BUDWISER MAGNUM', 'Beer', 0, 56.97, 7, 0, 650, 'bottle', 'Budweiser Magnum Strong Beer', 'prod-premium-lager-650ml.jpg', 1],
  [56, 'BEER KING FISHER STRONG DEN', 'Beer', 0, 49.56, 0, 0, 650, 'bottle', 'Kingfisher Strong Beer', 'prod-strong-beer-500ml-can.jpg', 0],
  [57, 'BEER HUNTER SUPER STRONG', 'Beer', 0, 75.81, 0, 0, 650, 'bottle', 'Hunter Super Strong Beer', 'prod-strong-beer-500ml-can.jpg', 0],
  [58, 'BIRA WHITE CAN 500 ML', 'Beer', 0, 58.76, 0, 0, 500, 'can', 'Bira 91 White Wheat Beer Can 500 ml', 'prod-wheat-beer-330ml.jpg', 0],
];
