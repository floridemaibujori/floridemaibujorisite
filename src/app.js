const path = require('path');
const express = require('express');
const session = require('express-session');
require('dotenv').config();

const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'atelier-bujori-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto'
    }
  })
);

app.use(express.static(path.join(process.cwd(), 'public')));

app.use((req, res, next) => {
  res.locals.year = new Date().getFullYear();
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('pages/not-found', {
    pageTitle: 'Pagina inexistenta',
    company: {
      name: 'Flori de Mai Bujori',
      phoneMain: '0722747762',
      whatsappLink: 'https://wa.me/40722747762',
      social: { instagram: 'https://instagram.com/flori_de_mai_bujori', facebook: '#', tiktok: '#' }
    },
    currentPath: req.path
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send('A aparut o eroare. Incearca din nou.');
});

module.exports = app;
