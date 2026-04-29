const { Pool } = require('pg');
const { hashPassword } = require('../utils/security');

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Lipseste SUPABASE_DB_URL in .env');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      availability_mode TEXT NOT NULL DEFAULT 'normal',
      preorder_start_date DATE,
      preorder_end_date DATE,
      preorder_deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 50,
      preorder_note TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS site_content (
      id SERIAL PRIMARY KEY,
      section_key TEXT UNIQUE NOT NULL,
      title TEXT,
      subtitle TEXT,
      body TEXT,
      cta_primary TEXT,
      cta_secondary TEXT,
      image_path TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      customer_address TEXT NOT NULL,
      customer_city TEXT NOT NULL,
      customer_note TEXT,
      coupon_code TEXT,
      discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'ramburs',
      payment_status TEXT NOT NULL DEFAULT 'neplatit',
      stripe_session_id TEXT,
      stripe_payment_intent_id TEXT,
      order_status TEXT NOT NULL DEFAULT 'noua',
      source TEXT NOT NULL DEFAULT 'site',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      product_price NUMERIC(12,2) NOT NULL,
      quantity INTEGER NOT NULL,
      line_total NUMERIC(12,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      reviewer_name TEXT NOT NULL,
      reviewer_email TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      image_path TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS event_images (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE site_content
    ADD COLUMN IF NOT EXISTS image_path TEXT
  `);

  await query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS availability_mode TEXT NOT NULL DEFAULT 'normal'
  `);

  await query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS preorder_start_date DATE
  `);

  await query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS preorder_end_date DATE
  `);

  await query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS preorder_deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 50
  `);

  await query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS preorder_note TEXT
  `);

  const adminResult = await query('SELECT COUNT(*)::int AS count FROM admins');
  if (adminResult.rows[0].count === 0) {
    await query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
      ['admin', hashPassword('admin123')]
    );
  }

  const sections = [
    {
      section_key: 'hero',
      title: 'Bujori de gradina, aranjamente cu suflet',
      subtitle: 'Flori proaspete, concept elegant, livrare cu grija in fiecare comanda.',
      body: 'Cream colectii florale pentru cadouri, evenimente si momente speciale. Design curat, ton feminin si atentie la detalii.',
      cta_primary: 'Vezi magazinul',
      cta_secondary: 'Scrie pe WhatsApp',
      image_path: '/images/heroimg.png'
    },
    {
      section_key: 'intro',
      title: 'Despre atelierul nostru floral',
      subtitle: 'Un business local construit cu pasiune pentru bujori si flori sezoniere.',
      body: 'Lucram in loturi mici, alegem materiale naturale si pregatim fiecare comanda cu grija. Textele pot fi ajustate usor din admin.',
      cta_primary: 'Despre noi',
      cta_secondary: 'Programeaza o discutie',
      image_path: null
    },
    {
      section_key: 'contact_cta',
      title: 'Vrei o recomandare rapida?',
      subtitle: 'Trimite-ne detalii despre buget, data si preferinte.',
      body: 'Raspundem rapid pe WhatsApp sau telefon si te ajutam sa alegi varianta potrivita.',
      cta_primary: 'Contacteaza-ne',
      cta_secondary: 'Suna acum',
      image_path: null
    },
    {
      section_key: 'about_hero',
      title: 'Atelier floral local cu viziune moderna',
      subtitle: 'Construim experiente florale care inspira incredere, feminitate si simplitate eleganta.',
      body: '',
      cta_primary: '',
      cta_secondary: '',
      image_path: '/images/despre%20noi%20image.jpeg'
    },
    {
      section_key: 'about_mission',
      title: 'Misiunea noastra',
      subtitle: '',
      body: 'Punem accent pe compozitii naturale, cromatica echilibrata si materiale premium. Fiecare comanda este tratata ca un proiect personal.',
      cta_primary: '',
      cta_secondary: '',
      image_path: null
    },
  ];

  for (const section of sections) {
    await query(
      `
      INSERT INTO site_content (section_key, title, subtitle, body, cta_primary, cta_secondary, image_path, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (section_key) DO NOTHING
      `,
      [
        section.section_key,
        section.title,
        section.subtitle,
        section.body,
        section.cta_primary,
        section.cta_secondary,
        section.image_path
      ]
    );
  }

  await query(
    `
    UPDATE site_content
    SET image_path = '/images/heroimg.png'
    WHERE section_key = 'hero' AND (image_path IS NULL OR image_path = '')
    `
  );

  await query(
    `
    UPDATE site_content
    SET image_path = '/images/despre%20noi%20image.jpeg'
    WHERE section_key = 'about_hero' AND (image_path IS NULL OR image_path = '')
    `
  );

  await query("DELETE FROM site_content WHERE section_key = 'about_story'");

  const eventsCount = await query('SELECT COUNT(*)::int AS count FROM events');
  if (eventsCount.rows[0].count === 0) {
    const seedEvents = [
      {
        title: '14 Februarie - Ziua indragostitilor',
        event_date: '2026-02-14',
        location: 'Comenzi online + atelier',
        description: 'Buchete romantice si aranjamente elegante in tonuri calde, pregatite cu mesaj personal pentru persoana draga.',
        image_path: '/images/placeholder-peony-1.svg',
        active: true,
        sort_order: 1
      },
      {
        title: '1 Martie - Martisor floral',
        event_date: '2026-03-01',
        location: 'Comenzi online + ridicare',
        description: 'Colectie speciala de martisor floral cu bujori si flori de primavara, ideala pentru cadouri cu suflet.',
        image_path: '/images/placeholder-peony-2.svg',
        active: true,
        sort_order: 2
      },
      {
        title: '8 Martie - Ziua femeii',
        event_date: '2026-03-08',
        location: 'Livrare locala',
        description: 'Selectie premium pentru mame, sotii, colege si prietene, cu buchete feminine si ambalare rafinata.',
        image_path: '/images/placeholder-peony-3.svg',
        active: true,
        sort_order: 3
      }
    ];

    for (const event of seedEvents) {
      await query(
        `
        INSERT INTO events (title, event_date, location, description, image_path, active, sort_order, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        `,
        [
          event.title,
          event.event_date,
          event.location,
          event.description,
          event.image_path,
          event.active,
          event.sort_order
        ]
      );
    }
  }

  await query(`
    INSERT INTO event_images (event_id, image_path, sort_order)
    SELECT e.id, e.image_path, 0
    FROM events e
    WHERE e.image_path IS NOT NULL
      AND e.image_path <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM event_images ei
        WHERE ei.event_id = e.id
      )
  `);

  const productResult = await query('SELECT COUNT(*)::int AS count FROM products');
  if (productResult.rows[0].count === 0) {
    const seedProducts = [
      {
        name: 'Buchet Bujori Rose',
        slug: 'buchet-bujori-rose',
        price: 249,
        description: 'Buchet feminin in tonuri rose pudrat, potrivit pentru aniversari si cadouri elegante.',
        category: 'Buchete',
        image: '/images/placeholder-peony-1.svg'
      },
      {
        name: 'Cutie Floral Atelier',
        slug: 'cutie-floral-atelier',
        price: 189,
        description: 'Aranjament in cutie premium, cu flori sezoniere, textura bogata si finisaj rafinat.',
        category: 'Aranjamente',
        image: '/images/placeholder-peony-2.svg'
      },
      {
        name: 'Pachet Eveniment Intim',
        slug: 'pachet-eveniment-intim',
        price: 990,
        description: 'Set floral pentru evenimente restranse: masa principala, colt foto si mini buchete.',
        category: 'Evenimente',
        image: '/images/placeholder-peony-3.svg'
      }
    ];

    for (const product of seedProducts) {
      const inserted = await query(
        `
        INSERT INTO products (name, slug, price, description, category, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
        RETURNING id
        `,
        [product.name, product.slug, product.price, product.description, product.category]
      );

      await query(
        `
        INSERT INTO product_images (product_id, image_path, alt_text, sort_order)
        VALUES ($1, $2, $3, 0)
        `,
        [inserted.rows[0].id, product.image, product.name]
      );
    }
  }
}

module.exports = {
  pool,
  query,
  initDb
};
