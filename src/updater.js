'use strict';
// Kendini güncelleme: imzalı app-<sürüm>.asar paketini indirir, doğrular, bootstrap'in yükleyeceği yere koyar.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const core = require('./core');

// Güncelleme imza anahtarı (Ed25519, SPKI/DER, base64). Gizli kısmı repoda DEĞİL, sahibindedir.
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEA+gvTx6UwUJyyUZl6jX7c7z/iue5nVFMYH9t+dfZ6GX0=';

function cmpVersion(a, b) {
  const x = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const y = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// İmzalanan metin: sürüm, dosya adı, SHA-256 ve boyut birbirine bağlıdır.
function signedMessage(m) {
  return Buffer.from(`koninski-launcher|${m.version}|${m.file}|${m.sha256}|${m.size}`);
}

function verifySignature(meta, publicKeyB64 = PUBLIC_KEY_B64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, signedMessage(meta), key, Buffer.from(meta.sig, 'base64'));
  } catch (_) { return false; }
}

function validMeta(m) {
  return m && /^\d+\.\d+\.\d+$/.test(m.version || '')
    && /^app-\d+\.\d+\.\d+\.asar$/.test(m.file || '')
    && /^[0-9a-f]{64}$/.test(m.sha256 || '')
    && Number.isInteger(m.size) && m.size > 0 && m.size <= 200 * 1024 * 1024
    && typeof m.sig === 'string';
}

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' zaman aşımı')), ms))]);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * Yeni sürüm varsa indirir ve hazırlar. Dönüş: { updated: bool, version? }.
 * Hata fırlatırsa güncelleme uygulanmamıştır (mevcut sürüm çalışmaya devam eder).
 */
async function checkAndApply({ currentVersion, updatesDir, baseUrl, publicKey = PUBLIC_KEY_B64, log = () => {},
  fetchJson = core.getJson, download = core.download }) {
  if (!baseUrl) return { updated: false };
  const meta = await withTimeout(fetchJson(`${baseUrl}/latest.json?t=${Date.now()}`), 8000, 'güncelleme sorgusu');
  if (!validMeta(meta)) throw new Error('latest.json geçersiz');
  if (cmpVersion(meta.version, currentVersion) <= 0) return { updated: false };
  if (!verifySignature(meta, publicKey)) throw new Error('güncelleme imzası geçersiz, reddedildi');

  log(`Launcher ${meta.version} indiriliyor...`);
  fs.mkdirSync(updatesDir, { recursive: true });
  const dest = path.join(updatesDir, meta.file);
  await download(`${baseUrl}/${meta.file}`, dest, (g, t) => log(null, { progress: g / t, file: 'Launcher' }));
  const size = fs.statSync(dest).size;
  if (size !== meta.size || sha256File(dest) !== meta.sha256) {
    try { fs.unlinkSync(dest); } catch (_) {}
    throw new Error('indirilen güncelleme doğrulanamadı (boyut/hash)');
  }

  // current.json: önceki girdiyi "previous" olarak sakla, yeni sürümü etkinleştir.
  const curPath = path.join(updatesDir, 'current.json');
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(curPath, 'utf8')); } catch (_) {}
  const next = { version: meta.version, file: meta.file, sha256: meta.sha256, previous: prev ? prev.file : null };
  fs.writeFileSync(curPath + '.tmp', JSON.stringify(next));
  fs.renameSync(curPath + '.tmp', curPath);

  // Eski paketleri temizle: yalnızca etkin ve bir önceki kalır.
  for (const f of fs.readdirSync(updatesDir)) {
    if (/^app-.*\.asar$/.test(f) && f !== next.file && f !== next.previous) {
      try { fs.unlinkSync(path.join(updatesDir, f)); } catch (_) {}
    }
  }
  return { updated: true, version: meta.version };
}

module.exports = { checkAndApply, cmpVersion, verifySignature, signedMessage, validMeta, PUBLIC_KEY_B64 };
