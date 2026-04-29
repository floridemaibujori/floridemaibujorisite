function getResendSettings() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || process.env.RESEND_FROM || '').trim();
  const replyTo = String(process.env.EMAIL_REPLY_TO || '').trim();

  return {
    apiKey,
    from,
    replyTo
  };
}

function extractEmailAddress(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const angleMatch = text.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1]) {
    return String(angleMatch[1]).trim();
  }
  return text;
}

async function verifyEmailTransport() {
  const { apiKey, from } = getResendSettings();
  if (!apiKey || !from) {
    return {
      ok: false,
      reason: 'missing_resend_config',
      details: {
        hasResendApiKey: Boolean(apiKey),
        hasEmailFrom: Boolean(from)
      }
    };
  }
  return { ok: true, reason: 'ok', details: { provider: 'resend', from } };
}

async function sendResendEmail({ to, subject, text, html, headers }) {
  const { apiKey, from, replyTo } = getResendSettings();
  if (!apiKey || !from) {
    throw new Error('Configuratia Resend este incompleta.');
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
    headers: headers || {}
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Resend API ${response.status}: ${responseText}`);
  }
}

function formatItems(items) {
  return items
    .map((item) => `- ${item.product_name} x ${item.quantity} = ${Number(item.line_total).toFixed(2)} lei`)
    .join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} lei`;
}

function renderItemsRows(items) {
  return items
    .map((item) => {
      const productName = escapeHtml(item.product_name);
      const qty = Number(item.quantity || 0);
      const lineTotal = formatMoney(item.line_total);
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0e4e9; color: #3d2c36; font-size: 14px;">${productName}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0e4e9; color: #6a5562; font-size: 14px; text-align: center;">${qty}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0e4e9; color: #b14f7c; font-size: 14px; font-weight: 700; text-align: right;">${lineTotal}</td>
        </tr>
      `;
    })
    .join('');
}

function renderItemsRowsCompact(items) {
  return items
    .map((item) => {
      const productName = escapeHtml(item.product_name);
      const qty = Number(item.quantity || 0);
      const lineTotal = formatMoney(item.line_total);
      return `
        <tr>
          <td style="padding: 14px 0; border-bottom: 1px solid #f0e6ec; color: #372833; font-size: 14px; line-height: 1.45;">
            <strong style="font-size: 15px; color: #2f2430;">${productName}</strong><br />
            <span style="color: #7a6672;">Cantitate: ${qty}</span>
          </td>
          <td style="padding: 14px 0; border-bottom: 1px solid #f0e6ec; color: #bc4f86; font-size: 15px; font-weight: 700; text-align: right; white-space: nowrap;">${lineTotal}</td>
        </tr>
      `;
    })
    .join('');
}

function emailLayout({ eyebrow, title, intro, contentHtml, footerNote }) {
  return `
  <!DOCTYPE html>
  <html lang="ro">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(title)}</title>
    </head>
    <body style="margin:0; padding:0; background:#f6f1f3; font-family: Arial, Helvetica, sans-serif;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
        ${escapeHtml(intro)}
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f2f4; padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px; background:#fffdfd; border:1px solid #ecd7e1; border-radius:20px; overflow:hidden;">
              <tr>
                <td style="padding:22px 24px; background:#fff5f9; border-bottom:1px solid #f0dde7;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="padding:0; vertical-align:top;">
                        <p style="margin:0 0 2px; color:#cf5d93; font-size:22px; font-weight:800; line-height:1.1;">Flori de Mai Bujori</p>
                        <p style="margin:0; color:#2f7a78; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                      </td>
                      <td align="right" style="padding:0; vertical-align:top;">
                        <a href="https://instagram.com/flori_de_mai_bujori" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:7px 12px; border:1px solid #ead0dc; border-radius:999px; color:#875b70; font-size:12px; font-weight:700; text-decoration:none;">
                          <span style="font-size:12px; margin-right:6px;">&#128247;</span>flori_de_mai_bujori
                        </a>
                      </td>
                    </tr>
                  </table>
                  <h1 style="margin:16px 0 0; color:#3b2533; font-size:28px; line-height:1.2; font-weight:800;">${escapeHtml(title)}</h1>
                  <p style="margin:10px 0 0; color:#5c4a56; font-size:15px; line-height:1.55;">${escapeHtml(intro)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 24px 14px;">
                  ${contentHtml}
                </td>
              </tr>
              <tr>
                <td style="padding:16px 24px 24px; border-top:1px solid #f2e6eb;">
                  <p style="margin:0; color:#7a6672; font-size:13px; line-height:1.5; text-align:center;">
                    ${escapeHtml(footerNote)}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
}

function renderAdminHtml(order, items) {
  const contentHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px;">
      <tr>
        <td style="padding:8px 10px; background:#fbf3f7; border:1px solid #f0dfe7; border-radius:12px;">
          <p style="margin:0 0 6px; color:#6f5c69; font-size:13px;">Numar comanda</p>
          <p style="margin:0; color:#b14f7c; font-size:20px; font-weight:700;">${escapeHtml(order.order_number)}</p>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px;">
      <tr>
        <td style="padding:12px; border:1px solid #f0e4e9; border-radius:12px;">
          <p style="margin:0 0 8px; color:#3c2a34; font-size:15px; font-weight:700;">Date client</p>
          <p style="margin:0 0 5px; color:#5f4c58; font-size:14px;">Nume: <strong>${escapeHtml(order.customer_name)}</strong></p>
          <p style="margin:0 0 5px; color:#5f4c58; font-size:14px;">Telefon: ${escapeHtml(order.customer_phone)}</p>
          <p style="margin:0 0 5px; color:#5f4c58; font-size:14px;">Email: ${escapeHtml(order.customer_email || '-')}</p>
          <p style="margin:0 0 5px; color:#5f4c58; font-size:14px;">Adresa: ${escapeHtml(order.customer_address)}, ${escapeHtml(order.customer_city)}</p>
          <p style="margin:0; color:#5f4c58; font-size:14px;">Observatii: ${escapeHtml(order.customer_note || '-')}</p>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px;">
      <tr>
        <td style="padding:12px; border:1px solid #f0e4e9; border-radius:12px;">
          <p style="margin:0 0 8px; color:#3c2a34; font-size:15px; font-weight:700;">Produse</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr>
              <th style="padding:8px 12px; text-align:left; color:#7a6672; font-size:12px; text-transform:uppercase; border-bottom:1px solid #f0e4e9;">Produs</th>
              <th style="padding:8px 12px; text-align:center; color:#7a6672; font-size:12px; text-transform:uppercase; border-bottom:1px solid #f0e4e9;">Cant</th>
              <th style="padding:8px 12px; text-align:right; color:#7a6672; font-size:12px; text-transform:uppercase; border-bottom:1px solid #f0e4e9;">Total</th>
            </tr>
            ${renderItemsRows(items)}
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding:12px; border:1px solid #f0e4e9; border-radius:12px;">
          <p style="margin:0 0 6px; color:#5f4c58; font-size:14px;">Metoda plata: <strong>${escapeHtml(order.payment_method)}</strong></p>
          <p style="margin:0 0 6px; color:#5f4c58; font-size:14px;">Subtotal: ${formatMoney(order.subtotal_amount)}</p>
          <p style="margin:0 0 6px; color:#5f4c58; font-size:14px;">Reducere: ${formatMoney(order.discount_amount)}</p>
          <p style="margin:0; color:#b14f7c; font-size:18px; font-weight:700;">Total comanda: ${formatMoney(order.total_amount)}</p>
        </td>
      </tr>
    </table>
  `;

  return emailLayout({
    eyebrow: 'Comanda noua',
    title: 'Flori de Mai Bujori',
    intro: 'Ai primit o comanda noua din site. Verifica detaliile de mai jos.',
    contentHtml,
    footerNote: 'Acest email este trimis automat de sistemul de comenzi Flori de Mai Bujori.'
  });
}

function renderCustomerHtml(order, items) {
  const contentHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px;">
      <tr>
        <td style="padding:14px 14px; border:1px solid #f0e2e9; border-radius:14px; background:#fff9fc;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding:0;">
                <p style="margin:0 0 4px; color:#6f5c69; font-size:13px;">Numar comanda</p>
                <p style="margin:0; color:#bc4f86; font-size:24px; font-weight:800; letter-spacing:0.2px;">${escapeHtml(order.order_number)}</p>
              </td>
              <td align="right" style="padding:0; vertical-align:top;">
                <span style="display:inline-block; padding:8px 11px; background:#fef0f7; border:1px solid #efd6e2; border-radius:12px; color:#7a6672; font-size:12px; font-weight:700;">
                  Plata: ${escapeHtml(order.payment_method)}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px;">
      <tr>
        <td style="padding:16px 16px; border:1px solid #f0e4e9; border-radius:14px;">
          <p style="margin:0 0 10px; color:#3c2a34; font-size:15px; font-weight:700;">Produsele tale</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            ${renderItemsRowsCompact(items)}
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding:14px 14px; border:1px solid #f0e4e9; border-radius:14px; background:#fffbfd;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding:0 0 6px; color:#5f4c58; font-size:14px;">Subtotal</td>
              <td align="right" style="padding:0 0 6px; color:#5f4c58; font-size:14px;">${formatMoney(order.subtotal_amount)}</td>
            </tr>
            <tr>
              <td style="padding:0 0 8px; color:#5f4c58; font-size:14px;">Reducere</td>
              <td align="right" style="padding:0 0 8px; color:#5f4c58; font-size:14px;">${formatMoney(order.discount_amount)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0 0; color:#2f2430; font-size:15px; font-weight:700; border-top:1px solid #f0e4e9;">Total</td>
              <td align="right" style="padding:8px 0 0; color:#bc4f86; font-size:20px; font-weight:800; border-top:1px solid #f0e4e9;">${formatMoney(order.total_amount)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;">
      <tr>
        <td align="center">
          <a href="https://wa.me/40722747762" style="display:inline-block; padding:13px 20px; border-radius:999px; background:#cf5d93; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px;">
            Ai intrebari? Scrie-ne pe WhatsApp
          </a>
        </td>
      </tr>
    </table>
  `;

  return emailLayout({
    eyebrow: 'Confirmare comanda',
    title: `Multumim, ${escapeHtml(order.customer_name)}!`,
    intro: 'Comanda ta a fost inregistrata cu succes. Te contactam in cel mai scurt timp pentru confirmare.',
    contentHtml,
    footerNote: 'Cu drag, echipa Flori de Mai Bujori. Pentru intrebari ne poti scrie direct pe WhatsApp.'
  });
}

async function sendOrderEmails({ order, items }) {
  const { apiKey, from } = getResendSettings();
  const senderEmail = extractEmailAddress(from);
  const adminEmail = String(process.env.ORDER_NOTIFY_EMAIL || senderEmail).trim();
  const customerEmail = String(order.customer_email || '').trim();

  if (!apiKey || !from) {
    return {
      sent: false,
      reason: 'missing_resend_config',
      details: {
        hasResendApiKey: Boolean(apiKey),
        hasEmailFrom: Boolean(from)
      }
    };
  }

  if (!adminEmail && !customerEmail) {
    return {
      sent: false,
      reason: 'missing_recipients',
      details: {
        hasAdminEmail: Boolean(adminEmail),
        hasCustomerEmail: Boolean(customerEmail)
      }
    };
  }

  const subjectAdmin = `Comanda noua ${order.order_number}`;
  const textAdmin = [
    `Comanda noua primita din site.`,
    ``,
    `Numar: ${order.order_number}`,
    `Client: ${order.customer_name}`,
    `Telefon: ${order.customer_phone}`,
    `Email: ${order.customer_email || '-'}`,
    `Adresa: ${order.customer_address}, ${order.customer_city}`,
    `Metoda plata: ${order.payment_method}`,
    `Subtotal: ${Number(order.subtotal_amount).toFixed(2)} lei`,
    `Reducere: ${Number(order.discount_amount).toFixed(2)} lei`,
    `Total: ${Number(order.total_amount).toFixed(2)} lei`,
    ``,
    `Produse:`,
    formatItems(items),
    ``,
    `Observatii: ${order.customer_note || '-'}`
  ].join('\n');

  if (adminEmail) {
    await sendResendEmail({
      to: adminEmail,
      subject: subjectAdmin,
      text: textAdmin,
      html: renderAdminHtml(order, items),
      headers: { 'X-Entity-Ref-ID': `admin-${order.order_number}` }
    });
  }

  if (customerEmail) {
    const subjectCustomer = `Confirmare comanda ${order.order_number}`;
    const textCustomer = [
      `Salut, ${order.customer_name}!`,
      ``,
      `Comanda ta a fost inregistrata cu succes.`,
      `Numar comanda: ${order.order_number}`,
      `Metoda plata: ${order.payment_method}`,
      `Total: ${Number(order.total_amount).toFixed(2)} lei`,
      ``,
      `Produse:`,
      formatItems(items),
      ``,
      `Te contactam pentru confirmare.`,
      `Flori de Mai Bujori`
    ].join('\n');

    await sendResendEmail({
      to: customerEmail,
      subject: subjectCustomer,
      text: textCustomer,
      html: renderCustomerHtml(order, items),
      headers: { 'X-Entity-Ref-ID': `customer-${order.order_number}` }
    });
  }

  return { sent: true, reason: 'ok' };
}

async function sendAdminPasswordVerificationCode({ to, code }) {
  const normalizedTo = String(to || '').trim().toLowerCase();
  if (!normalizedTo) {
    return { sent: false, reason: 'missing_recipient' };
  }

  const subject = 'Cod verificare schimbare parola admin';
  const text = [
    'Ai cerut schimbarea parolei de admin.',
    `Codul tau de verificare este: ${code}`,
    'Codul expira in 10 minute.',
    'Daca nu ai initiat aceasta cerere, ignora acest email.'
  ].join('\n');

  await sendResendEmail({
    to: normalizedTo,
    subject,
    text,
    html: emailLayout({
      eyebrow: 'Securitate admin',
      title: 'Verificare schimbare parola',
      intro: 'Foloseste codul de mai jos pentru a confirma schimbarea parolei.',
      contentHtml: `
        <div style="padding: 18px; border: 1px solid #f0e0e8; border-radius: 14px; background: #fff8fb; text-align: center;">
          <p style="margin: 0 0 8px; color: #6c5763; font-size: 14px;">Cod de verificare</p>
          <p style="margin: 0; color: #bc4f86; font-size: 36px; font-weight: 800; letter-spacing: 6px;">${escapeHtml(code)}</p>
          <p style="margin: 10px 0 0; color: #7a6672; font-size: 13px;">Expira in 10 minute.</p>
        </div>
      `,
      footerNote: 'Daca nu ai initiat aceasta actiune, ignora emailul si verifica securitatea contului.'
    }),
    headers: { 'X-Entity-Ref-ID': `admin-password-${Date.now()}` }
  });

  return { sent: true, reason: 'ok' };
}

module.exports = { sendOrderEmails, verifyEmailTransport, sendAdminPasswordVerificationCode };
