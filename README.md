# Atelier Bujori - website floral complet

Website complet pentru business floral, cu frontend public si admin panel pentru gestionare produse, imagini si comenzi.

## Rulare

1. `npm install`
2. completeaza `.env` (model in `.env.example`)
3. `npm start`
4. Deschide `http://localhost:3000`
5. Admin: `http://localhost:3000/admin/login`

Credentiale initiale admin:
- user: `admin`
- parola: `admin123`

## Structura proiect

- `server.js` - pornire server
- `src/app.js` - configurare Express, sesiuni, rute
- `src/config/db.js` - conectare Supabase Postgres, creare tabele, seed initial
- `src/routes/publicRoutes.js` - paginile publice + endpoint creare comanda (`/api/comenzi`) + confirmare
- `src/routes/adminRoutes.js` - login admin, CRUD produse, upload imagini, editare continut home, administrare comenzi
- `src/services/emailService.js` - trimitere email confirmare comanda (Nodemailer + Gmail App Password)
- `src/middleware/auth.js` - protectie rute admin
- `public/css/styles.css` - design system (culori, spacing, butoane, responsive)
- `public/js/main.js` - meniu mobil + cos localStorage + checkout cu mod Rezerva/Comanda + cupoane
- `public/images` - imagini placeholder
- `public/uploads/products` - imagini urcate din admin
- `views/pages` - pagini website public
- `views/admin` - pagini admin panel

## Unde editezi textul

- Home principal: din admin, pagina `Continut acasa`
- Restul paginilor: fisiere in `views/pages/*.ejs`
- Texte admin: `views/admin/*.ejs`

## Unde inlocuiesti imagini

- Produse: direct din admin, camp `Imagini produs`
- Placeholder globale: `public/images`
- Imaginile uploadate automat sunt stocate in `public/uploads/products`

## Unde schimbi culorile

- In `public/css/styles.css`, in blocul `:root`
- Variabile principale:
  - `--primary`
  - `--accent`
  - `--bg`
  - `--surface`
  - `--text`

## Sistem comenzi (implementat)

- Checkout real salveaza comanda in Supabase Postgres (`orders` + `order_items`)
- Metode disponibile in checkout: `ramburs` si `card online Stripe (test)`
- Selector la intrare in checkout: `Rezerva in magazin` / `Comanda`
- Cod reducere in checkout (`BUNVENIT10`, `BUJORI5`)
- Dupa trimitere, clientul primeste pagina de confirmare cu numar comanda
- In admin exista sectiunea `Comenzi` cu lista, detalii si actualizare status
- Buton cos vizibil in header + badge cu numar produse

## Extensie viitoare: plata cu cardul

- Fluxul de comanda este deja separat si pregatit pentru integrare online
- Punct de integrare marcat in `views/pages/cart.ejs`
- Pentru card se poate adauga:
  - initiere intent plata in backend (Stripe/PayPal)
  - webhook pentru confirmare plata
  - update `payment_status` in tabelul `orders`

## Stripe (integrat in test mode)

- Pentru metoda `card`, checkout-ul creeaza o sesiune Stripe Checkout si redirectioneaza clientul la plata.
- Dupa plata reusita, comanda este marcata `platit` si se afiseaza confirmarea.
- Variabile necesare in `.env`:
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_SECRET_KEY`

## Email comenzi

- Aplicatia trimite email dupa plasarea comenzii:
  - catre admin (`ORDER_NOTIFY_EMAIL`)
  - catre client (daca a completat email)
- Configurare in `.env`:
  - `SUPABASE_DB_URL`
  - `SMTP_USER`
  - `SMTP_PASS` (Gmail App Password)
  - `ORDER_NOTIFY_EMAIL`

## Observatii

- Intregul UI este in romana fara diacritice.
- Site-ul este responsive (mobil/tableta/desktop).
- Produsele au camp activ/inactiv pentru control vizibilitate.
- Uploadul de imagini este local, fara URL manual.
