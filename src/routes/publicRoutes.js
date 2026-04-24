const express = require('express');
const Stripe = require('stripe');
const { query, pool } = require('../config/db');
const { sendOrderEmails } = require('../services/emailService');

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const company = {
  name: 'Flori de Mai Bujori',
  phoneMain: '0722747762',
  phoneSecondary: '+40 7XX XXX XXX',
  whatsappLink: 'https://wa.me/40722747762',
  social: {
    instagram: 'https://instagram.com/flori_de_mai_bujori',
    facebook: 'https://facebook.com',
    tiktok: 'https://tiktok.com'
  }
};

const COUPONS = {
  BUNVENIT10: 10,
  BUJORI5: 5
};

async function loadHomeContent() {
  const result = await query('SELECT * FROM site_content');
  return result.rows.reduce((acc, row) => {
    acc[row.section_key] = row;
    return acc;
  }, {});
}

async function getActiveProducts(limit) {
  const params = [];
  let limitClause = '';

  if (limit) {
    params.push(limit);
    limitClause = `LIMIT $${params.length}`;
  }

  const result = await query(
    `
    SELECT p.*, img.image_path AS cover_image
    FROM products p
    LEFT JOIN LATERAL (
      SELECT image_path
      FROM product_images
      WHERE product_id = p.id
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    ) img ON TRUE
    WHERE p.active = TRUE
    ORDER BY p.created_at DESC
    ${limitClause}
    `,
    params
  );

  return result.rows;
}

async function getTrustReviews(limit = 6) {
  const summaryResult = await query(
    `
    SELECT
      COUNT(*)::int AS total_count,
      COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating
    FROM reviews
    WHERE product_id IS NULL AND is_public = TRUE
    `
  );

  const listResult = await query(
    `
    SELECT *
    FROM reviews
    WHERE product_id IS NULL AND is_public = TRUE AND rating = 5
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return {
    summary: {
      totalCount: Number(summaryResult.rows[0].total_count || 0),
      avgRating: Number(summaryResult.rows[0].avg_rating || 0)
    },
    reviews: listResult.rows
  };
}

async function getProductReviews(productId, limit = 20) {
  const summaryResult = await query(
    `
    SELECT
      COUNT(*)::int AS total_count,
      COALESCE(AVG(rating), 0)::numeric(10,2) AS avg_rating
    FROM reviews
    WHERE product_id = $1 AND is_public = TRUE
    `,
    [productId]
  );

  const listResult = await query(
    `
    SELECT *
    FROM reviews
    WHERE product_id = $1 AND is_public = TRUE
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [productId, limit]
  );

  return {
    summary: {
      totalCount: Number(summaryResult.rows[0].total_count || 0),
      avgRating: Number(summaryResult.rows[0].avg_rating || 0)
    },
    reviews: listResult.rows
  };
}

function createOrderNumber(orderId) {
  const year = new Date().getFullYear();
  return `CMD-${year}-${String(orderId).padStart(5, '0')}`;
}

function getCouponDiscountPercent(couponCode) {
  if (!couponCode) {
    return 0;
  }

  const key = String(couponCode).trim().toUpperCase();
  return COUPONS[key] || 0;
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      productId: Number(item.productId),
      qty: Number(item.qty)
    }))
    .filter((item) => item.productId > 0 && item.qty > 0);
}

async function dispatchOrderEmails(order, items, contextLabel) {
  try {
    const result = await sendOrderEmails({ order, items });
    if (!result?.sent) {
      console.warn(`Email netrimis (${contextLabel}): ${result?.reason || 'unknown'}`, result?.details || {});
    } else {
      console.log(`Email trimis (${contextLabel}) pentru comanda ${order.order_number || order.id}.`);
    }
  } catch (emailError) {
    console.error(`Eroare trimitere email (${contextLabel}):`, emailError.message);
  }
}

async function createOrder(payload) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let subtotal = 0;
    let payableNowSubtotal = 0;
    const hydrated = [];

    for (const item of payload.items) {
      const productResult = await client.query(
        'SELECT id, name, price, active, availability_mode, preorder_deposit_percent FROM products WHERE id = $1',
        [item.productId]
      );
      const product = productResult.rows[0];

      if (!product || !product.active) {
        throw new Error('Un produs din cos nu mai este disponibil.');
      }

      const productPrice = Number(product.price);
      const lineTotal = productPrice * item.qty;
      subtotal += lineTotal;

      const isPreorder = product.availability_mode === 'preorder';
      const rawDepositPercent = Number(product.preorder_deposit_percent || 50);
      const preorderDepositPercent = Number.isFinite(rawDepositPercent)
        ? Math.min(90, Math.max(10, rawDepositPercent))
        : 50;
      const payableLineTotal = isPreorder
        ? lineTotal * (preorderDepositPercent / 100)
        : lineTotal;
      payableNowSubtotal += payableLineTotal;

      hydrated.push({
        productId: product.id,
        productName: product.name,
        productPrice,
        availabilityMode: product.availability_mode,
        preorderDepositPercent,
        quantity: item.qty,
        lineTotal
      });
    }

    const hasPreorderItems = hydrated.some((item) => item.availabilityMode === 'preorder');
    if (hasPreorderItems && payload.paymentMethod === 'ramburs') {
      throw new Error('Produsele in precomanda pot fi achitate doar cu cardul.');
    }

    const discountPercent = getCouponDiscountPercent(payload.couponCode);
    const discountAmount = Number(((subtotal * discountPercent) / 100).toFixed(2));
    const payableRatio = subtotal > 0 ? (payableNowSubtotal / subtotal) : 0;
    const payableDiscountAmount = Number((discountAmount * payableRatio).toFixed(2));
    const payableNowTotal = Number((payableNowSubtotal - payableDiscountAmount).toFixed(2));
    const normalizedCoupon = discountPercent > 0 ? String(payload.couponCode).trim().toUpperCase() : null;
    const paymentStatus = payload.paymentMethod === 'ramburs' ? 'neplatit' : 'in asteptare';

    const orderInsert = await client.query(
      `
      INSERT INTO orders
      (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_note, coupon_code, discount_percent, discount_amount, subtotal_amount, total_amount, payment_method, payment_status, order_status, source, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'noua', 'site', NOW(), NOW())
      RETURNING *
      `,
      [
        payload.customerName,
        payload.customerPhone,
        payload.customerEmail,
        payload.customerAddress,
        payload.customerCity,
        payload.customerNote || null,
        normalizedCoupon,
        discountPercent,
        discountAmount,
        Number(subtotal.toFixed(2)),
        payableNowTotal,
        payload.paymentMethod,
        paymentStatus
      ]
    );

    const order = orderInsert.rows[0];
    const orderNumber = createOrderNumber(order.id);

    await client.query('UPDATE orders SET order_number = $1 WHERE id = $2', [orderNumber, order.id]);

    for (const item of hydrated) {
      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity, line_total)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          order.id,
          item.productId,
          item.productName,
          Number(item.productPrice.toFixed(2)),
          item.quantity,
          Number(item.lineTotal.toFixed(2))
        ]
      );
    }

    const finalOrderResult = await client.query('SELECT * FROM orders WHERE id = $1', [order.id]);

    await client.query('COMMIT');

    return {
      order: finalOrderResult.rows[0],
      items: hydrated.map((item) => ({
        product_name: item.productName,
        quantity: item.quantity,
        line_total: Number(item.lineTotal.toFixed(2))
      }))
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.get('/', async (req, res) => {
  const content = await loadHomeContent();
  const featuredProducts = await getActiveProducts(3);
  const trust = await getTrustReviews(3);

  res.render('pages/home', {
    pageTitle: 'Acasa',
    company,
    content,
    trust,
    featuredProducts,
    currentPath: req.path
  });
});

router.get('/despre-noi', async (req, res) => {
  const content = await loadHomeContent();

  res.render('pages/about', {
    pageTitle: 'Despre noi',
    company,
    content,
    currentPath: req.path
  });
});

router.get('/servicii', (req, res) => {
  res.render('pages/services', {
    pageTitle: 'Servicii',
    company,
    currentPath: req.path
  });
});

router.get('/magazin', async (req, res) => {
  const categoriesResult = await query(
    'SELECT DISTINCT category FROM products WHERE active = TRUE ORDER BY category ASC'
  );
  const products = await getActiveProducts();

  res.render('pages/shop', {
    pageTitle: 'Magazin',
    company,
    categories: categoriesResult.rows,
    products,
    currentPath: req.path
  });
});

router.get('/magazin/produs/:id', async (req, res) => {
  const productId = Number(req.params.id);
  const productResult = await query(
    'SELECT * FROM products WHERE id = $1 AND active = TRUE',
    [productId]
  );
  const product = productResult.rows[0];

  if (!product) {
    return res.status(404).render('pages/not-found', {
      pageTitle: 'Pagina inexistenta',
      company,
      currentPath: req.path
    });
  }

  const imagesResult = await query(
    'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC',
    [product.id]
  );

  const relatedResult = await query(
    `
    SELECT p.*, img.image_path AS cover_image
    FROM products p
    LEFT JOIN LATERAL (
      SELECT image_path
      FROM product_images
      WHERE product_id = p.id
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    ) img ON TRUE
    WHERE p.active = TRUE AND p.category = $1 AND p.id <> $2
    ORDER BY p.created_at DESC
    LIMIT 3
    `,
    [product.category, product.id]
  );

  const productReviewData = await getProductReviews(product.id, 12);

  res.render('pages/product-detail', {
    pageTitle: product.name,
    company,
    product,
    images: imagesResult.rows,
    related: relatedResult.rows,
    productReviewData,
    currentPath: '/magazin'
  });
});

router.get('/cos', (req, res) => {
  res.render('pages/cart', {
    pageTitle: 'Cos',
    company,
    currentPath: req.path
  });
});

router.post('/api/comenzi', async (req, res) => {
  console.log('[checkout] POST /api/comenzi start');
  const {
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customerCity,
    customerNote,
    paymentMethod,
    couponCode,
    items
  } = req.body;

  if (!customerName || !customerPhone || !customerEmail || !customerAddress || !customerCity) {
    console.warn('[checkout] invalid payload: missing required fields');
    return res.status(400).json({ ok: false, message: 'Completeaza campurile obligatorii, inclusiv email.' });
  }

  if (!['ramburs', 'card'].includes(paymentMethod)) {
    console.warn('[checkout] invalid payment method:', paymentMethod);
    return res.status(400).json({ ok: false, message: 'Metoda de plata invalida.' });
  }

  if (paymentMethod === 'card' && !stripe) {
    console.error('[checkout] stripe missing configuration for card payment');
    return res.status(500).json({ ok: false, message: 'Stripe nu este configurat pe server.' });
  }

  const normalizedItems = normalizeItems(items);
  if (!normalizedItems.length) {
    console.warn('[checkout] empty cart payload');
    return res.status(400).json({ ok: false, message: 'Cosul este gol.' });
  }

  try {
    const result = await createOrder({
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      customerCity,
      customerNote,
      paymentMethod,
      couponCode,
      items: normalizedItems
    });

    if (paymentMethod === 'card') {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: customerEmail,
        success_url: `${baseUrl}/comanda/plata-succes?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/comanda/plata-anulata?orderId=${result.order.id}`,
        metadata: {
          orderId: String(result.order.id),
          orderNumber: result.order.order_number
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'ron',
              product_data: {
                name: `Comanda ${result.order.order_number}`,
                description: 'Plata online pentru comanda de pe site Flori de Mai Bujori'
              },
              unit_amount: Math.round(Number(result.order.total_amount) * 100)
            }
          }
        ]
      });

      await query(
        'UPDATE orders SET stripe_session_id = $1, updated_at = NOW() WHERE id = $2',
        [session.id, result.order.id]
      );

      return res.json({
        ok: true,
        paymentMethod: 'card',
        requiresRedirect: true,
        url: session.url
      });
    }

    await dispatchOrderEmails(result.order, result.items, 'comanda ramburs');
    console.log('[checkout] order created (ramburs):', result.order.order_number || result.order.id);

    return res.json({
      ok: true,
      paymentMethod: 'ramburs',
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      message: 'Comanda a fost inregistrata cu succes.'
    });
  } catch (error) {
    console.error('[checkout] create order failed:', error.message);
    return res.status(400).json({ ok: false, message: error.message || 'Nu am putut salva comanda.' });
  }
});

router.get('/comanda/plata-succes', async (req, res) => {
  console.log('[checkout] GET /comanda/plata-succes start');
  if (!stripe) {
    return res.redirect('/cos');
  }

  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.redirect('/cos');
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    const orderResult = await query('SELECT * FROM orders WHERE stripe_session_id = $1', [session.id]);
    const order = orderResult.rows[0];

    if (!order) {
      return res.status(404).render('pages/not-found', {
        pageTitle: 'Pagina inexistenta',
        company,
        currentPath: req.path
      });
    }

    const wasPaidBefore = ['platit', 'avans platit'].includes(order.payment_status);

    if (session.payment_status === 'paid') {
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;
      const subtotalAmount = Number(order.subtotal_amount || 0);
      const discountAmount = Number(order.discount_amount || 0);
      const payableNowAmount = Number(order.total_amount || 0);
      const fullOrderAmount = Number((subtotalAmount - discountAmount).toFixed(2));
      const remainingAmount = Number((fullOrderAmount - payableNowAmount).toFixed(2));
      const nextPaymentStatus = remainingAmount > 0 ? 'avans platit' : 'platit';

      await query(
        `
        UPDATE orders
        SET payment_status = $1, stripe_payment_intent_id = $2, updated_at = NOW()
        WHERE id = $3
        `,
        [nextPaymentStatus, paymentIntentId, order.id]
      );
    }

    const updatedOrderResult = await query('SELECT * FROM orders WHERE id = $1', [order.id]);
    const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);
    const updatedOrder = updatedOrderResult.rows[0];

    if (!wasPaidBefore && ['platit', 'avans platit'].includes(updatedOrder.payment_status)) {
      await dispatchOrderEmails(updatedOrder, itemsResult.rows, 'plata stripe');
    }
    console.log('[checkout] payment success completed for order:', updatedOrder.order_number || updatedOrder.id);

    return res.render('pages/order-success', {
      pageTitle: 'Comanda platita',
      company,
      order: updatedOrder,
      orderItems: itemsResult.rows,
      paymentInfo: 'Plata online a fost confirmata cu succes.',
      currentPath: '/cos'
    });
  } catch (error) {
    console.error(error);
    return res.redirect('/comanda/plata-anulata');
  }
});

router.get('/comanda/plata-anulata', (req, res) => {
  res.render('pages/order-cancelled', {
    pageTitle: 'Plata anulata',
    company,
    currentPath: '/cos'
  });
});

router.get('/comanda/confirmare/:id', async (req, res) => {
  const orderId = Number(req.params.id);
  const orderResult = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = orderResult.rows[0];

  if (!order) {
    return res.status(404).render('pages/not-found', {
      pageTitle: 'Pagina inexistenta',
      company,
      currentPath: req.path
    });
  }

  const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);

  res.render('pages/order-success', {
    pageTitle: 'Comanda trimisa',
    company,
    order,
    orderItems: itemsResult.rows,
    paymentInfo: null,
    currentPath: '/cos'
  });
});

router.post('/api/recenzii/incredere', async (req, res) => {
  const { reviewerName, reviewerEmail, rating, title, message } = req.body;
  const normalizedEmail = String(reviewerEmail || '').trim().toLowerCase();
  const numericRating = Number(rating);

  if (!reviewerName || !normalizedEmail || !title || !message || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ ok: false, message: 'Completeaza toate campurile recenziei.' });
  }

  const orderCheck = await query(
    `
    SELECT id
    FROM orders
    WHERE LOWER(customer_email) = $1
    LIMIT 1
    `,
    [normalizedEmail]
  );

  if (!orderCheck.rows.length) {
    return res.status(403).json({
      ok: false,
      message: 'Nu putem valida recenzia. Emailul nu este asociat cu nicio comanda.'
    });
  }

  await query(
    `
    INSERT INTO reviews
    (product_id, reviewer_name, reviewer_email, rating, title, message, is_verified_purchase, is_public, created_at, updated_at)
    VALUES (NULL, $1, $2, $3, $4, $5, TRUE, TRUE, NOW(), NOW())
    `,
    [reviewerName.trim(), normalizedEmail, numericRating, title.trim(), message.trim()]
  );

  return res.json({ ok: true, message: 'Recenzia a fost trimisa cu succes. Multumim!' });
});

router.post('/api/recenzii/produs/:id', async (req, res) => {
  const productId = Number(req.params.id);
  const { reviewerName, reviewerEmail, rating, title, message } = req.body;
  const normalizedEmail = String(reviewerEmail || '').trim().toLowerCase();
  const numericRating = Number(rating);

  if (!productId) {
    return res.status(400).json({ ok: false, message: 'Produs invalid.' });
  }

  if (!reviewerName || !normalizedEmail || !title || !message || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ ok: false, message: 'Completeaza toate campurile recenziei.' });
  }

  const productCheck = await query('SELECT id FROM products WHERE id = $1 AND active = TRUE', [productId]);
  if (!productCheck.rows.length) {
    return res.status(404).json({ ok: false, message: 'Produsul nu este disponibil.' });
  }

  const orderCheck = await query(
    `
    SELECT oi.id
    FROM orders o
    INNER JOIN order_items oi ON oi.order_id = o.id
    WHERE LOWER(o.customer_email) = $1 AND oi.product_id = $2
    LIMIT 1
    `,
    [normalizedEmail, productId]
  );

  if (!orderCheck.rows.length) {
    return res.status(403).json({
      ok: false,
      message: 'Nu putem valida recenzia pentru acest produs. Emailul nu are comanda aferenta.'
    });
  }

  await query(
    `
    INSERT INTO reviews
    (product_id, reviewer_name, reviewer_email, rating, title, message, is_verified_purchase, is_public, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE, NOW(), NOW())
    `,
    [productId, reviewerName.trim(), normalizedEmail, numericRating, title.trim(), message.trim()]
  );

  return res.json({ ok: true, message: 'Recenzia produsului a fost trimisa cu succes.' });
});

router.get('/blog', (req, res) => {
  const posts = [
    {
      title: 'Cum alegi bujorii potriviti pentru cadou',
      excerpt: 'Un ghid scurt despre culori, semnificatii si stiluri potrivite pentru fiecare ocazie.',
      date: '08 aprilie 2026',
      readTime: '4 min'
    },
    {
      title: 'Ghid de ingrijire pentru buchete proaspete',
      excerpt: 'Pasi simpli pentru a pastra florile frumoase mai mult timp dupa livrare.',
      date: '27 martie 2026',
      readTime: '5 min'
    },
    {
      title: 'Tendinte florale pentru evenimente intime',
      excerpt: 'Combinatii elegante si naturale pentru mese, colt foto si decor de poveste.',
      date: '14 martie 2026',
      readTime: '6 min'
    }
  ];

  res.render('pages/blog', {
    pageTitle: 'Blog',
    company,
    posts,
    currentPath: req.path
  });
});

router.get('/evenimente', async (req, res) => {
  const eventsResult = await query(
    `
    SELECT id, title, event_date, location, description, image_path
    FROM events
    WHERE active = TRUE
    ORDER BY sort_order ASC, event_date ASC, id ASC
    `
  );

  const events = eventsResult.rows.map((event) => {
    const dateObj = new Date(event.event_date);
    const dateLabel = Number.isNaN(dateObj.getTime())
      ? ''
      : dateObj.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long' });

    return {
      ...event,
      date: dateLabel
    };
  });

  res.render('pages/events', {
    pageTitle: 'Evenimente',
    company,
    events,
    currentPath: req.path
  });
});

router.get('/contact', (req, res) => {
  res.render('pages/contact', {
    pageTitle: 'Contact',
    company,
    currentPath: req.path,
    formSuccess: req.query.success === '1'
  });
});

router.post('/contact', (req, res) => {
  res.redirect('/contact?success=1');
});

module.exports = router;
