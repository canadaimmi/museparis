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
  // Clean AliExpress image suffix like _50x50q70.jpg_.avif or _220x220.jpg etc.
  let cleaned = url.replace(/_(\d+x\d+)?.*$/, '');
  if (!/\.(jpg|jpeg|png|webp|avif|gif)$/i.test(cleaned)) {
    cleaned += '.jpg';
  }
  return cleaned;
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
  // Enable request interception
  await page.setRequestInterception(true);
  
  const rawInterceptedUrls = [];
  
  const requestListener = request => {
    const requestUrl = request.url();
    if ((requestUrl.includes('aliexpress-media.com') || requestUrl.includes('alicdn.com')) && 
        (/\.(jpg|webp|jpeg|png|avif)$/i.test(requestUrl.split('?')[0]) || requestUrl.includes('.jpg') || requestUrl.includes('.webp'))) {
      rawInterceptedUrls.push(requestUrl);
    }
    request.continue();
  };

  page.on('request', requestListener);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

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

  const title = await page.$eval('h1', el => el.textContent.trim()).catch(() => 'Untitled Product');

  const priceText = await page.$eval(
    '[class*="product-price-value"], [class*="Price--current"]',
    el => el.textContent.trim()
  ).catch(() => '0');
  const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

  // Filter: Must contain '/kf/' and must NOT contain small dimension filenames (like 20x20.png, 624x160.png, etc.)
  const images = Array.from(new Set(
    rawInterceptedUrls
      .filter(u => u.includes('/kf/') && !/\/\d+x\d+\.[a-z0-9]+$/i.test(u.split('?')[0]))
      .map(cleanImageUrl)
  )).filter(Boolean);

  const description = await page.$eval(
    '[class*="product-description"], [class*="detail-desc"]',
    el => el.textContent.trim().slice(0, 800)
  ).catch(() => '');

  const materials = await page.$$eval(
    '[class*="product-prop"] li, [class*="Specification--line"]',
    nodes => nodes.map(n => n.textContent.trim()).find(t => /fabric|material|composition/i.test(t)) || ''
  ).catch(() => '');

  // Cleanup request interception to avoid leaks
  page.off('request', requestListener);
  await page.setRequestInterception(false).catch(() => {});

  return { title, price, images, description, materials };
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
  if (!imageUrls || imageUrls.length === 0) return [];
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  console.log(`Found ${imageUrls.length} full-resolution URLs for product ${productId}:`);
  imageUrls.forEach((url, i) => console.log(`  [${i + 1}] ${url}`));

  const localPaths = [];
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
        localPaths.push(`images/${filename}`);
        savedIndex++;
      }
    } catch (err) {
      console.log(`✗ Failed to download image ${i + 1}: ${err.message}`);
    }
  }
  return localPaths;
}

async function run() {
  const urls = readWishlist();
  if (urls.length === 0) {
    console.log('No URLs found in wishlist.txt — add one AliExpress product URL per line.');
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

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
        originalPrice: null,
        category,
        subCategory: category,
        isClothing,
        colours: ['Default'],
        sizes: isClothing ? ['XS', 'S', 'M', 'L', 'XL'] : [],
        stock: isClothing ? { XS: 5, S: 5, M: 5, L: 5, XL: 5 } : {},
        images: scraped.images.slice(0, 5),
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

      const localImages = await downloadProductImages(product.images, id);
      if (localImages && localImages.length > 0) {
        product.images = localImages;
      }
      appendProduct(product);

      console.log(`✓ ${product.name} → ${category}`);
    } catch (err) {
      console.log(`✗ Failed: ${url} — ${err.message}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await browser.close();
}

run();