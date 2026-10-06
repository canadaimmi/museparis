// One-off add script: scrape a single AliExpress URL, categorize into knitwear,
// price = (aliexpressPrice + shippingCost) * 2, no sale/crossed-out price.
const fs = require('fs');
const path = require('path');
const https = require('https');
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

async function scrapeProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  while (true) {
    const currentUrl = page.url();
    const hasCaptchaText = await page.evaluate(() => {
      return document.body.innerText.includes('check if you are a robot') ||
             document.body.innerText.includes('Verification');
    }).catch(() => false);

    if (currentUrl.includes('punish') || hasCaptchaText) {
      console.log('[CAPTCHA DETECTED] Please solve the slider captcha in the browser window.');
      await new Promise(r => setTimeout(r, 4000));
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

  const swatchSelector = '[class*="sku-item--image"]';
  const swatches = await page.$$(swatchSelector);
  console.log(`Found ${swatches.length} color swatches on the page.`);

  const colours = [];
  const allCleanedImages = new Set();

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
    colours.push({ name: 'Default', images: Array.from(new Set(filtered)) });
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
      colours.push({ name: colorName, images: Array.from(new Set(filtered)) });
    }
  }

  const shippingText = await page.evaluate(() => {
    const shippingEl = document.querySelector('[class*="dynamic-shipping-titleLayout"], [class*="dynamic-shipping"], [class*="shipping--item"]');
    return shippingEl ? shippingEl.textContent.trim() : '';
  }).catch(() => '');

  return { title, price, colours, allImages: Array.from(allCleanedImages), shippingText };
}

async function downloadProductImages(imageUrls, productId) {
  if (!imageUrls || imageUrls.length === 0) return {};
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const urlMap = {};
  let savedIndex = 1;
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    const filename = `${productId}-${savedIndex}.jpg`;
    const dest = path.join(IMAGES_DIR, filename);
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
          const fileStream = fs.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(); });
        }).on('error', reject);
      });

      const stats = fs.statSync(dest);
      if (stats.size < 5000) {
        fs.unlinkSync(dest);
        console.log(`  Deleting small/invalid image: ${filename}`);
      } else {
        const lowerUrl = imageUrl.toLowerCase();
        const lowerFilename = filename.toLowerCase();
        const keywords = ["size", "chart", "guide", "measure", "ship", "map", "flag", "banner", "info"];
        const hasKeyword = keywords.some(kw => lowerUrl.includes(kw) || lowerFilename.includes(kw));
        if (hasKeyword) {
          fs.unlinkSync(dest);
          console.log(`  REMOVED (keyword): ${filename}`);
        } else {
          try {
            const dimensions = imageSize(fs.readFileSync(dest));
            if (dimensions.width > dimensions.height) {
              fs.unlinkSync(dest);
              console.log(`  REMOVED (landscape): ${filename}`);
            } else {
              console.log(`  KEPT: ${filename} (${dimensions.width}x${dimensions.height})`);
              urlMap[imageUrl] = `images/${filename}`;
              savedIndex++;
            }
          } catch {
            urlMap[imageUrl] = `images/${filename}`;
            savedIndex++;
          }
        }
      }
    } catch (err) {
      console.log(`  Failed to download image ${i + 1}: ${err.message}`);
    }
  }
  return urlMap;
}

async function run() {
  if (!URL_TO_ADD) {
    console.log('Usage: node add_knitwear_no_sale.js <aliexpress-url>');
    process.exit(1);
  }

  console.log('Connecting to browser on port 9222...');
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const scraped = await scrapeProduct(page, URL_TO_ADD);
  console.log(`Scraped: "${scraped.title}" — $${scraped.price} — shipping text: "${scraped.shippingText}"`);

  const id = slugify(scraped.title);
  const aliexpressPrice = scraped.price;
  const shippingCost = parseShippingCost(scraped.shippingText);
  const price = Math.round((aliexpressPrice + shippingCost) * 2);

  const existingProducts = readProducts();
  const existingDisplayNames = new Set(existingProducts.map(p => p.displayName).filter(Boolean));

  const product = {
    id,
    name: scraped.title,
    price,
    aliexpressPrice,
    shippingCost,
    category: 'knitwear',
    subCategory: 'knitwear',
    isClothing: true,
    colours: scraped.colours,
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    stock: { XS: 5, S: 5, M: 5, L: 5, XL: 5 },
    images: scraped.allImages,
    caption: '',
    description: [],
    materials: '',
    care: '',
    origin: 'Ships from supplier',
    aliexpressUrl: URL_TO_ADD,
    tags: ['new']
  };

  const startIdx = existingProducts.length % frenchNames.length;
  let fName = frenchNames[startIdx];
  for (let i = 0; i < frenchNames.length; i++) {
    const candidate = frenchNames[(startIdx + i) % frenchNames.length];
    if (!existingDisplayNames.has(`${candidate} Knit`)) { fName = candidate; break; }
  }
  product.displayName = `${fName} Knit`;

  const urlMap = await downloadProductImages(product.images, id);
  const localPaths = product.images.map(u => urlMap[u]).filter(Boolean);
  if (localPaths.length > 0) {
    product.images = localPaths;
    product.colours.forEach(col => { col.images = col.images.map(u => urlMap[u]).filter(Boolean); });
  }

  appendProduct(product);
  console.log(`\n✓ Appended "${product.displayName}" (id: ${id}) — price $${price} (item $${aliexpressPrice} + shipping $${shippingCost}) x2`);

  browser.disconnect();
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
