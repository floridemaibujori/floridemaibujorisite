const express = require('express');
const multer = require('multer');
const { query } = require('../config/db');
const { hashPassword, safeCompare } = require('../utils/security');
const { requireAuth } = require('../middleware/auth');
const { makeSlug } = require('../utils/slug');
const { uploadImage, removeImage } = require('../services/storageService');
const { sendAdminPasswordVerificationCode } = require('../services/emailService');

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

function redirectWithMessage(req, res, fallbackPath, message) {
  const referer = req.get('referer');
  const base = referer && referer.includes('/admin') ? referer : fallbackPath;
  const separator = base.includes('?') ? '&' : '?';
  return res.redirect(`${base}${separator}message=${encodeURIComponent(message)}`);
}

function parseProductAvailability(body) {
  const availabilityMode = body.availability_mode === 'preorder' ? 'preorder' : 'normal';

  if (availabilityMode === 'normal') {
    return {
      availabilityMode,
      preorderStartDate: null,
      preorderEndDate: null,
      preorderDepositPercent: 0,
      preorderNote: null
    };
  }

  const preorderStartDate = String(body.preorder_start_date || '').trim() || null;
  const preorderEndDate = String(body.preorder_end_date || '').trim() || null;
  const preorderNote = String(body.preorder_note || '').trim() || null;
  const rawDeposit = Number(body.preorder_deposit_percent || 50);
  const preorderDepositPercent = Number.isFinite(rawDeposit)
    ? Math.min(90, Math.max(10, rawDeposit))
    : 50;

  return {
    availabilityMode,
    preorderStartDate,
    preorderEndDate,
    preorderDepositPercent,
    preorderNote
  };
}

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
    SELECT e.*, img.image_path AS cover_image, COUNT(ei.id)::int AS images_count
    FROM events e
    LEFT JOIN LATERAL (
      SELECT image_path
      FROM event_images
      WHERE event_id = e.id
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    ) img ON TRUE
    LEFT JOIN event_images ei ON ei.event_id = e.id
    GROUP BY e.id, img.image_path
    ORDER BY e.sort_order ASC, e.event_date ASC, e.id ASC
  `);

  return result.rows;
}

async function getEventImages(eventId) {
  const result = await query(
    'SELECT * FROM event_images WHERE event_id = $1 ORDER BY sort_order ASC, id ASC',
    [eventId]
  );
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
    message: req.query.message || '',
    counts,
    recentProducts: recentProducts.slice(0, 5),
    recentOrders: recentOrders.slice(0, 5),
    passwordResetState: req.session.adminPasswordReset || null,
    passwordResetCooldownLeft: req.session.adminPasswordReset
      ? Math.max(0, 60 - Math.floor((Date.now() - Number(req.session.adminPasswordReset.lastSentAt || 0)) / 1000))
      : 0
  });
});

router.post('/schimba-parola/cod', requireAuth, async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const nextPassword = String(req.body.next_password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!currentPassword || !nextPassword || nextPassword.length < 8 || nextPassword !== confirmPassword) {
    return res.redirect('/admin?message=Completeaza+corect+campurile+parolei+(minim+8+caractere).');
  }

  const adminResult = await query('SELECT * FROM admins WHERE id = $1', [req.session.admin.id]);
  const admin = adminResult.rows[0];
  if (!admin || !safeCompare(hashPassword(currentPassword), admin.password_hash)) {
    return res.redirect('/admin?message=Parola+curenta+nu+este+corecta.');
  }

  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
  const emailResult = await sendAdminPasswordVerificationCode({
    to: 'floridemaibujori@gmail.com',
    code: verificationCode
  });

  if (!emailResult.sent) {
    return res.redirect('/admin?message=Nu+am+putut+trimite+codul+de+verificare.');
  }

  req.session.adminPasswordReset = {
    pendingPasswordHash: hashPassword(nextPassword),
    codeHash: hashPassword(verificationCode),
    lastSentAt: Date.now(),
    expiresAt: Date.now() + (10 * 60 * 1000)
  };

  return res.redirect('/admin?message=Codul+a+fost+trimis+pe+floridemaibujori@gmail.com');
});

router.post('/schimba-parola/retrimite-cod', requireAuth, async (req, res) => {
  const resetState = req.session.adminPasswordReset;
  if (!resetState) {
    return res.redirect('/admin?message=Nu+exista+o+cerere+activa+de+schimbare+parola.');
  }

  const now = Date.now();
  const lastSentAt = Number(resetState.lastSentAt || 0);
  const elapsedSeconds = Math.floor((now - lastSentAt) / 1000);
  if (elapsedSeconds < 60) {
    const waitSeconds = 60 - elapsedSeconds;
    return res.redirect(`/admin?message=Mai+asteapta+${waitSeconds}+secunde+inainte+sa+retrimiti+codul.`);
  }

  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
  const emailResult = await sendAdminPasswordVerificationCode({
    to: 'floridemaibujori@gmail.com',
    code: verificationCode
  });

  if (!emailResult.sent) {
    return res.redirect('/admin?message=Nu+am+putut+retrimite+codul+de+verificare.');
  }

  req.session.adminPasswordReset = {
    ...resetState,
    codeHash: hashPassword(verificationCode),
    lastSentAt: now,
    expiresAt: now + (10 * 60 * 1000)
  };

  return res.redirect('/admin?message=Cod+retrims+pe+floridemaibujori@gmail.com');
});

router.post('/schimba-parola/confirma', requireAuth, async (req, res) => {
  const inputCode = String(req.body.verification_code || '').trim();
  const resetState = req.session.adminPasswordReset;

  if (!resetState || !inputCode) {
    return res.redirect('/admin?message=Cod+invalid+sau+cerere+expirata.');
  }

  if (Date.now() > Number(resetState.expiresAt || 0)) {
    req.session.adminPasswordReset = null;
    return res.redirect('/admin?message=Codul+a+expirat.+Genereaza+un+cod+nou.');
  }

  if (!safeCompare(hashPassword(inputCode), resetState.codeHash)) {
    return res.redirect('/admin?message=Cod+de+verificare+gresit.');
  }

  await query('UPDATE admins SET password_hash = $1 WHERE id = $2', [
    resetState.pendingPasswordHash,
    req.session.admin.id
  ]);
  req.session.adminPasswordReset = null;

  return res.redirect('/admin?message=Parola+de+admin+a+fost+actualizata+cu+succes.');
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
    images: [],
    mode: 'create',
    message: req.query.message || ''
  });
});

router.post('/evenimente', requireAuth, uploadContent.array('images', 20), async (req, res) => {
  try {
    const { title, event_date, location, description, active, sort_order } = req.body;
    const uploadedImagePaths = [];
    for (const file of (req.files || [])) {
      uploadedImagePaths.push(await uploadImage(file, 'site'));
    }
    const imagePath = uploadedImagePaths[0] || null;

    const inserted = await query(
      `
      INSERT INTO events (title, event_date, location, description, image_path, active, sort_order, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id
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

    const eventId = inserted.rows[0].id;
    for (const [index, path] of uploadedImagePaths.entries()) {
      await query(
        'INSERT INTO event_images (event_id, image_path, sort_order) VALUES ($1, $2, $3)',
        [eventId, path, index]
      );
    }

    res.redirect('/admin/evenimente?message=Eveniment+adaugat');
  } catch (error) {
    console.error('Eroare upload eveniment:', error.message);
    return redirectWithMessage(req, res, '/admin/evenimente/nou', `Eroare upload imagine eveniment: ${error.message}`);
  }
});

router.get('/evenimente/:id/editare', requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const eventResult = await query('SELECT * FROM events WHERE id = $1', [eventId]);
  const event = eventResult.rows[0];

  if (!event) {
    return res.redirect('/admin/evenimente?message=Evenimentul+nu+a+fost+gasit');
  }

  const images = await getEventImages(eventId);

  res.render('admin/event-form', {
    pageTitle: `Editare ${event.title}`,
    admin: req.session.admin,
    event,
    images,
    mode: 'edit',
    message: req.query.message || ''
  });
});

router.post('/evenimente/:id', requireAuth, uploadContent.array('images', 20), async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const { title, event_date, location, description, active, sort_order } = req.body;
    const existingResult = await query('SELECT image_path FROM events WHERE id = $1', [eventId]);
    const existingEvent = existingResult.rows[0];

    if (!existingEvent) {
      return res.redirect('/admin/evenimente?message=Evenimentul+nu+a+fost+gasit');
    }

    const countResult = await query('SELECT COUNT(*)::int AS count FROM event_images WHERE event_id = $1', [eventId]);
    const currentImageCount = countResult.rows[0].count;
    const uploadedImagePaths = [];
    for (const file of (req.files || [])) {
      uploadedImagePaths.push(await uploadImage(file, 'site'));
    }

    for (const [index, path] of uploadedImagePaths.entries()) {
      await query(
        'INSERT INTO event_images (event_id, image_path, sort_order) VALUES ($1, $2, $3)',
        [eventId, path, currentImageCount + index]
      );
    }

    const firstImageResult = await query(
      'SELECT image_path FROM event_images WHERE event_id = $1 ORDER BY sort_order ASC, id ASC LIMIT 1',
      [eventId]
    );
    const imagePath = firstImageResult.rows[0]?.image_path || null;

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
  } catch (error) {
    console.error('Eroare upload editare eveniment:', error.message);
    return redirectWithMessage(req, res, '/admin/evenimente', `Eroare upload imagine eveniment: ${error.message}`);
  }
});

router.post('/evenimente/:id/sterge', requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const existingResult = await query('SELECT image_path FROM events WHERE id = $1', [eventId]);
  const existingEvent = existingResult.rows[0];

  if (!existingEvent) {
    return res.redirect('/admin/evenimente?message=Evenimentul+nu+a+fost+gasit');
  }

  const imagesResult = await getEventImages(eventId);
  for (const image of imagesResult) {
    await removeImage(image.image_path);
  }
  await removeImage(existingEvent.image_path);

  await query('DELETE FROM events WHERE id = $1', [eventId]);
  res.redirect('/admin/evenimente?message=Eveniment+sters');
});

router.post('/evenimente/:eventId/imagini/:imageId/sterge', requireAuth, async (req, res) => {
  const eventId = Number(req.params.eventId);
  const imageId = Number(req.params.imageId);

  const imageResult = await query(
    'SELECT * FROM event_images WHERE id = $1 AND event_id = $2',
    [imageId, eventId]
  );
  const image = imageResult.rows[0];
  if (!image) {
    return res.redirect(`/admin/evenimente/${eventId}/editare?message=Imaginea+nu+a+fost+gasita`);
  }

  await removeImage(image.image_path);
  await query('DELETE FROM event_images WHERE id = $1', [imageId]);
  const firstImageResult = await query(
    'SELECT image_path FROM event_images WHERE event_id = $1 ORDER BY sort_order ASC, id ASC LIMIT 1',
    [eventId]
  );
  await query('UPDATE events SET image_path = $1, updated_at = NOW() WHERE id = $2', [
    firstImageResult.rows[0]?.image_path || null,
    eventId
  ]);

  return res.redirect(`/admin/evenimente/${eventId}/editare?message=Imagine+stearsa`);
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
  try {
    const { name, price, description, category, active } = req.body;
    const availability = parseProductAvailability(req.body);
    const slug = makeSlug(name);

    if (
      availability.availabilityMode === 'preorder' &&
      (!availability.preorderStartDate || !availability.preorderEndDate)
    ) {
      return redirectWithMessage(
        req,
        res,
        '/admin/produse/nou',
        'Pentru precomanda trebuie completat intervalul de livrare.'
      );
    }

    const insert = await query(
      `
      INSERT INTO products
      (name, slug, price, description, category, availability_mode, preorder_start_date, preorder_end_date, preorder_deposit_percent, preorder_note, active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
      `,
      [
        name,
        slug,
        Number(price || 0),
        description,
        category,
        availability.availabilityMode,
        availability.preorderStartDate,
        availability.preorderEndDate,
        availability.preorderDepositPercent,
        availability.preorderNote,
        active === '1'
      ]
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
  } catch (error) {
    console.error('Eroare upload produs nou:', error.message);
    return redirectWithMessage(req, res, '/admin/produse/nou', `Eroare upload imagini produs: ${error.message}`);
  }
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
  try {
    const productId = Number(req.params.id);
    const { name, price, description, category, active } = req.body;
    const availability = parseProductAvailability(req.body);
    const slug = makeSlug(name);

    const existing = await query('SELECT id FROM products WHERE id = $1', [productId]);
    if (!existing.rows[0]) {
      return res.redirect('/admin/produse?message=Produsul+nu+a+fost+gasit');
    }

    if (
      availability.availabilityMode === 'preorder' &&
      (!availability.preorderStartDate || !availability.preorderEndDate)
    ) {
      return redirectWithMessage(
        req,
        res,
        `/admin/produse/${productId}/editare`,
        'Pentru precomanda trebuie completat intervalul de livrare.'
      );
    }

    await query(
      `
      UPDATE products
      SET
        name = $1,
        slug = $2,
        price = $3,
        description = $4,
        category = $5,
        availability_mode = $6,
        preorder_start_date = $7,
        preorder_end_date = $8,
        preorder_deposit_percent = $9,
        preorder_note = $10,
        active = $11,
        updated_at = NOW()
      WHERE id = $12
      `,
      [
        name,
        slug,
        Number(price || 0),
        description,
        category,
        availability.availabilityMode,
        availability.preorderStartDate,
        availability.preorderEndDate,
        availability.preorderDepositPercent,
        availability.preorderNote,
        active === '1',
        productId
      ]
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
  } catch (error) {
    console.error('Eroare upload editare produs:', error.message);
    return redirectWithMessage(req, res, '/admin/produse', `Eroare upload imagini produs: ${error.message}`);
  }
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
  try {
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
  } catch (error) {
    console.error('Eroare upload continut:', error.message);
    return redirectWithMessage(req, res, '/admin/continut', `Eroare upload imagine sectiune: ${error.message}`);
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    let message = 'Eroare la upload.';
    if (error.code === 'LIMIT_FILE_SIZE') {
      message = 'Fisier prea mare. Incearca o imagine mai mica.';
    } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Ai trimis un camp de fisiere invalid.';
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      message = 'Ai depasit numarul maxim de imagini pentru un upload.';
    }
    return redirectWithMessage(req, res, '/admin', message);
  }

  if (error && /Se accepta doar fisiere imagine/i.test(error.message || '')) {
    return redirectWithMessage(req, res, '/admin', 'Upload invalid: se accepta doar fisiere imagine.');
  }

  return next(error);
});

module.exports = router;
