(function () {
  const menuBtn = document.querySelector('[data-mobile-menu-btn]');
  const mobileMenu = document.querySelector('[data-mobile-menu]');

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', function () {
      mobileMenu.classList.toggle('open');
    });
  }

  const CART_KEY = 'atelier_bujori_cart';
  const COUPON_KEY = 'atelier_bujori_coupon';
  const TOAST_ROOT_ID = 'toast-root';

  function getToastRoot() {
    let root = document.getElementById(TOAST_ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = TOAST_ROOT_ID;
      root.className = 'toast-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function showToast(message) {
    const root = getToastRoot();
    const toast = document.createElement('div');
    toast.className = 'toast toast-pink';
    toast.textContent = message;
    root.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, 1800);
  }

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch (error) {
      return [];
    }
  }

  function saveCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    updateCartBadge();
  }

  function clearCart() {
    localStorage.removeItem(CART_KEY);
    updateCartBadge();
  }

  function getCouponCode() {
    return localStorage.getItem(COUPON_KEY) || '';
  }

  function setCouponCode(code) {
    if (code) {
      localStorage.setItem(COUPON_KEY, code);
    } else {
      localStorage.removeItem(COUPON_KEY);
    }
  }

  function getCartItemsCount() {
    return getCart().reduce((sum, item) => sum + Number(item.qty || 0), 0);
  }

  function updateCartBadge() {
    const count = getCartItemsCount();
    document.querySelectorAll('[data-cart-count]').forEach((badge) => {
      badge.textContent = String(count);
      badge.classList.toggle('is-empty', count === 0);
    });
  }

  updateCartBadge();

  document.querySelectorAll('[data-notify]').forEach((element) => {
    element.addEventListener('click', function () {
      const message = element.dataset.notifyText || 'Actiune executata.';
      showToast(message);
    });
  });

  document.querySelectorAll('[data-product-card]').forEach((card) => {
    const goToProduct = function () {
      const url = card.dataset.productUrl;
      if (url) {
        window.location.href = url;
      }
    };

    card.addEventListener('click', function (event) {
      if (event.target.closest('a, button, input, textarea, select, label')) {
        return;
      }
      goToProduct();
    });

    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goToProduct();
      }
    });
  });

  const categoryFilters = Array.from(document.querySelectorAll('[data-category-filter]'));
  const categoryItems = Array.from(document.querySelectorAll('[data-category-item]'));

  if (categoryFilters.length && categoryItems.length) {
    const setCategory = function (categoryValue) {
      const normalized = String(categoryValue || '').trim().toLowerCase();

      categoryFilters.forEach((btn) => {
        const isActive = btn.dataset.categoryValue === normalized;
        btn.classList.toggle('chip-is-active', isActive);
      });

      categoryItems.forEach((item) => {
        const itemCategory = String(item.dataset.category || '').trim().toLowerCase();
        const shouldShow = normalized === 'toate' || itemCategory === normalized;
        item.style.display = shouldShow ? '' : 'none';
      });
    };

    categoryFilters.forEach((button) => {
      button.addEventListener('click', function () {
        setCategory(button.dataset.categoryValue);
      });
    });
  }

  document.querySelectorAll('[data-image-gallery]').forEach((gallery) => {
    const mainImage = gallery.querySelector('[data-main-image]');
    const thumbs = Array.from(gallery.querySelectorAll('[data-thumb-image]'));

    if (!mainImage || !thumbs.length) {
      return;
    }

    thumbs.forEach((thumb) => {
      thumb.addEventListener('click', function () {
        const newSrc = thumb.getAttribute('src');
        const newAlt = thumb.getAttribute('alt') || mainImage.getAttribute('alt') || '';

        if (!newSrc) {
          return;
        }

        mainImage.setAttribute('src', newSrc);
        mainImage.setAttribute('alt', newAlt);

        thumbs.forEach((img) => img.classList.remove('is-active'));
        thumb.classList.add('is-active');
      });
    });
  });

  document.querySelectorAll('[data-add-to-cart]').forEach((button) => {
    button.addEventListener('click', function () {
      const item = {
        id: Number(button.dataset.productId),
        name: button.dataset.productName,
        price: Number(button.dataset.productPrice),
        qty: 1
      };

      const cart = getCart();
      const existing = cart.find((i) => i.id === item.id);

      if (existing) {
        existing.qty += 1;
      } else {
        cart.push(item);
      }

      saveCart(cart);
      const initialLabel = button.classList.contains('btn-ghost') ? 'Adauga' : 'Adauga in cos';
      button.textContent = 'Adaugat';
      showToast('Produs adaugat in cos.');
      setTimeout(() => {
        button.textContent = initialLabel;
      }, 900);
    });
  });

  const cartPanel = document.querySelector('[data-cart-panel]');
  const checkoutForm = document.querySelector('[data-checkout-form]');
  const checkoutError = document.querySelector('[data-checkout-error]');
  const reserveSection = document.querySelector('[data-checkout-reserve]');
  const modeButtons = document.querySelectorAll('[data-mode-toggle]');
  const couponInput = document.querySelector('[data-coupon-input]');
  const applyCouponButton = document.querySelector('[data-apply-coupon]');
  const couponFeedback = document.querySelector('[data-coupon-feedback]');
  const whatsappReserve = document.querySelector('[data-whatsapp-reserve]');
  const whatsappQuestions = document.querySelector('[data-whatsapp-questions]');
  const reviewForms = document.querySelectorAll('[data-review-form]');
  const reviewToggleButtons = document.querySelectorAll('[data-review-toggle]');

  function buildWhatsAppCartMessage(prefix) {
    const cart = getCart();
    const summary = cart.length
      ? cart.map((item) => `${item.name} (${item.qty} buc)`).join(', ')
      : 'fara produse selectate';
    const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
    return encodeURIComponent(`${prefix}: ${summary}. Total estimat ${total.toFixed(2)} lei.`);
  }

  function updateWhatsAppLinks() {
    if (whatsappReserve) {
      whatsappReserve.href = `https://wa.me/40722747762?text=${buildWhatsAppCartMessage('Salut! Doresc rezervare in magazin')}`;
    }

    if (whatsappQuestions) {
      whatsappQuestions.href = `https://wa.me/40722747762?text=${buildWhatsAppCartMessage('Salut! Am intrebari despre comanda')}`;
    }
  }

  function setMode(mode) {
    modeButtons.forEach((button) => {
      const active = button.dataset.modeToggle === mode;
      button.classList.toggle('is-active', active);
      if (active) {
        button.classList.remove('btn-secondary', 'btn-primary');
        button.classList.add('btn-primary');
      } else {
        button.classList.remove('btn-primary');
        button.classList.add('btn-secondary');
      }
    });

    if (reserveSection) {
      reserveSection.classList.toggle('is-hidden', mode !== 'rezerva');
    }

    if (checkoutForm) {
      checkoutForm.classList.toggle('is-hidden', mode !== 'comanda');
    }
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', function () {
      setMode(button.dataset.modeToggle);
    });
  });

  const validCoupons = {
    BUNVENIT10: 10,
    BUJORI5: 5
  };

  function getAppliedCoupon() {
    const code = getCouponCode().trim().toUpperCase();
    const percent = validCoupons[code] || 0;
    return { code, percent };
  }

  function renderCart() {
    const cart = getCart();

    if (!cart.length) {
      cartPanel.innerHTML = '<p>Cosul este gol momentan.</p>';
      if (checkoutForm) {
        checkoutForm.querySelector('button[type="submit"]').disabled = true;
      }
      updateWhatsAppLinks();
      return;
    }

    let subtotal = 0;
    const list = document.createElement('div');

    cart.forEach((item, index) => {
      subtotal += item.price * item.qty;

      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <strong>${item.name}</strong>
          <p>${item.qty} x ${item.price.toFixed(2)} lei</p>
        </div>
        <div class="btn-mini-row">
          <button class="btn btn-ghost btn-small" data-qty-dec="${index}">-</button>
          <button class="btn btn-ghost btn-small" data-qty-inc="${index}">+</button>
          <button class="btn btn-danger btn-small" data-remove-index="${index}">Sterge</button>
        </div>
      `;
      list.appendChild(row);
    });

    const coupon = getAppliedCoupon();
    const discount = Number(((subtotal * coupon.percent) / 100).toFixed(2));
    const total = Number((subtotal - discount).toFixed(2));

    const totalBox = document.createElement('div');
    totalBox.className = 'cart-totals';
    totalBox.innerHTML = `
      <p><span>Subtotal</span><strong>${subtotal.toFixed(2)} lei</strong></p>
      <p><span>Reducere</span><strong>-${discount.toFixed(2)} lei</strong></p>
      <p class="grand-total"><span>Total</span><strong>${total.toFixed(2)} lei</strong></p>
    `;

    cartPanel.innerHTML = '';
    cartPanel.appendChild(list);
    cartPanel.appendChild(totalBox);

    cartPanel.querySelectorAll('[data-remove-index]').forEach((button) => {
      button.addEventListener('click', function () {
        const next = getCart();
        next.splice(Number(button.dataset.removeIndex), 1);
        saveCart(next);
        renderCart();
      });
    });

    cartPanel.querySelectorAll('[data-qty-inc]').forEach((button) => {
      button.addEventListener('click', function () {
        const next = getCart();
        const idx = Number(button.dataset.qtyInc);
        next[idx].qty += 1;
        saveCart(next);
        renderCart();
      });
    });

    cartPanel.querySelectorAll('[data-qty-dec]').forEach((button) => {
      button.addEventListener('click', function () {
        const next = getCart();
        const idx = Number(button.dataset.qtyDec);
        next[idx].qty -= 1;

        if (next[idx].qty <= 0) {
          next.splice(idx, 1);
        }

        saveCart(next);
        renderCart();
      });
    });

    if (checkoutForm) {
      checkoutForm.querySelector('button[type="submit"]').disabled = false;
    }

    updateWhatsAppLinks();
  }

  reviewForms.forEach((form) => {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const type = form.dataset.reviewType;
      const productId = form.dataset.productId;
      const formData = new FormData(form);

      const payload = {
        reviewerName: formData.get('reviewerName'),
        reviewerEmail: formData.get('reviewerEmail'),
        rating: Number(formData.get('rating')),
        title: formData.get('title'),
        message: formData.get('message')
      };

      const endpoint = type === 'product'
        ? `/api/recenzii/produs/${productId}`
        : '/api/recenzii/incredere';

      const submitButton = form.querySelector('button[type="submit"]');
      const initialLabel = submitButton ? submitButton.textContent : '';
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Se trimite...';
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.message || 'Nu am putut trimite recenzia.');
        }

        showToast(data.message || 'Recenzie trimisa.');
        form.reset();

        if (type === 'trust') {
          const panel = document.querySelector('[data-trust-review-panel]');
          if (panel) {
            panel.classList.add('is-hidden');
          }
        } else {
          setTimeout(() => window.location.reload(), 700);
        }
      } catch (error) {
        showToast(error.message || 'Eroare la trimiterea recenziei.');
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = initialLabel || 'Trimite recenzie';
        }
      }
    });
  });

  reviewToggleButtons.forEach((button) => {
    button.addEventListener('click', function () {
      const target = document.querySelector(button.dataset.target);
      if (!target) {
        return;
      }
      target.classList.toggle('is-hidden');
      if (!target.classList.contains('is-hidden')) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  if (cartPanel) {
    if (couponInput) {
      couponInput.value = getCouponCode();
    }

    if (applyCouponButton && couponInput) {
      applyCouponButton.addEventListener('click', function () {
        const code = couponInput.value.trim().toUpperCase();

        if (!code) {
          setCouponCode('');
          if (couponFeedback) {
            couponFeedback.textContent = 'Introdu un cod de reducere sau lasa campul gol.';
          }
          renderCart();
          return;
        }

        if (!validCoupons[code]) {
          if (couponFeedback) {
            couponFeedback.textContent = 'Cod invalid. Incearca BUNVENIT10 sau BUJORI5.';
          }
          showToast('Cod de reducere invalid.');
          return;
        }

        setCouponCode(code);
        if (couponFeedback) {
          couponFeedback.textContent = `Cod aplicat: ${code} (${validCoupons[code]}% reducere).`;
        }
        showToast(`Cod ${code} aplicat.`);
        renderCart();
      });
    }

    renderCart();
    setMode('rezerva');
  }

  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      const cart = getCart();
      if (!cart.length) {
        if (checkoutError) {
          checkoutError.hidden = false;
          checkoutError.textContent = 'Cosul este gol. Adauga produse inainte de trimitere.';
        }
        return;
      }

      const formData = new FormData(checkoutForm);
      const payload = {
        customerName: formData.get('customerName'),
        customerPhone: formData.get('customerPhone'),
        customerEmail: formData.get('customerEmail'),
        customerAddress: formData.get('customerAddress'),
        customerCity: formData.get('customerCity'),
        customerNote: formData.get('customerNote'),
        paymentMethod: formData.get('paymentMethod'),
        couponCode: getCouponCode(),
        items: cart.map((item) => ({ productId: item.id, qty: item.qty }))
      };

      const submitButton = checkoutForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = 'Se trimite...';

      if (checkoutError) {
        checkoutError.hidden = true;
        checkoutError.textContent = '';
      }

      try {
        const response = await fetch('/api/comenzi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.message || 'Nu am putut salva comanda.');
        }

        if (data.requiresRedirect && data.url) {
          window.location.href = data.url;
          return;
        }

        clearCart();
        setCouponCode('');
        window.location.href = `/comanda/confirmare/${data.orderId}`;
      } catch (error) {
        if (checkoutError) {
          checkoutError.hidden = false;
          checkoutError.textContent = error.message;
        }
        submitButton.disabled = false;
        submitButton.textContent = 'Trimite comanda';
      }
    });
  }
})();
