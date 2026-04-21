const express = require('express');
const multer = require('multer');
const { query } = require('../config/db');
const { hashPassword, safeCompare } = require('../utils/security');
const { requireAuth } = require('../middleware/auth');
const { makeSlug } = require('../utils/slug');
const { uploadImage, removeImage } = require('../services/storageService');

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Se accepta doar fisiere imagine.'));
  }
});

const contentStorage = multer.memoryStorage();

const uploadContent = multer({
  storage: contentStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Se accepta doar fisiere imagine.'));
  }
});

async function getProductsForAdmin() {
  const result = await query(`
    SELECT p.*, img.image_path AS cover_image
    FROM products p
    LEFT JOIN LATERAL (
      SELECT image_path
      FROM product_images
      WHERE product_id = p.id
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    ) img ON TRUE
    ORDER BY p.updated_at DESC
  `);

  return result.rows;
}

async function getOrdersForAdmin() {
  const result = await query(`
    SELECT o.*, COUNT(oi.id)::int AS items_count
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `);

  return result.rows;
}

async function getTrustReviewsForAdmin() {
  const result = await query(
    `
    SELECT *
    FROM reviews
    WHERE product_id IS NULL
    ORDER BY created_at DESC
    `
  );
  return result.rows;
}

async function getEventsForAdmin() {
  const result = await query(`
    SELECT *
    FROM events
    ORDER BY sort_order ASC, event_date ASC, id ASC
  `);

  return result.rows;
}

router.get('/login', (req, res) => {
  if (req.session.admin) {
    return res.redirect('/admin');
  }

  res.render('admin/login', {
    pageTitle: 'Login admin',
    error: null
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const adminResult = await query('SELECT * FROM admins WHERE username = $1', [username]);
  const admin = adminResult.rows[0];

  if (!admin) {
    return res.status(401).render('admin/login', {
      pageTitle: 'Login admin',
      error: 'Datele de autentificare nu sunt corecte.'
    });
  }

  const valid = safeCompare(hashPassword(password || ''), admin.password_hash);
  if (!valid) {
    return res.status(401).render('admin/login', {
      pageTitle: 'Login admin',
      error: 'Datele de autentificare nu sunt corecte.'
    });
  }

  req.session.admin = {
    id: admin.id,
    username: admin.username
  };

  return res.redirect('/admin');
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/', requireAuth, async (req, res) => {
  const [
    products,
    activeProducts,
    hiddenProducts,
    orders,
    newOrders,
    recentProducts,
    recentOrders
  ] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM products'),
    query('SELECT COUNT(*)::int AS count FROM products WHERE active = TRUE'),
    query('SELECT COUNT(*)::int AS count FROM products WHERE active = FALSE'),
    query('SELECT COUNT(*)::int AS count FROM orders'),
    query("SELECT COUNT(*)::int AS count FROM orders WHERE order_status = 'noua'"),
    getProductsForAdmin(),
    getOrdersForAdmin()
  ]);

  const counts = {
    products: products.rows[0].count,
    activeProducts: activeProducts.rows[0].count,
    hiddenProducts: hiddenProducts.rows[0].count,
    orders: orders.rows[0].count,
    newOrders: newOrders.rows[0].count
  };

  res.render('admin/dashboard', {
    pageTitle: 'Dashboard',
    admin: req.session.admin,
    counts,
    recentProducts: recentProducts.slice(0, 5),
    recentOrders: recentOrders.slice(0, 5)
  });
});

router.get('/comenzi', requireAuth, async (req, res) => {
  const orders = await getOrdersForAdmin();

  res.render('admin/orders-list', {
    pageTitle: 'Comenzi',
    admin: req.session.admin,
    orders,
    message: req.query.message || ''
  });
});

router.get('/evenimente', requireAuth, async (req, res) => {
  const events = await getEventsForAdmin();

  res.render('admin/events-list', {
    pageTitle: 'Evenimente',
    admin: req.session.admin,
    events,
    message: req.query.message || ''
  });
});

router.get('/evenimente/nou', requireAuth, (req, res) => {
  res.render('admin/event-form', {
    pageTitle: 'Eveniment nou',
    admin: req.session.admin,
    event: null,
    mode: 'create',
    message: req.query.message || ''
  });
});

router.post('/evenimente', requireAuth, uploadContent.single('image'), async (req, res) => {
  const { title, event_date, location, description, active, sort_order } = req.body;
  const imagePath = req.file ? await uploadImage(req.file, 'site') : null;

  await query(
    `
    INSERT INTO events (title, event_date, location, description, image_path, active, sort_order, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    `,
    [
      String(title || '').trim(),
      event_date,
      String(location || '').trim(),
      String(description || '').trim(),
      imagePath,
      active === '1',
      Number(sort_order || 0)
    ]
  );

  res.redirect('/admin/evenimente?message=Eveniment+adaugat');
});

router.get('/evenimente/:id/editare', requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const eventResult = await query('SELECT * FROM events WHERE id = $1', [eventId]);
  const event = eventResult.rows[0];

  if (!event) {
    return res.redirect('/admin/evenimente?message=Evenimentul+nu+a+fost+gasit');
  }

  res.render('admin/event-form', {
    pageTitle: `Editare ${event.title}`,
    admin: req.session.admin,
    event,
    mode: 'edit',
    message: req.query.message || ''
  });
});

router.post('/evenimente/:id', requireAuth, uploadContent.single('image'), async (req, res) => {
  const eventId = Number(req.params.id);
  const { title, event_date, location, description, active, sort_order } = req.body;
  const existingResult = await query('SELECT image_path FROM events WHERE id = $1', [eventId]);
  const existingEvent = existingResult.rows[0];

  if (!existingEvent) {
    return res.redirect('/admin/evenimente?message=Evenimentul+nu+a+fost+gasit');
  }

  let imagePath = existingEvent.image_path || null;
  if (req.file) {
    imagePath = await uploadImage(req.file, 'site');
    await removeImage(existingEvent.image_path);
  }

  await query(
    `
    UPDATE events
    SET title = $1, event_date = $2, location = $3, description = $4, image_path = $5, active = $6, sort_order = $7, updated_at = NOW()
    WHERE id = $8
    `,
    [
      String(title || '').trim(),
      event_date,
      String(location || '').trim(),
      String(description || '').trim(),
      imagePath,
      active === '1',
      Number(sort_order || 0),
      eventId
    ]
  );

  res.redirect('/admin/evenimente?message=Eveniment+actualizat');
});

router.post('/evenimente/:id/sterge', requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const existingResult = await query('SELECT image_path FROM events WHERE id = $1', [eventId]);
  const existingEvent = existingResult.rows[0];

  if (!existingEvent) {
    return res.redirect('/admin/evenimente?message=Evenimentul+nu+a+fost+gasit');
  }

  await removeImage(existingEvent.image_path);

  await query('DELETE FROM events WHERE id = $1', [eventId]);
  res.redirect('/admin/evenimente?message=Eveniment+sters');
});

router.get('/recenzii/incredere', requireAuth, async (req, res) => {
  const reviews = await getTrustReviewsForAdmin();

  res.render('admin/trust-reviews', {
    pageTitle: 'Recenzii incredere',
    admin: req.session.admin,
    reviews,
    message: req.query.message || ''
  });
});

router.post('/recenzii/incredere', requireAuth, async (req, res) => {
  const { reviewer_name, reviewer_email, rating, title, message, is_public } = req.body;

  await query(
    `
    INSERT INTO reviews
    (product_id, reviewer_name, reviewer_email, rating, title, message, is_verified_purchase, is_public, created_at, updated_at)
    VALUES (NULL, $1, $2, $3, $4, $5, TRUE, $6, NOW(), NOW())
    `,
    [
      String(reviewer_name || '').trim(),
      String(reviewer_email || '').trim().toLowerCase(),
      Number(rating || 5),
      String(title || '').trim(),
      String(message || '').trim(),
      is_public === '1'
    ]
  );

  res.redirect('/admin/recenzii/incredere?message=Recenzie+adaugata');
});

router.post('/recenzii/incredere/:id', requireAuth, async (req, res) => {
  const reviewId = Number(req.params.id);
  const { reviewer_name, reviewer_email, rating, title, message, is_public } = req.body;

  await query(
    `
    UPDATE reviews
    SET reviewer_name = $1, reviewer_email = $2, rating = $3, title = $4, message = $5, is_public = $6, updated_at = NOW()
    WHERE id = $7 AND product_id IS NULL
    `,
    [
      String(reviewer_name || '').trim(),
      String(reviewer_email || '').trim().toLowerCase(),
      Number(rating || 5),
      String(title || '').trim(),
      String(message || '').trim(),
      is_public === '1',
      reviewId
    ]
  );

  res.redirect('/admin/recenzii/incredere?message=Recenzie+actualizata');
});

router.post('/recenzii/incredere/:id/sterge', requireAuth, async (req, res) => {
  const reviewId = Number(req.params.id);
  await query('DELETE FROM reviews WHERE id = $1 AND product_id IS NULL', [reviewId]);
  res.redirect('/admin/recenzii/incredere?message=Recenzie+stearsa');
});

router.get('/comenzi/:id', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id);
  const orderResult = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = orderResult.rows[0];

  if (!order) {
    return res.redirect('/admin/comenzi?message=Comanda+nu+a+fost+gasita');
  }

  const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);

  res.render('admin/order-detail', {
    pageTitle: `Comanda ${order.order_number || order.id}`,
    admin: req.session.admin,
    order,
    items: itemsResult.rows,
    statusOptions: ['noua', 'in procesare', 'confirmata', 'livrata', 'anulata'],
    message: req.query.message || ''
  });
});

router.post('/comenzi/:id/status', requireAuth, async (req, res) => {
  const { orderStatus } = req.body;
  const allowed = new Set(['noua', 'in procesare', 'confirmata', 'livrata', 'anulata']);

  if (!allowed.has(orderStatus)) {
    return res.redirect(`/admin/comenzi/${req.params.id}?message=Status+invalid`);
  }

  const orderId = Number(req.params.id);
  const exists = await query('SELECT id FROM orders WHERE id = $1', [orderId]);
  if (!exists.rows[0]) {
    return res.redirect('/admin/comenzi?message=Comanda+nu+a+fost+gasita');
  }

  await query('UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2', [orderStatus, orderId]);
  res.redirect(`/admin/comenzi/${orderId}?message=Status+actualizat`);
});

router.get('/produse', requireAuth, async (req, res) => {
  const products = await getProductsForAdmin();

  res.render('admin/products-list', {
    pageTitle: 'Produse',
    admin: req.session.admin,
    products,
    message: req.query.message || ''
  });
});

router.get('/produse/nou', requireAuth, (req, res) => {
  res.render('admin/product-form', {
    pageTitle: 'Produs nou',
    admin: req.session.admin,
    product: null,
    images: [],
    reviews: [],
    message: req.query.message || '',
    mode: 'create'
  });
});

router.post('/produse', requireAuth, upload.array('images', 20), async (req, res) => {
  const { name, price, description, category, active } = req.body;
  const slug = makeSlug(name);

  const insert = await query(
    `
    INSERT INTO products (name, slug, price, description, category, active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING id
    `,
    [name, slug, Number(price || 0), description, category, active === '1']
  );

  const productId = insert.rows[0].id;

  for (const [index, file] of (req.files || []).entries()) {
    const imagePath = await uploadImage(file, 'products');
    await query(
      'INSERT INTO product_images (product_id, image_path, alt_text, sort_order) VALUES ($1, $2, $3, $4)',
      [productId, imagePath, name, index]
    );
  }

  res.redirect('/admin/produse?message=Produs+adaugat+cu+succes');
});

router.get('/produse/:id/editare', requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  const productResult = await query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = productResult.rows[0];

  if (!product) {
    return res.redirect('/admin/produse?message=Produsul+nu+a+fost+gasit');
  }

  const imagesResult = await query(
    'SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC',
    [product.id]
  );
  const reviewsResult = await query(
    'SELECT * FROM reviews WHERE product_id = $1 ORDER BY created_at DESC',
    [product.id]
  );

  res.render('admin/product-form', {
    pageTitle: `Editare ${product.name}`,
    admin: req.session.admin,
    product,
    images: imagesResult.rows,
    reviews: reviewsResult.rows,
    message: req.query.message || '',
    mode: 'edit'
  });
});

router.post('/produse/:id', requireAuth, upload.array('images', 20), async (req, res) => {
  const productId = Number(req.params.id);
  const { name, price, description, category, active } = req.body;
  const slug = makeSlug(name);

  const existing = await query('SELECT id FROM products WHERE id = $1', [productId]);
  if (!existing.rows[0]) {
    return res.redirect('/admin/produse?message=Produsul+nu+a+fost+gasit');
  }

  await query(
    `
    UPDATE products
    SET name = $1, slug = $2, price = $3, description = $4, category = $5, active = $6, updated_at = NOW()
    WHERE id = $7
    `,
    [name, slug, Number(price || 0), description, category, active === '1', productId]
  );

  const countResult = await query('SELECT COUNT(*)::int AS count FROM product_images WHERE product_id = $1', [productId]);
  const currentImageCount = countResult.rows[0].count;

  for (const [index, file] of (req.files || []).entries()) {
    const imagePath = await uploadImage(file, 'products');
    await query(
      'INSERT INTO product_images (product_id, image_path, alt_text, sort_order) VALUES ($1, $2, $3, $4)',
      [productId, imagePath, name, currentImageCount + index]
    );
  }

  res.redirect('/admin/produse?message=Produs+actualizat');
});

router.post('/produse/:id/sterge', requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  const productResult = await query('SELECT id FROM products WHERE id = $1', [productId]);

  if (!productResult.rows[0]) {
    return res.redirect('/admin/produse?message=Produsul+nu+a+fost+gasit');
  }

  const images = await query('SELECT * FROM product_images WHERE product_id = $1', [productId]);

  for (const image of images.rows) {
    await removeImage(image.image_path);
  }

  await query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  await query('DELETE FROM products WHERE id = $1', [productId]);

  res.redirect('/admin/produse?message=Produs+sters+cu+succes');
});

router.post('/imagini/:id/sterge', requireAuth, async (req, res) => {
  const imageId = Number(req.params.id);
  const imageResult = await query('SELECT * FROM product_images WHERE id = $1', [imageId]);
  const image = imageResult.rows[0];

  if (image) {
    await removeImage(image.image_path);
    await query('DELETE FROM product_images WHERE id = $1', [imageId]);
  }

  const referer = req.get('referer');
  res.redirect(referer || '/admin/produse');
});

router.post('/produse/:id/recenzii', requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  const { reviewer_name, reviewer_email, rating, title, message, is_public } = req.body;

  await query(
    `
    INSERT INTO reviews
    (product_id, reviewer_name, reviewer_email, rating, title, message, is_verified_purchase, is_public, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, NOW(), NOW())
    `,
    [
      productId,
      String(reviewer_name || '').trim(),
      String(reviewer_email || '').trim().toLowerCase(),
      Number(rating || 5),
      String(title || '').trim(),
      String(message || '').trim(),
      is_public === '1'
    ]
  );

  res.redirect(`/admin/produse/${productId}/editare?message=Recenzie+produs+adaugata`);
});

router.post('/produse/:id/recenzii/:reviewId', requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  const reviewId = Number(req.params.reviewId);
  const { reviewer_name, reviewer_email, rating, title, message, is_public } = req.body;

  await query(
    `
    UPDATE reviews
    SET reviewer_name = $1, reviewer_email = $2, rating = $3, title = $4, message = $5, is_public = $6, updated_at = NOW()
    WHERE id = $7 AND product_id = $8
    `,
    [
      String(reviewer_name || '').trim(),
      String(reviewer_email || '').trim().toLowerCase(),
      Number(rating || 5),
      String(title || '').trim(),
      String(message || '').trim(),
      is_public === '1',
      reviewId,
      productId
    ]
  );

  res.redirect(`/admin/produse/${productId}/editare?message=Recenzie+produs+actualizata`);
});

router.post('/produse/:id/recenzii/:reviewId/sterge', requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  const reviewId = Number(req.params.reviewId);
  await query('DELETE FROM reviews WHERE id = $1 AND product_id = $2', [reviewId, productId]);
  res.redirect(`/admin/produse/${productId}/editare?message=Recenzie+produs+stearsa`);
});

router.get('/continut', requireAuth, async (req, res) => {
  const sectionsResult = await query('SELECT * FROM site_content ORDER BY section_key ASC');

  res.render('admin/content', {
    pageTitle: 'Editare continut site',
    admin: req.session.admin,
    sections: sectionsResult.rows,
    message: req.query.message || ''
  });
});

router.post('/continut/:sectionKey', requireAuth, uploadContent.single('section_image'), async (req, res) => {
  const { title, subtitle, body, cta_primary, cta_secondary } = req.body;
  const sectionKey = String(req.params.sectionKey || '').trim();
  const currentResult = await query(
    'SELECT image_path, cta_primary, cta_secondary FROM site_content WHERE section_key = $1',
    [sectionKey]
  );
  const currentImagePath = currentResult.rows[0]?.image_path || null;
  const currentCtaPrimary = currentResult.rows[0]?.cta_primary || '';
  const currentCtaSecondary = currentResult.rows[0]?.cta_secondary || '';
  let nextImagePath = currentImagePath;
  const nextCtaPrimary = typeof cta_primary === 'string' ? cta_primary : currentCtaPrimary;
  const nextCtaSecondary = typeof cta_secondary === 'string' ? cta_secondary : currentCtaSecondary;

  if (req.file) {
    nextImagePath = await uploadImage(req.file, 'site');
    await removeImage(currentImagePath);
  }

  await query(
    `
    UPDATE site_content
    SET title = $1, subtitle = $2, body = $3, cta_primary = $4, cta_secondary = $5, image_path = $6, updated_at = NOW()
    WHERE section_key = $7
    `,
    [title, subtitle, body, nextCtaPrimary, nextCtaSecondary, nextImagePath, sectionKey]
  );

  res.redirect('/admin/continut?message=Sectiune+actualizata');
});

module.exports = router;
