// Fetches crisp 400x300 real product photos for all 112 station products,
// stores them locally in server/assets/products/ and server/data/uploads/ for 100% offline use,
// and updates products.image in server/data/bar.db.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, db, UPLOAD_DIR } from './db.js';

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/products');
fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Hand-tuned accurate product image queries for every station product
const QUERY_MAP = {
  // Whisky
  'TEACHERS': 'Teachers Highland Cream scotch whisky bottle 750ml',
  'TEACHERS 50': 'Teachers 50 12 year scotch whisky bottle',
  'VAT 69': 'VAT 69 blended scotch whisky bottle',
  'SINGLE MALT GODAWAN': 'Godawan artisanal Indian single malt whisky bottle',
  '100 PIPER': '100 Pipers blended scotch whisky bottle',
  '100 PIPER 12 YEAR': '100 Pipers 12 years scotch whisky bottle',
  'INDRI': 'Indri Trini single malt Indian whisky bottle',
  'BLACK DOG CENTEN': 'Black Dog Centenary scotch whisky bottle',
  'BLACK DOG (DLX)': 'Black Dog Triple Gold Reserve scotch whisky bottle',
  'RAMPUR SINGLE MALT': 'Rampur Indian single malt whisky bottle',
  'JIMBEAM': 'Jim Beam bourbon whiskey bottle',
  'BLACK & WHITE CHOICE': 'Black and White blended scotch whisky bottle',
  'RAMPUR INDIAN ASAY': 'Rampur Asava Indian single malt whisky bottle',
  'PAUL JOHN BOLD': 'Paul John Bold Indian single malt whisky bottle',
  'AMRUT AMALGAM': 'Amrut Amalgam malt whisky bottle',
  'AMRUT FUSION SINGLE': 'Amrut Fusion single malt Indian whisky bottle',
  'RANTHAMBORE': 'Royal Ranthambore heritage whisky bottle',
  'DEWARS WHITE LABLE': 'Dewars White Label blended scotch whisky bottle',
  'BALLENTINE': 'Ballantines Finest blended scotch whisky bottle',
  'ROYAL CHALLENGE': 'Royal Challenge whisky bottle India',
  'ROYAL STAG': 'Royal Stag whisky bottle India',
  'SIGNATURE': 'Signature Rare Aged whisky green bottle India',
  'BLENDERS PRIDE': 'Blenders Pride rare premium whisky bottle',
  'PETERSCOT': 'Peter Scot malt whisky bottle India',
  'ANTIQUITY BLUE': 'Antiquity Blue whisky bottle India',

  // Rum
  '1965 VICTORY RUM': '1965 Spirit of Victory rum bottle India',
  'OLD MONK (OLD)': 'Old Monk XXX dark rum bottle',
  'OLD MONK (NEW)': 'Old Monk Supreme dark rum bottle',
  'CONTESSA': 'Contessa XXX dark rum bottle India',
  'OLD SMUGGLER RUM': 'Old Smuggler rum bottle',
  'GRENDE RUM': 'Dark rum bottle glass bar',
  'BACARDI LEMON': 'Bacardi Limon lemon rum bottle',
  'BACARDI': 'Bacardi Carta Blanca white rum bottle',
  'BACARDI BLACK': 'Bacardi Carta Negra black rum bottle',

  // Vodka
  'SMIRN OFF': 'Smirnoff No 21 red vodka bottle',
  'SMIRN OFF GREEN APPLE': 'Smirnoff Green Apple vodka bottle',
  'SMOKE CLASSIC VODKA': 'Smoke Lab Classic Indian vodka bottle',
  'SMOKE ANISEED': 'Smoke Lab Aniseed vodka bottle',

  // Gin
  'GIN STRANGER SONS': 'Stranger and Sons Indian gin bottle',
  'INVINCIBLE': 'Craft dry gin bottle clear glass',
  'GIN BOMBAY BALNNCE DRY': 'Bombay Dry London gin bottle',
  'GIN AMRUT NILGIRI': 'Nilgiris Indian Dry Gin Amrut bottle',
  'GIN JAISALMER': 'Jaisalmer Indian craft gin bottle',
  'GIN GREATER THAN': 'Greater Than London Dry Gin bottle India',

  // Brandy
  'BEJOISE': 'Bejois VSOP brandy bottle India',
  'MORPHEUS': 'Morpheus XO blended premium brandy bottle',

  // Wine
  'SULA BURT METHODE': 'Sula Brut sparkling wine bottle',
  'RASA SYRAH RED WINE': 'Sula Rasa Syrah red wine bottle',
  'FRATELLI SHIRAZ ROSE WINE': 'Fratelli Shiraz Rose wine bottle',
  'THE SOURCE GRENACHE ROSE': 'The Source Grenache Rose wine Sula bottle',
  'SULA SWCO SPARKLING WINE': 'Sula Seco sparkling wine bottle',

  // Beer
  'BEER BIRA 91 SUMMER LAGER': 'Bira 91 Blonde Summer Lager beer bottle',
  'BEER KING FISHER LAGER': 'Kingfisher Premium lager beer bottle',
  'BEER BUDWISER PREMIUM': 'Budweiser Premium beer bottle',
  'BEER BUDWISER MAGNUM': 'Budweiser Magnum strong beer bottle',
  'BEER KING FISHER STRONG DEN': 'Kingfisher Strong beer bottle',
  'BEER HUNTER SUPER STRONG': 'Hunter Super Strong beer bottle India',
  'BIRA WHITE CAN 500 ML': 'Bira 91 White wheat beer 500ml can',

  // Soft Drinks -> Soda
  'SODA 750 ML': 'Kinley club soda 750ml bottle',
  'SODA 300 ML': 'Bisleri club soda 300ml bottle',
  'SOFT 250 ML': 'Coca Cola 250ml bottle India',
  'SOFT 750 ML': 'Thums Up Sprite 750ml bottle India',
  'SOFT 1.25 LTR': 'Coca Cola 1.25 litre bottle',
  'BLUE CURACAO': 'Monin Blue Curacao syrup bottle',
  'GRENADINE SYRUP': 'Monin Grenadine syrup bottle',
  'MINT SYRUP': 'Monin Green Mint mojito syrup bottle',
  'KOKAM SYRUP': 'Kokum sharbat syrup bottle India',
  'TONIC WATER': 'Schweppes Indian tonic water bottle',

  // Soft Drinks -> Juices
  'APPY FIZZ': 'Appy Fizz sparkling apple drink bottle',
  'REAL JUICE GUAVA/LITCHI/MIX FRUIT 200 ML': 'Dabur Real Fruit Power 200ml juice tetra pack',
  'REAL JUICE GRAPE 01 LTR': 'Dabur Real Fruit Power Grape juice 1 litre pack',
  'REAL JUICE PINEAPPLE 01 LTR': 'Dabur Real Fruit Power Pineapple juice 1 litre pack',
  'REAL JUICE ORANGE 01 LTR': 'Dabur Real Fruit Power Orange juice 1 litre pack',
  'REAL JUICE GUAVA 01 LTR': 'Dabur Real Fruit Power Guava juice 1 litre pack',
  'REAL JUICE MIX FRUIT 01 LTR': 'Dabur Real Fruit Power Mixed Fruit juice 1 litre pack',
  'REAL JUICE LITCHI 01 LTR': 'Dabur Real Fruit Power Litchi juice 1 litre pack',
  'REAL JUICE APPLE 01 LTR': 'Dabur Real Fruit Power Apple juice 1 litre pack',
  'REAL JUICE CRENBERRY 01 LTR': 'Dabur Real Fruit Power Cranberry juice 1 litre pack',
  'REAL JUICE POMEGRANATE 01 LTR': 'Dabur Real Fruit Power Pomegranate juice 1 litre pack',
  'REAL JUICE JAMUN 01 LTR': 'Dabur Real Fruit Power Jamun juice 1 litre pack',

  // Cigarettes
  'CLASSIC MILD CONNECT': 'ITC Classic Connect cigarettes pack',
  'CLASSIC MILD DOUBLE BURST': 'ITC Classic Double Burst cigarettes pack',
  'CLASSIC MILD': 'ITC Classic Mild cigarettes pack India',
  'CLASSIC ULTRA MILD': 'ITC Classic Ultra Mild cigarettes pack',
  'GOLD FLAKE KING': 'Gold Flake Kings cigarettes pack India',
  'GOLD FLAKE LIGHT (BIG)': 'Gold Flake Kings Lights cigarettes pack',
  'GOLD FLAKE LIGHT (SMALL)': 'Gold Flake Lights cigarettes pack India',
  'GOLD FLAKE SMALL': 'Gold Flake Honeydew Smooth cigarettes pack',
  'WILLS': 'Wills Navy Cut cigarettes pack India',
  'DANIL': 'Dunhill Switch cigarettes pack',

  // Misc
  'DISPOSAL GLASS': 'disposable plastic drinking cups stack',
  'FRESH LIME': 'fresh green limes slices bar garnish',
  'ICE CUBE': 'crystal clear ice cubes bucket bar',

  // Food -> Packed
  'SNACKS 60 GM': 'Haldiram salted peanuts bhujia namkeen snack pack',

  // Food -> Veg
  'SMILEY': 'McCain potato smiles crispy snack plate',
  'FRENCH FRY': 'crispy golden french fries plate',
  'POTATO BITES': 'McCain chilli garlic potato bites crispy snack',
  'VEGGI CHEESE CORN NUGGETS': 'crispy cheese corn nuggets snack plate',
  'VEGGI MASALA NUGGETS': 'crispy veg masala nuggets snack plate',
  'VEGGI PANEER POPS': 'crispy paneer popcorn bites snack plate',
  'VEGGI FINGER': 'crispy vegetable fingers snack plate',
  'PIZZA POCKET': 'McCain pizza pockets crispy snack',

  // Food -> Non-Veg
  'CHICKEN GARLIC FINGER': 'crispy chicken garlic fingers snack plate',
  'FISH FINGER': 'crispy golden fish fingers tartar sauce plate',
  'SEEK KABAB': 'chicken seekh kabab mint chutney plate',
  'CHILLY/PEPER HERBER SAUSAGES': 'pan fried pepper herb chicken sausages plate',
  'CHILLY/PEPER HERBER SALAMI': 'sliced pepper herb chicken salami platter',
  'PANJABI TIKKA': 'punjabi chicken tikka tandoori plate',
  'HARIYALI KABAB': 'hariyali chicken kabab restaurant dish cooked',
  'CHICKEN CRISPY FRY': 'crispy fried chicken strips snack plate',
  'CHICKEN NUGGETS': 'golden crispy chicken nuggets plate',
  'LAKHNAWI KABAB': 'lucknowi galouti chicken kabab plate',
};

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const products = q.all('SELECT id, name, image FROM products ORDER BY id');
let ok = 0, fail = 0;

async function fetchOne(p) {
  const query = QUERY_MAP[p.name] || `${p.name} product bottle pack`;
  const slug = `real-${slugify(p.name)}.jpg`;
  const assetPath = path.join(ASSETS_DIR, slug);
  const uploadPath = path.join(UPLOAD_DIR, slug);

  // Skip re-downloading if already cached and valid (>2KB)
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).size > 2000) {
    fs.copyFileSync(assetPath, uploadPath);
    q.run('UPDATE products SET image=? WHERE id=?', `/uploads/${slug}`, p.id);
    ok++;
    return;
  }

  const url = `https://tse1.mm.bing.net/th?q=${encodeURIComponent(query)}&w=400&h=300&c=7&rs=1&p=0`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) throw new Error(`Not image: ${ct}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1500) throw new Error(`Too small (${buf.length}B)`);
    fs.writeFileSync(assetPath, buf);
    fs.writeFileSync(uploadPath, buf);
    q.run('UPDATE products SET image=? WHERE id=?', `/uploads/${slug}`, p.id);
    ok++;
  } catch (e) {
    console.warn(`[WARN] Failed ${p.name}: ${e.message}`);
    fail++;
  }
}

// Run in polite parallel batches of 8
for (let i = 0; i < products.length; i += 8) {
  await Promise.all(products.slice(i, i + 8).map(fetchOne));
}

console.log(`[fetch-real-images] Done: ${ok}/${products.length} real product photos cached locally (${fail} failed).`);
db.close();
