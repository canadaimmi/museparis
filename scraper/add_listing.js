// One-off add script (v2): scrape a single AliExpress.us URL (USD pricing),
// auto-categorize, dedupe images by content hash (not just URL),
// price = (aliexpressPrice * 2) + shippingCost  [shipping NOT doubled], no sale price.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { imageSize } = require('image-size');

const PRODUCTS_PATH = path.join(__dirname, '..', 'data', 'products.json');
const IMAGES_DIR = path.join(__dirname, '..', 'images');
const URL_TO_ADD = process.argv[2];

const frenchNames = [
  "Elise", "Camille", "Céline", "Margot", "Colette", "Anaïs", "Vivienne", "Sylvie", "Odette", "Fleur",
  "Amélie", "Chloé", "Inès", "Manon", "Aurore", "Simone", "Juliette", "Capucine", "Mathilde", "Noémie",
  "Delphine", "Élodie", "Sandrine", "Pauline", "Céleste", "Adèle", "Marine", "Séraphine", "Rosalie",
  "Clémence", "Gabrielle", "Isabelle", "Lucille", "Madeleine", "Nicolette", "Ophélie", "Pascale",
  "Renée", "Solange", "Thérèse", "Valentine", "Violette", "Yvette", "Zoé", "Blanche", "Estelle",
  "Jacqueline", "Lisette", "Mirabelle", "Cosette",
  "Fabienne", "Geneviève", "Héloïse", "Iris", "Joséphine", "Katell", "Léonie", "Margaux", "Nadège",
  "Solène", "Tiphaine", "Ursule", "Xavière", "Yseult", "Albane", "Bénédicte", "Diane", "Edmée",
  "Floriane", "Gaëlle", "Honorine", "Isaure", "Jade", "Karine", "Laure", "Mélodie", "Oriane",
  "Perrine", "Raphaëlle", "Sabine", "Véronique", "Wendeline", "Yasmine", "Zélie", "Dorothée",
  "Fanette", "Gwenaëlle", "Harmonie", "Joëlle", "Lysiane", "Maëlis", "Nathalie", "Océane",
  "Prudence", "Romane", "Sixtine", "Tatiana", "Victoire", "Aliénor", "Bérénice", "Domitille",
  "Éléonore", "Flavie", "Guillemette", "Hyacinthe", "Isaline", "Justine", "Lauriane", "Maïwenn",
  "Ninon", "Olympe", "Philomène", "Reine", "Toscane", "Alberte", "Brunelle", "Charline", "Danaé",
  "Emmeline", "Flore", "Hermine", "Isadora", "Joanna", "Lucette", "Nelly", "Ondine", "Régine",
  "Urbaine", "Viviane", "Ambre", "Clara", "Clémentine", "Coralie", "Hortense", "Lucie", "Léa",
  "Mélanie", "Pénélope", "Roxane", "Sophie", "Lola", "Agathe", "Alice", "Angèle", "Axelle",
  "Aziliz", "Bertille", "Cécile", "Christelle", "Cyrielle", "Eleonore", "Faustine", "Gwendoline",
  "Lorraine", "Luisa", "Maëlle", "Mathis", "Mireille", "Morgane", "Noemie", "Rosanne", "Salomé",
  "Stéphanie", "Théodora", "Wanda", "Ysabel", "Zelda"
];

const CATEGORY_KEYWORDS = [
  { category: 'dresses', isClothing: true, words: ['dress', 'gown', 'frock'] },
  { category: 'knitwear', isClothing: true, words: ['cardigan', 'sweater', 'knitwear', 'knit '] },
  { category: 'tops', isClothing: true, words: ['top', 'blouse', 'shirt', 'tee', 't-shirt'] },
  { category: 'pants', isClothing: true, words: ['pants', 'jeans', 'trousers', 'leggings'] },
  { category: 'skirts', isClothing: true, words: ['skirt', 'shorts'] },
  { category: 'jackets', isClothing: true, words: ['jacket', 'coat', 'blazer', 'hoodie'] },
  { category: 'shoes', isClothing: false, words: ['shoes', 'heels', 'boots', 'sandals', 'sneakers', 'loafers', 'mules'] },
  { category: 'bags', isClothing: false, words: ['bag', 'tote', 'purse', 'handbag', 'clutch', 'basket'] },
  { category: 'jewelry', isClothing: false, words: ['jewelry', 'jewellery', 'necklace', 'earrings', 'bracelet', 'ring'] },
  { category: 'swimwear', isClothing: true, words: ['swimwear', 'bikini', 'swimsuit'] },
];

function categorize(title) {
  const lower = title.toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some(w => lower.includes(w))) {
      return { category: entry.category, isClothing: entry.isClothing };
    }
  }
  return { category: 'accessories', isClothing: false };
}

function itemTypeFor(category) {
  const map = {
    dresses: 'Dress', tops: 'Top', knitwear: 'Knit', bags: 'Bag',
    jackets: 'Jacket', shoes: 'Flat', jewelry: 'Earring',
    accessories: 'Accessory', skirts: 'Skirt', swimwear: 'Swimsuit', pants: 'Pant'
  };
  return map[category] || 'Set';
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function cleanImageUrl(url) {
  if (!url) return '';
  let cleaned = url;
  const match = url.match(/\.(jpg|jpeg|png|webp|avif)(?:_[^/]+)$/i);
  if (match) {
    cleaned = url.substring(0, url.lastIndexOf(match[0]) + match[1].length + 1);
  }
  cleaned = cleaned.replace(/\.(avif|webp)$/i, '.jpg');
  if (!/\.(jpg|jpeg|png)$/i.test(cleaned)) {
    cleaned += '.jpg';
  }
  return cleaned;
}

function parseShippingCost(text) {
  if (!text) return 0;
  const cleanText = text.toLowerCase();
  if (cleanText.includes('free')) return 0;
  const match = cleanText.match(/[0-9]+\.[0-9]+/);
  if (match) return parseFloat(match[0]) || 0;
  const matchInt = cleanText.match(/[0-9]+/);
  if (matchInt) return parseFloat(matchInt[0]) || 0;
  return 0;
}

function readProducts() {
  if (!fs.existsSync(PRODUCTS_PATH)) return [];
  return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
}

function appendProduct(product) {
  const products = readProducts();
  products.push(product);
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
}

async function forceUSD(page, url) {
  const { hostname } = new URL(url);
  // AliExpress reads region/currency preference from these cookies regardless
  // of IP geolocation; set them before first navigation so pricing renders in USD.
  const cookies = [
    { name: 'aep_usuc_f', value: 'site=usa&c_tp=USD&region=US&b_locale=en_US', domain: '.' + hostname.replace(/^www\./, '') },
    { name: 'xman_us_f', value: 'x_locale=en_US&x_alimid=&x_cur=USD&x_c_chg=1', domain: '.' + hostname.replace(/^www\./, '') },
  ];
  for (const c of cookies) {
    await page.setCookie({ ...c, url: `https://${hostname}` }).catch(() => {});
  }
}

async function scrapeProduct(page, url) {
  await forceUSD(page, url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  let loops = 0;
  while (true) {
    loops++;
    const currentUrl = page.url();
    const captchaInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      let iframeText = '';
      try {
        for (const f of document.querySelectorAll('iframe')) {
          try { iframeText += (f.contentDocument?.body?.innerText || ''); } catch {}
        }
      } catch {}
      return { bodyText: bodyText.slice(0, 300), iframeText: iframeText.slice(0, 300), hasRobotCheckbox: !!document.querySelector('[class*="captcha"], [id*="captcha"], [class*="recaptcha"]') };
    }).catch(() => ({ bodyText: '', iframeText: '', hasRobotCheckbox: false }));

    const combined = (captchaInfo.bodyText + ' ' + captchaInfo.iframeText).toLowerCase();
    const looksLikeCaptcha = currentUrl.includes('punish') || combined.includes('robot') || combined.includes('verification') || captchaInfo.hasRobotCheckbox;

    if (looksLikeCaptcha) {
      console.log(`\n[CAPTCHA DETECTED] Please solve it in the visible browser window.`);
      await new Promise(r => setTimeout(r, 4000));
      if (loops > 150) throw new Error('Captcha not solved after 10 minutes, aborting.');
      continue;
    }

    const titleText = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent.trim() !== 'Aliexpress') return h1.textContent.trim();
      const titleEl = document.querySelector('[class*="title--wrap"], [class*="product-title"]');
      if (titleEl) return titleEl.textContent.trim();
      return '';
    }).catch(() => '');

    if (titleText) {
      console.log(`Page content detected ("${titleText.slice(0, 40)}...")! Proceeding to scrape...`);
      break;
    }
    if (loops > 150) throw new Error('Product content never loaded after 5 minutes, aborting.');
    console.log('Waiting for product page content to load...');
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('Waiting 10 seconds for initial content to load...');
  await new Promise(r => setTimeout(r, 10000));

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight || totalHeight > 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await new Promise(r => setTimeout(r, 2000));

  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim() !== 'Aliexpress') return h1.textContent.trim();
    const titleEl = document.querySelector('[class*="title--wrap"], [class*="product-title"]');
    if (titleEl) return titleEl.textContent.trim();
    return document.title.split(' - ')[0].trim();
  });

  const priceText = await page.$eval('[class*="price-default--current"], [class*="price--currentPrice"], [class*="product-price-value"], [class*="Price--current"]', el => el.textContent.trim()).catch(() => '0');
  const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
  const currencySymbolMatch = priceText.match(/^[^\d]+/);
  const currencySymbol = currencySymbolMatch ? currencySymbolMatch[0].trim() : '';

  const swatchSelector = '[class*="sku-item--image"]';
  const swatches = await page.$$(swatchSelector);
  console.log(`Found ${swatches.length} color swatches on the page.`);

  const colours = [];
  const allCleanedImages = new Set();
  const perColourUrls = [];

  if (swatches.length === 0) {
    const domUrls = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('[class*="slider--img"] img'));
      return imgs.map(img => img.src);
    });
    const filtered = [];
    for (const u of domUrls) {
      const cleaned = cleanImageUrl(u);
      if (cleaned) { filtered.push(cleaned); allCleanedImages.add(cleaned); }
    }
    const uniq = Array.from(new Set(filtered));
    colours.push({ name: 'Default', images: uniq });
    perColourUrls.push(uniq);
  } else {
    for (let i = 0; i < swatches.length; i++) {
      await page.evaluate((idx) => {
        const els = document.querySelectorAll('[class*="sku-item--image"]');
        if (els[idx]) els[idx].click();
        else {
          const items = document.querySelectorAll('[class*="sku-item"]');
          if (items[idx]) items[idx].click();
        }
      }, i).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      const colorName = await page.evaluate(() => {
        const titleEl = document.querySelector('[class*="sku-item--title"]');
        if (titleEl) {
          const spans = titleEl.querySelectorAll('span');
          if (spans.length > 1) return spans[spans.length - 1].textContent.trim();
          return titleEl.textContent.replace(/color|colour|:|：/ig, '').trim();
        }
        return 'Unknown';
      });

      const domUrls = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('[class*="slider--img"] img'));
        return imgs.map(img => img.src);
      });
      const filtered = [];
      for (const u of domUrls) {
        const cleaned = cleanImageUrl(u);
        if (cleaned) { filtered.push(cleaned); allCleanedImages.add(cleaned); }
      }
      const uniq = Array.from(new Set(filtered));
      colours.push({ name: colorName, images: uniq });
      perColourUrls.push(uniq);
    }

    const allIdentical = perColourUrls.every(list => JSON.stringify(list) === JSON.stringify(perColourUrls[0]));
    if (allIdentical && colours.length > 1) {
      console.log(`Note: all ${colours.length} colour swatches (${colours.map(c => c.name).join(', ')}) share the same photo set on AliExpress — keeping all colour names as selectable options, images just won't differ per colour.`);
    }
  }

  const shippingText = await page.evaluate(() => {
    const shippingEl = document.querySelector('[class*="dynamic-shipping-titleLayout"], [class*="dynamic-shipping"], [class*="shipping--item"]');
    return shippingEl ? shippingEl.textContent.trim() : '';
  }).catch(() => '');

  return { title, price, currencySymbol, colours, allImages: Array.from(allCleanedImages), shippingText };
}

function fileHash(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

async function downloadProductImages(imageUrls, productId) {
  if (!imageUrls || imageUrls.length === 0) return {};
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const urlMap = {};
  const seenHashes = new Set();
  let savedIndex = 1;
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    const tmpDest = path.join(IMAGES_DIR, `__tmp_${productId}_${i}.jpg`);
    try {
      await new Promise((resolve, reject) => {
        const options = {
          headers: {
            'Accept': 'image/jpeg',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        };
        https.get(imageUrl, options, (res) => {
          if (res.statusCode !== 200) { reject(new Error(`Status code: ${res.statusCode}`)); return; }
          const fileStream = fs.createWriteStream(tmpDest);
          res.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(); });
        }).on('error', reject);
      });

      const stats = fs.statSync(tmpDest);
      if (stats.size < 5000) {
        fs.unlinkSync(tmpDest);
        console.log(`  Deleting small/invalid image (${stats.size} bytes)`);
        continue;
      }

      const lowerUrl = imageUrl.toLowerCase();
      const keywords = ["size", "chart", "guide", "measure", "ship", "map", "flag", "banner", "info"];
      if (keywords.some(kw => lowerUrl.includes(kw))) {
        fs.unlinkSync(tmpDest);
        console.log(`  REMOVED (keyword): ${imageUrl}`);
        continue;
      }

      let dims;
      try { dims = imageSize(fs.readFileSync(tmpDest)); } catch { dims = null; }
      if (dims && dims.width > dims.height) {
        fs.unlinkSync(tmpDest);
        console.log(`  REMOVED (landscape ${dims.width}x${dims.height})`);
        continue;
      }

      const hash = fileHash(tmpDest);
      if (seenHashes.has(hash)) {
        fs.unlinkSync(tmpDest);
        console.log(`  REMOVED (duplicate photo, same content as an earlier image)`);
        continue;
      }
      seenHashes.add(hash);

      const finalFilename = `${productId}-${savedIndex}.jpg`;
      fs.renameSync(tmpDest, path.join(IMAGES_DIR, finalFilename));
      console.log(`  KEPT: ${finalFilename}${dims ? ` (${dims.width}x${dims.height})` : ''}`);
      urlMap[imageUrl] = `images/${finalFilename}`;
      savedIndex++;
    } catch (err) {
      console.log(`  Failed to download image ${i + 1}: ${err.message}`);
      if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest);
    }
  }
  return urlMap;
}

async function run() {
  if (!URL_TO_ADD) {
    console.log('Usage: node add_listing.js <aliexpress-url>');
    process.exit(1);
  }

  console.log('Connecting to browser on port 9222...');
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const scraped = await scrapeProduct(page, URL_TO_ADD);
  console.log(`Scraped: "${scraped.title}" — price ${scraped.currencySymbol}${scraped.price} — shipping text: "${scraped.shippingText}"`);

  if (!/^(US\$|USD|\$)$/.test(scraped.currencySymbol) && scraped.currencySymbol !== '$') {
    console.log(`\n⚠️  WARNING: scraped currency symbol was "${scraped.currencySymbol}", not a plain "$" (USD). Verify pricing manually before trusting this listing.\n`);
  }

  const id = slugify(scraped.title);
  const aliexpressPrice = scraped.price;
  const shippingCost = parseShippingCost(scraped.shippingText);
  const price = Math.round(aliexpressPrice * 2 + shippingCost);

  const { category, isClothing } = categorize(scraped.title);
  const subCategory = category;

  const existingProducts = readProducts();
  const existingDisplayNames = new Set(existingProducts.map(p => p.displayName).filter(Boolean));

  const product = {
    id,
    name: scraped.title,
    price,
    aliexpressPrice,
    shippingCost,
    category,
    subCategory,
    isClothing,
    colours: scraped.colours,
    sizes: isClothing ? ['XS', 'S', 'M', 'L', 'XL'] : [],
    stock: isClothing ? { XS: 5, S: 5, M: 5, L: 5, XL: 5 } : {},
    images: scraped.allImages,
    caption: '',
    description: [],
    materials: '',
    care: '',
    origin: 'Ships from supplier',
    aliexpressUrl: URL_TO_ADD,
    tags: ['new']
  };

  const type = itemTypeFor(category);
  const startIdx = existingProducts.length % frenchNames.length;
  let fName = frenchNames[startIdx];
  for (let i = 0; i < frenchNames.length; i++) {
    const candidate = frenchNames[(startIdx + i) % frenchNames.length];
    if (!existingDisplayNames.has(`${candidate} ${type}`)) { fName = candidate; break; }
  }
  product.displayName = `${fName} ${type}`;

  const urlMap = await downloadProductImages(product.images, id);
  const localPaths = product.images.map(u => urlMap[u]).filter(Boolean);
  product.images = localPaths;
  product.colours.forEach(col => { col.images = col.images.map(u => urlMap[u]).filter(Boolean); });

  appendProduct(product);
  console.log(`\n✓ Appended "${product.displayName}" (id: ${id}, category: ${category}) — price $${price} (item $${aliexpressPrice} x2 + shipping $${shippingCost}), ${product.images.length} unique photos`);

  browser.disconnect();
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
