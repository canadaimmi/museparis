/* ===================== GLOBAL: NAV, CART, SCROLL ===================== */

const Cart = {
  items: [], // { id, name, price, image, qty, aliexpressUrl }

  add(product, qty = 1) {
    const existing = this.items.find(i => i.id === product.id);
    if (existing) {
      existing.qty += qty;
    } else {
      this.items.push({
        id: product.id,
        name: product.displayName || product.name,
        price: product.price,
        image: product.images[0],
        aliexpressUrl: product.aliexpressUrl,
        qty
      });
    }
    this.render();
  },

  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.render();
  },

  setQty(id, qty) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.max(1, qty);
    this.render();
  },

  subtotal() {
    return this.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  },

  count() {
    return this.items.reduce((sum, i) => sum + i.qty, 0);
  },

  render() {
    const dot = document.getElementById('cartDot');
    if (dot) dot.classList.toggle('show', this.count() > 0);

    const itemsEl = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('cartSubtotal');
    if (!itemsEl) return;

    if (this.items.length === 0) {
      itemsEl.innerHTML = '<p class="cart-empty">Your bag is empty.</p>';
    } else {
      itemsEl.innerHTML = this.items.map(item => `
        <div class="cart-item" data-id="${item.id}">
          <div class="img-box bg-placeholder" style="background-image:url('${item.image}')"></div>
          <div class="cart-item-info">
            <p class="name">${item.name}</p>
            <p class="price">$${Math.round(item.price)}</p>
            <div class="qty-controls">
              <button class="qty-minus">−</button>
              <span>${item.qty}</span>
              <button class="qty-plus">+</button>
            </div>
            <button class="cart-item-remove">Remove</button>
          </div>
        </div>
      `).join('');

      itemsEl.querySelectorAll('.cart-item').forEach(el => {
        const id = el.dataset.id;
        const item = this.items.find(i => i.id === id);
        el.querySelector('.qty-plus').addEventListener('click', () => Cart.setQty(id, item.qty + 1));
        el.querySelector('.qty-minus').addEventListener('click', () => Cart.setQty(id, item.qty - 1));
        el.querySelector('.cart-item-remove').addEventListener('click', () => Cart.remove(id));
      });
    }

    const total = this.subtotal();
    if (subtotalEl) subtotalEl.textContent = `$${Math.round(total)}`;

    const footerEl = document.querySelector('.cart-footer');
    if (footerEl) {
      let promoEl = document.getElementById('cartShippingPromo');
      let shippingLine = document.getElementById('cartShippingLine');
      let shippingVal = document.getElementById('cartShippingVal');
      
      if (!promoEl) {
        const subtotalDiv = footerEl.querySelector('.cart-subtotal');
        if (subtotalDiv) {
          subtotalDiv.insertAdjacentHTML('beforebegin', `
            <div id="cartShippingPromo" style="font-size: 0.8rem; text-align: center; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #FF1493;"></div>
            <div id="cartShippingLine" style="display: flex; justify-content: space-between; font-size: 13px; color: var(--grey); margin-bottom: 8px;">
              <span>Shipping</span>
              <span id="cartShippingVal">Free</span>
            </div>
          `);
          promoEl = document.getElementById('cartShippingPromo');
          shippingLine = document.getElementById('cartShippingLine');
          shippingVal = document.getElementById('cartShippingVal');
        }
      }
      
      if (promoEl) {
        if (this.items.length === 0) {
          promoEl.style.display = 'none';
          if (shippingLine) shippingLine.style.display = 'none';
        } else {
          promoEl.style.display = 'block';
          if (shippingLine) shippingLine.style.display = 'flex';
          
          if (total >= 65) {
            promoEl.textContent = "Free Shipping Applied";
            if (shippingVal) shippingVal.textContent = "Free";
          } else {
            const diff = 65 - total;
            promoEl.textContent = `Add $${Math.round(diff)} more for free shipping`;
            if (shippingVal) shippingVal.textContent = "$5";
          }
        }
      }
    }
  }
};

function initNav() {
  const shopTrigger = document.querySelector('.nav-item-shop');
  const shopDropdown = document.querySelector('.shop-dropdown');
  if (shopTrigger && shopDropdown) {
    let timeoutId = null;
    const showMenu = () => {
      clearTimeout(timeoutId);
      shopDropdown.classList.add('active');
    };
    const hideMenu = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        shopDropdown.classList.remove('active');
      }, 250);
    };
    shopTrigger.addEventListener('mouseenter', showMenu);
    shopTrigger.addEventListener('mouseleave', hideMenu);
    shopTrigger.addEventListener('focusin', showMenu);
    shopTrigger.addEventListener('focusout', hideMenu);
  }

  const hamburger = document.getElementById('hamburgerBtn');
  const overlay = document.getElementById('mobileNavOverlay');
  const closeBtn = document.getElementById('mobileNavClose');
  if (hamburger && overlay) {
    hamburger.addEventListener('click', () => overlay.classList.add('open'));
  }
  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
  }

  const mobileShopBtn = document.getElementById('mobileShopBtn');
  const mobileShopPanel = document.getElementById('mobileShopPanel');
  if (mobileShopBtn && mobileShopPanel) {
    mobileShopBtn.addEventListener('click', () => {
      mobileShopPanel.classList.toggle('open');
      mobileShopBtn.textContent = mobileShopPanel.classList.contains('open') ? 'Shop ▴' : 'Shop ▾';
    });
  }

  const cartBtn = document.getElementById('cartBtn');
  const cartSidebar = document.getElementById('cartSidebar');
  const cartOverlay = document.getElementById('cartOverlay');
  const cartClose = document.getElementById('cartClose');
  const checkoutBtn = document.getElementById('checkoutBtn');

  function openCart() {
    cartSidebar.classList.add('open');
    cartOverlay.classList.add('open');
  }
  function closeCart() {
    cartSidebar.classList.remove('open');
    cartOverlay.classList.remove('open');
  }

  if (cartBtn) cartBtn.addEventListener('click', openCart);
  if (cartClose) cartClose.addEventListener('click', closeCart);
  if (cartOverlay) cartOverlay.addEventListener('click', closeCart);
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      if (Cart.items.length === 0) return;
      Cart.items.forEach(item => window.open(item.aliexpressUrl, '_blank'));
    });
  }

  Cart.render();
}

function initScrollTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('show', window.scrollY > 600);
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function initHeroSlider() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const slides = hero.querySelectorAll('.hero-slide');
  if (slides.length <= 1) return;
  let current = 0;
  function show(i) {
    slides.forEach((s, idx) => s.style.opacity = idx === i ? '1' : '0');
  }
  hero.querySelector('.hero-arrow.left')?.addEventListener('click', () => {
    current = (current - 1 + slides.length) % slides.length;
    show(current);
  });
  hero.querySelector('.hero-arrow.right')?.addEventListener('click', () => {
    current = (current + 1) % slides.length;
    show(current);
  });
}

function initNewsletterForms() {
  document.querySelectorAll('.newsletter-mini form, #contactForm').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      form.reset();
      alert('Thank you — you will hear from Muse Paris soon.');
    });
  });
}

/* ===================== PRODUCT DATA ===================== */

async function fetchProducts() {
  const res = await fetch('/data/products.json');
  return res.json();
}

function categoryMatches(product, cat) {
  if (cat === 'new-in') return product.tags?.includes('new');
  if (cat === 'best-sellers') return product.tags?.includes('best-seller');
  if (cat === 'last-chance') return !!product.originalPrice;
  return product.category === cat;
}

function categoryLabel(cat) {
  const map = {
    'new-in': 'New In', 'best-sellers': 'Best Sellers', 'last-chance': 'Last Chance',
    'tops': 'Tops', 'dresses': 'Dresses', 'knitwear': 'Knitwear', 'jackets': 'Jackets & Coats',
    'pants': 'Pants', 'skirts': 'Skirts & Shorts', 'denim': 'Denim', 'swimwear': 'Swimwear',
    'bags': 'Bags', 'shoes': 'Shoes', 'jewelry': 'Jewelry', 'accessories': 'Accessories',
    'activewear': 'Activewear'
  };
  return map[cat] || cat;
}

/* ===================== CATEGORY PAGE ===================== */

function initCategoryPage() {
  const grid = document.getElementById('productGridRows');
  if (!grid) return;

  const params = new URLSearchParams(window.location.search);
  const cat = params.get('cat') || 'new-in';
  const subcat = params.get('subcat');

  const displayTitle = subcat ? `${categoryLabel(cat)} — ${subcat.charAt(0).toUpperCase() + subcat.slice(1).replace(/-/g, ' ')}` : categoryLabel(cat);
  document.getElementById('catLabel').textContent = displayTitle;
  document.getElementById('categoryTitle').textContent = displayTitle;
  document.title = `${displayTitle} — Muse Paris`;

  fetchProducts().then(products => {
    let matched = products.filter(p => categoryMatches(p, cat));

    // sub-category strip (computed from full category match)
    const subcats = [...new Set(matched.map(p => p.subCategory).filter(Boolean))];
    const strip = document.getElementById('subcatStrip');
    if (subcats.length) {
      strip.innerHTML = subcats.map((sc, i) => {
        const sample = matched.find(p => p.subCategory === sc);
        const isActive = subcat ? (sc === subcat) : false;
        return `
          <a href="category.html?cat=${cat}&subcat=${sc}" class="subcat-card ${isActive ? 'active' : ''}">
            <div class="img-box bg-placeholder" style="background-image:url('${sample.images[0]}')"></div>
            <p class="name">${sc.replace(/-/g, ' ')}</p>
          </a>`;
      }).join('');
    } else {
      strip.innerHTML = '';
    }

    if (subcat) {
      matched = matched.filter(p => p.subCategory === subcat);
    }

    // alternating rhythm rows: 3, 2, 3, 2...
    const rows = [];
    let i = 0;
    let pattern = 3;
    while (i < matched.length) {
      const count = Math.min(pattern, matched.length - i);
      rows.push({ items: matched.slice(i, i + count), cols: pattern });
      i += count;
      pattern = pattern === 3 ? 2 : 3;
    }

    if (matched.length === 0) {
      grid.innerHTML = '<p style="text-align:center; padding:60px 0; color:#888;">No products found in this category yet.</p>';
      return;
    }

    grid.innerHTML = rows.map(row => `
      <div class="product-row cols-${row.cols}">
        ${row.items.map(p => productCardHTML(p)).join('')}
      </div>
    `).join('');

    grid.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', e => {
        e.preventDefault();
        if (e.target.closest('.qp-footer') || e.target.closest('.heart')) return;
        window.location.href = `product.html?id=${card.dataset.id}`;
      });
    });

    grid.querySelectorAll('.qp-footer').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.closest('.product-card').dataset.id;
        const product = matched.find(p => p.id === id);
        Cart.add(product);
      });
    });

    grid.querySelectorAll('.heart').forEach(h => {
      h.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
    });
  });
}

function productCardHTML(p) {
  const sizesHTML = (p.sizes || []).map(s => {
    const avail = (p.stock?.[s] || 0) > 0;
    return `<span class="${avail ? 'avail' : 'oos'}">${s}</span>`;
  }).join('');

  const coloursHTML = (p.colours || []).map((c, idx) => {
    const name = typeof c === 'object' ? c.name : c;
    return `<span class="${idx === 0 ? 'active-colour' : ''}">${name}</span>`;
  }).join(' | ');

  let priceHTML = '';
  if (p.originalPrice && p.salePrice) {
    const original = Math.round(p.originalPrice);
    const sale = Math.round(p.salePrice);
    priceHTML = `
      <span style="text-decoration:line-through; color:#999;">$${original}</span>
      <span style="color:#FF1493; font-weight:bold; margin-left:6px;">$${sale}</span>
    `;
  } else {
    priceHTML = `<span style="font-weight:bold;">$${Math.round(p.price)}</span>`;
  }

  const salePriceVal = p.salePrice || p.price;
  const freeShippingText = salePriceVal >= 65 ? "Free Shipping" : "Ships free over $65";
  const freeShippingHTML = `<span style="display:block; color:#FF1493; font-size:0.75rem; margin-top:2px;">${freeShippingText}</span>`;

  return `
    <a href="#" class="product-card" data-id="${p.id}">
      <span class="heart">♡</span>
      <div class="img-box bg-placeholder" style="background-image:url('${p.images[0]}')"></div>
      <div class="quick-panel">
        <div>
          <p class="qp-name">${p.displayName || p.name}</p>
          <p class="qp-price">${priceHTML}${freeShippingHTML}</p>
          <p class="qp-colours">Available in ${coloursHTML}</p>
          ${p.sizes?.length ? `<div class="qp-sizes">${sizesHTML}</div>` : ''}
        </div>
        <div class="qp-footer">Quick Shop 🛍</div>
      </div>
      <p class="name-price">${p.displayName || p.name} — ${priceHTML}${freeShippingHTML}</p>
    </a>
  `;
}

/* ===================== PRODUCT PAGE ===================== */

function initProductPage() {
  const detail = document.getElementById('productDetail');
  if (!detail) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  fetchProducts().then(products => {
    const product = products.find(p => p.id === id) || products[0];
    if (!product) return;

    document.title = `${product.displayName || product.name} — Muse Paris`;
    document.getElementById('bcCategory').textContent = categoryLabel(product.category);
    document.getElementById('bcCategory').href = `category.html?cat=${product.category}`;
    document.getElementById('bcProduct').textContent = product.displayName || product.name;

    document.getElementById('pdName').textContent = product.displayName || product.name;
    const firstColourName = typeof product.colours[0] === 'object' ? product.colours[0].name : product.colours[0];
    document.getElementById('pdColour').textContent = firstColourName;
    const priceEl = document.getElementById('pdPrice');
    if (product.originalPrice && product.salePrice) {
      const original = Math.round(product.originalPrice);
      const sale = Math.round(product.salePrice);
      priceEl.innerHTML = `
        <span style="text-decoration:line-through; color:#999;">$${original}</span>
        <span style="color:#FF1493; font-weight:bold; margin-left:8px;">$${sale}</span>
      `;
    } else {
      priceEl.innerHTML = `<span style="font-weight:bold;">$${Math.round(product.price)}</span>`;
    }

    // Below price shipping notice
    let freeShippingBadge = document.getElementById('pdFreeShipping');
    if (freeShippingBadge) {
      freeShippingBadge.remove();
    }
    const salePriceVal = product.salePrice || product.price;
    const shippingText = salePriceVal >= 65 ? "Free Shipping" : "Free shipping on orders over $65";
    const priceParagraph = document.querySelector('.pd-colour-price');
    if (priceParagraph) {
      priceParagraph.insertAdjacentHTML('afterend', `<p id="pdFreeShipping" style="color:#FF1493; font-weight:bold; font-size:0.85rem; margin-top:4px; margin-bottom:12px;">${shippingText}</p>`);
    }

    let currentImage = 0;
    function showImage(i) {
      currentImage = i;
      document.getElementById('pdMainImage').src = product.images[i];
      document.querySelectorAll('.pd-thumb').forEach((t, idx) => t.classList.toggle('active', idx === i));
    }

    document.getElementById('pdThumbs').innerHTML = product.images.map((img, i) =>
      `<img class="pd-thumb bg-placeholder ${i === 0 ? 'active' : ''}" src="${img}" data-i="${i}" alt="Thumbnail ${i + 1}">`
    ).join('');
    document.querySelectorAll('.pd-thumb').forEach(t => {
      t.addEventListener('click', () => showImage(+t.dataset.i));
    });
    showImage(0);

    document.getElementById('pdPrev').addEventListener('click', () => {
      showImage((currentImage - 1 + product.images.length) % product.images.length);
    });
    document.getElementById('pdNext').addEventListener('click', () => {
      showImage((currentImage + 1) % product.images.length);
    });

    document.getElementById('pdCaption').textContent = product.caption;
    document.getElementById('pdFeatures').innerHTML = product.description.map(d => `<li>${d}</li>`).join('');

    document.getElementById('pdMaterials').textContent = product.materials;
    document.getElementById('pdCare').textContent = product.care;

    const swatchContainer = document.querySelector('.pd-colour-swatch');
    if (swatchContainer && product.colours?.length) {
      swatchContainer.innerHTML = product.colours.map((c, idx) => {
        const name = typeof c === 'object' ? c.name : c;
        const img = (typeof c === 'object' && c.images?.length) ? c.images[0] : product.images[0];
        return `
          <div class="swatch-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; border:1px solid #ccc; padding:4px 8px; border-radius:4px; margin-right:8px;">
            <img class="swatch-thumb bg-placeholder" src="${img}" alt="${name}" style="width:24px; height:24px; object-fit:cover; border-radius:50%;">
            <span class="swatch-name" style="font-size:12px; text-transform:uppercase;">${name}</span>
          </div>
        `;
      }).join('');

      swatchContainer.querySelectorAll('.swatch-item').forEach(item => {
        item.addEventListener('click', () => {
          swatchContainer.querySelectorAll('.swatch-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          const idx = parseInt(item.dataset.idx);
          const c = product.colours[idx];
          const name = typeof c === 'object' ? c.name : c;
          document.getElementById('pdColour').textContent = name;

          // Switch active image & thumbnails
          if (typeof c === 'object' && c.images?.length) {
            product.images = c.images;
            document.getElementById('pdThumbs').innerHTML = product.images.map((img, i) =>
              `<img class="pd-thumb bg-placeholder ${i === 0 ? 'active' : ''}" src="${img}" data-i="${i}" alt="Thumbnail ${i + 1}">`
            ).join('');
            document.querySelectorAll('.pd-thumb').forEach(t => {
              t.addEventListener('click', () => showImage(+t.dataset.i));
            });
            showImage(0);
          }
        });
      });
    } else {
      document.getElementById('pdSwatchThumb').src = product.images[0];
      document.getElementById('pdSwatchName').textContent = '';
    }

    // size guide tab only for clothing
    const sizeGuideBtn = document.getElementById('sizeGuideTabBtn');
    if (!product.isClothing) {
      sizeGuideBtn.style.display = 'none';
    }

    let selectedSize = null;
    const sizesEl = document.getElementById('pdSizes');
    if (product.sizes?.length) {
      sizesEl.innerHTML = product.sizes.map(s => {
        const stock = product.stock?.[s] || 0;
        return `<div class="size-box ${stock === 0 ? 'oos' : ''}" data-size="${s}">${s}</div>`;
      }).join('');
      sizesEl.querySelectorAll('.size-box:not(.oos)').forEach(box => {
        box.addEventListener('click', () => {
          sizesEl.querySelectorAll('.size-box').forEach(b => b.classList.remove('active'));
          box.classList.add('active');
          selectedSize = box.dataset.size;
          checkLowStock();
        });
      });
      const firstAvailable = sizesEl.querySelector('.size-box:not(.oos)');
      if (firstAvailable) {
        firstAvailable.classList.add('active');
        selectedSize = firstAvailable.dataset.size;
      }
    }

    function checkLowStock() {
      const notice = document.getElementById('pdLowStock');
      const stock = selectedSize ? (product.stock?.[selectedSize] ?? 99) : 99;
      notice.style.display = stock > 0 && stock < 5 ? 'block' : 'none';
    }
    checkLowStock();

    document.getElementById('addToCartBtn').addEventListener('click', () => {
      Cart.add(product);
    });

    // tabs
    document.querySelectorAll('.pd-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pd-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.pd-tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelector(`.pd-tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
      });
    });

    // size guide sub-tabs
    document.querySelectorAll('.size-guide-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.size-guide-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.size-guide-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelector(`.size-guide-panel[data-sgpanel="${btn.dataset.sg}"]`).classList.add('active');
      });
    });
  });
}

/* ===================== INIT ===================== */

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initScrollTop();
  initHeroSlider();
  initNewsletterForms();
  initCategoryPage();
  initProductPage();
});