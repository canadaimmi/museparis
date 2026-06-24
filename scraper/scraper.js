// Muse Paris product scraper
// Reads AliExpress URLs from wishlist.txt, scrapes basic product data,
// generates a brand-voice caption via the Anthropic API, and appends
// each finished product to ../data/products.json.
//
// NOTE: AliExpress markup changes often. If a selector below stops
// matching, inspect the live page and update the selector — the rest
// of the pipeline (categorization, caption, file writes) is decoupled
// from the scrape step.

const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();
const puppeteer = require('puppeteer');
const Anthropic = require('@anthropic-ai/sdk');

const WISHLIST_PATH = path.join(__dirname, 'wishlist.txt');
const PRODUCTS_PATH = path.join(__dirname, '..', 'data', 'products.json');
const IMAGES_DIR = path.join(__dirname, '..', 'images');
const DELAY_MS = 2500;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CATEGORY_KEYWORDS = [
  { category: 'dresses', isClothing: true, words: ['dress', 'gown', 'frock'] },
  { category: 'tops', isClothing: true, words: ['top', 'blouse', 'shirt', 'tee', 't-shirt'] },
  { category: 'pants', isClothing: true, words: ['pants', 'jeans', 'trousers', 'leggings'] },
  { category: 'skirts', isClothing: true, words: ['skirt', 'shorts'] },
  { category: 'jackets', isClothing: true, words: ['jacket', 'coat', 'blazer', 'cardigan', 'hoodie', 'sweater', 'knitwear'] },
  { category: 'shoes', isClothing: false, words: ['shoes', 'heels', 'boots', 'sandals', 'sneakers', 'loafers', 'mules'] },
  { category: 'bags', isClothing: false, words: ['bag', 'tote', 'purse', 'handbag', 'clutch', 'basket'] },
  { category: 'jewelry', isClothing: false, words: ['jewelry', 'jewellery', 'necklace', 'earrings', 'bracelet', 'ring'] },
  { category: 'swimwear', isClothing: true, words: ['swimwear', 'bikini', 'swimsuit'] },
];

const frenchNames = [
  "Elise", "Camille", "Céline", "Margot", "Colette", "Anaïs", "Vivienne", "Sylvie", "Odette", "Fleur", 
  "Amélie", "Chloé", "Inès", "Manon", "Aurore", "Simone", "Juliette", "Capucine", "Mathilde", "Noémie", 
  "Delphine", "Élodie", "Sandrine", "Pauline", "Céleste", "Adèle", "Marine", "Séraphine", "Rosalie", 
  "Clémence", "Gabrielle", "Isabelle", "Lucille", "Madeleine", "Nicolette", "Ophélie", "Pascale", 
  "Renée", "Solange", "Thérèse", "Valentine", "Violette", "Yvette", "Zoé", "Blanche", "Estelle", 
  "Jacqueline", "Lisette", "Mirabelle", "Cosette"
];

function getItemType(product) {
  const category = (product.category || '').toLowerCase();
  const subCategory = (product.subCategory || '').toLowerCase();
  const title = (product.name || '').toLowerCase();
  
  if (category === 'dresses') return 'Dress';
  if (category === 'tops') return 'Top';
  if (category === 'knitwear') return 'Knit';
  if (category === 'bags') return 'Bag';
  
  if (category === 'bottoms') {
    if (title.includes('pant') || title.includes('trouser') || title.includes('jean') || title.includes('legging') || subCategory.includes('pant') || subCategory.includes('trousers') || subCategory.includes('jeans')) return 'Pant';
    if (title.includes('skirt') || subCategory.includes('skirt')) return 'Skirt';
    if (title.includes('short') || subCategory.includes('shorts')) return 'Short';
    return 'Bottom';
  }
  
  if (category === 'outerwear' || category === 'jackets') {
    if (title.includes('coat')) return 'Coat';
    return 'Jacket';
  }
  
  if (category === 'shoes') {
    if (title.includes('heel')) return 'Heel';
    if (title.includes('boot')) return 'Boot';
    if (title.includes('sandal')) return 'Sandal';
    if (title.includes('flat')) return 'Flat';
    return 'Flat';
  }
  
  if (category === 'jewelry' || category === 'jewellery') {
    if (title.includes('earring')) return 'Earring';
    if (title.includes('necklace')) return 'Necklace';
    if (title.includes('ring')) return 'Ring';
    if (title.includes('bracelet')) return 'Bracelet';
    return 'Earring';
  }
  
  if (category === 'accessories') {
    if (title.includes('scarf')) return 'Scarf';
    if (title.includes('belt')) return 'Belt';
    if (title.includes('hat')) return 'Hat';
    return 'Accessory';
  }
  
  return 'Item';
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

async function shouldKeepImage(url, page) {
  const urlLower = url.toLowerCase();
  const blacklist = ["size", "chart", "guide", "ship", "map", "measure", "instruction", "banner"];
  if (blacklist.some(word => urlLower.includes(word))) {
    console.log(`  [FILTER] ${url} (URL contains blacklisted word)`);
    return false;
  }

  // Check DOM for alt text if any image matches this URL
  const hasBlacklistedAlt = await page.evaluate((imgUrl) => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const matchingImg = imgs.find(img => img.src && img.src.includes(imgUrl));
    if (matchingImg) {
      const alt = (matchingImg.alt || '').toLowerCase();
      return alt.includes('size') || alt.includes('chart');
    }
    return false;
  }, url).catch(() => false);

  if (hasBlacklistedAlt) {
    console.log(`  [FILTER] ${url} (DOM alt text contains 'size' or 'chart')`);
    return false;
  }

  // Check dimensions in browser context
  const dims = await page.evaluate(async (imgUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = imgUrl;
    });
  }, url).catch(() => null);

  if (!dims) {
    console.log(`  [KEEP] ${url} (Could not load dimensions - keeping as fallback)`);
    return true;
  }

  if (dims.w < 400 || dims.h < 400) {
    console.log(`  [FILTER] ${url} (Dimensions too small: ${dims.w}x${dims.h})`);
    return false;
  }

  // Landscape ratio check
  if (dims.w > dims.h * 1.05) {
    console.log(`  [FILTER] ${url} (Landscape ratio: ${dims.w}x${dims.h})`);
    return false;
  }

  console.log(`  [KEEP] ${url} (Portrait/Square image: ${dims.w}x${dims.h})`);
  return true;
}

function categorize(title) {
  const lower = title.toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some(w => lower.includes(w))) {
      return { category: entry.category, isClothing: entry.isClothing };
    }
  }
  return { category: 'accessories', isClothing: false };
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function readWishlist() {
  if (!fs.existsSync(WISHLIST_PATH)) return [];
  return fs.readFileSync(WISHLIST_PATH, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function readProducts() {
  if (!fs.existsSync(PRODUCTS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function appendProduct(product) {
  const products = readProducts();
  products.push(product);
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
}

async function scrapeProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('Waiting 10 seconds for initial content to load...');
  await new Promise(r => setTimeout(r, 10000));

  // Scroll down slowly to trigger image loading and description loading
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
    if (h1 && h1.textContent.trim() !== 'Aliexpress') {
      return h1.textContent.trim();
    }
    const titleEl = document.querySelector('[class*="title--wrap"], [class*="product-title"]');
    if (titleEl) {
      return titleEl.textContent.trim();
    }
    return document.title.split(' - ')[0].trim();
  });

  const priceText = await page.$eval('[class*="price-default--current"], [class*="price--currentPrice"], [class*="product-price-value"], [class*="Price--current"]', el => el.textContent.trim()).catch(() => '0');
  const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

  const originalPriceText = await page.$eval('[class*="price-default--original"]', el => el.textContent.trim()).catch(() => null);
  const originalPrice = originalPriceText ? parseFloat(originalPriceText.replace(/[^0-9.]/g, '')) : null;

  // Swatches extraction
  const swatchSelector = '[class*="sku-item--image"]';
  const swatches = await page.$$(swatchSelector);
  console.log(`Found ${swatches.length} color swatches on the page.`);

  const colours = [];
  const allCleanedImages = new Set();

  if (swatches.length === 0) {
    console.log('No color swatches found, treating as single colour.');
    const domUrls = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('[class*="slider--img"] img'));
      return imgs.map(img => img.src);
    });
    const filtered = [];
    for (const u of domUrls) {
      const cleaned = cleanImageUrl(u);
      if (cleaned && await shouldKeepImage(cleaned, page)) {
        filtered.push(cleaned);
        allCleanedImages.add(cleaned);
      }
    }
    colours.push({
      name: 'Default',
      images: Array.from(new Set(filtered))
    });
  } else {
    for (let i = 0; i < swatches.length; i++) {
      console.log(`Selecting color swatch ${i + 1} of ${swatches.length}...`);
      await swatches[i].click();
      await new Promise(r => setTimeout(r, 3000));
      
      const colorName = await page.evaluate(() => {
        const titleEl = document.querySelector('[class*="sku-item--title"]');
        if (titleEl) {
          const spans = titleEl.querySelectorAll('span');
          if (spans.length > 1) {
            return spans[spans.length - 1].textContent.trim();
          }
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
        if (cleaned && await shouldKeepImage(cleaned, page)) {
          filtered.push(cleaned);
          allCleanedImages.add(cleaned);
        }
      }
      
      colours.push({
        name: colorName,
        images: Array.from(new Set(filtered))
      });
    }
  }

  const description = await page.$eval(
    '[class*="product-description"], [class*="detail-desc"]',
    el => el.textContent.trim().slice(0, 800)
  ).catch(() => '');

  const materials = await page.$$eval(
    '[class*="product-prop"] li, [class*="Specification--line"]',
    nodes => nodes.map(n => n.textContent.trim()).find(t => /fabric|material|composition/i.test(t)) || ''
  ).catch(() => '');

  return { title, price, originalPrice, colours, allImages: Array.from(allCleanedImages), description, materials };
}

async function generateCaption(title, description) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Write a 2-sentence product product caption for this item in an elegant, Parisian-inspired tone. Product: ${title}. Details: ${description}`
    }]
  });
  return message.content[0].text.trim();
}

async function downloadProductImages(imageUrls, productId) {
  if (!imageUrls || imageUrls.length === 0) return {};
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  console.log(`Found ${imageUrls.length} full-resolution URLs for product ${productId}:`);
  imageUrls.forEach((url, i) => console.log(`  [${i + 1}] ${url}`));

  const urlMap = {};
  let savedIndex = 1;
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    const filename = `${productId}-${savedIndex}.jpg`;
    const dest = path.join(IMAGES_DIR, filename);
    try {
      console.log(`Downloading ${imageUrl} -> ${filename}`);
      await new Promise((resolve, reject) => {
        const options = {
          headers: {
            'Accept': 'image/jpeg',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        };
        https.get(imageUrl, options, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Status code: ${res.statusCode}`));
            return;
          }
          const fileStream = fs.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', reject);
      });

      // Filter out small files (e.g. UI icons, stars, checkboxes < 5KB)
      const stats = fs.statSync(dest);
      if (stats.size < 5000) {
        console.log(`  Deleting small/invalid image: ${dest} (${stats.size} bytes)`);
        fs.unlinkSync(dest);
      } else {
        urlMap[imageUrl] = `images/${filename}`;
        savedIndex++;
      }
    } catch (err) {
      console.log(`✗ Failed to download image ${i + 1}: ${err.message}`);
    }
  }
  return urlMap;
}

async function run() {
  const urls = readWishlist();
  if (urls.length === 0) {
    console.log('No URLs found in wishlist.txt — add one AliExpress product URL per line.');
    return;
  }

  // Connect to existing browser if running, otherwise launch headless
  console.log('Connecting to browser on port 9222...');
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
    console.log('Connected to existing browser successfully.');
  } catch (err) {
    console.log('Could not connect to port 9222, launching fresh browser...', err.message);
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  for (const url of urls) {
    try {
      const scraped = await scrapeProduct(page, url);
      const { category, isClothing } = categorize(scraped.title);
      const id = slugify(scraped.title);
      const caption = await generateCaption(scraped.title, scraped.description);

      const productsCount = readProducts().length;
      const fName = frenchNames[productsCount % frenchNames.length];

      const product = {
        id,
        name: scraped.title,
        price: scraped.price,
        originalPrice: scraped.originalPrice,
        category,
        subCategory: category,
        isClothing,
        colours: scraped.colours,
        sizes: isClothing ? ['XS', 'S', 'M', 'L', 'XL'] : [],
        stock: isClothing ? { XS: 5, S: 5, M: 5, L: 5, XL: 5 } : {},
        images: scraped.allImages,
        caption,
        description: scraped.description.split('.').map(s => s.trim()).filter(Boolean).slice(0, 6),
        materials: scraped.materials || 'See original listing',
        care: 'See original listing for care instructions',
        origin: 'Ships from supplier',
        aliexpressUrl: url,
        tags: ['new']
      };

      const type = getItemType(product);
      product.displayName = `${fName} ${type}`;

      const urlMap = await downloadProductImages(product.images, id);
      const localPaths = product.images.map(imgUrl => urlMap[imgUrl]).filter(Boolean);
      if (localPaths && localPaths.length > 0) {
        product.images = localPaths;
        product.colours.forEach(col => {
          col.images = col.images.map(imgUrl => urlMap[imgUrl]).filter(Boolean);
        });
      }
      
      appendProduct(product);

      console.log(`✓ ${product.name} → ${category}`);
    } catch (err) {
      console.log(`✗ Failed: ${url} — ${err.message}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // If we connected to browser, disconnect rather than close it
  if (browser.disconnect) {
    browser.disconnect();
  } else {
    await browser.close();
  }
}

run();