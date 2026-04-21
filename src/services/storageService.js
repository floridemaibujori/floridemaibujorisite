const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

const hasSupabaseStorage = Boolean(supabaseUrl && serviceRoleKey);
const supabase = hasSupabaseStorage ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }) : null;

function sanitizeName(fileName) {
  const ext = path.extname(fileName || '');
  const base = path
    .basename(fileName || 'file', ext)
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  return `${base || 'file'}${ext.toLowerCase()}`;
}

function makeFileName(fileName) {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${sanitizeName(fileName)}`;
}

async function saveLocally(file, folder = 'products') {
  const fileName = makeFileName(file.originalname);
  const targetDir = path.join(process.cwd(), 'public', 'uploads', folder);
  fs.mkdirSync(targetDir, { recursive: true });
  const absolute = path.join(targetDir, fileName);
  await fs.promises.writeFile(absolute, file.buffer);
  return `/uploads/${folder}/${fileName}`;
}

function getSupabaseObjectPathFromPublicUrl(publicUrl) {
  if (!publicUrl || !hasSupabaseStorage) {
    return null;
  }

  const marker = `/storage/v1/object/public/${bucketName}/`;
  const markerPos = publicUrl.indexOf(marker);
  if (markerPos === -1) {
    return null;
  }

  return decodeURIComponent(publicUrl.slice(markerPos + marker.length));
}

async function uploadImage(file, folder = 'products') {
  if (!file || !file.buffer) {
    throw new Error('Fisier invalid pentru upload.');
  }

  if (!hasSupabaseStorage) {
    return saveLocally(file, folder);
  }

  const objectPath = `${folder}/${makeFileName(file.originalname)}`;
  const { error } = await supabase.storage
    .from(bucketName)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false
    });

  if (error) {
    throw new Error(`Upload Supabase esuat: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function removeImage(imagePath) {
  if (!imagePath) {
    return;
  }

  if (String(imagePath).startsWith('/uploads/')) {
    const absolute = path.join(process.cwd(), 'public', imagePath.replace(/^\//, ''));
    if (fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
    }
    return;
  }

  if (!hasSupabaseStorage) {
    return;
  }

  const objectPath = getSupabaseObjectPathFromPublicUrl(String(imagePath));
  if (!objectPath) {
    return;
  }

  await supabase.storage.from(bucketName).remove([objectPath]);
}

module.exports = {
  hasSupabaseStorage,
  bucketName,
  uploadImage,
  removeImage
};

