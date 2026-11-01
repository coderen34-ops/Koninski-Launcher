'use strict';
// Giriş noktası. Daha yeni, doğrulanmış bir güncelleme paketi varsa onu, yoksa kurulumla gelen kodu çalıştırır.
const { app } = require('electron');
const path = require('path');
const fs = require('original-fs'); // asar dosyasını düz dosya olarak okumak için
const crypto = require('crypto');

function cmp(a, b) {
  const x = String(a).split('.').map(n => parseInt(n, 10) || 0), y = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

let entry = path.join(__dirname, 'main.js');
try {
  const baseVersion = require('./package.json').version;
  const dir = path.join(app.getPath('appData'), '.koninski', 'updates');
  const cur = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'));
  const file = path.join(dir, path.basename(cur.file));
  if (cmp(cur.version, baseVersion) > 0 && fs.existsSync(file)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sha === cur.sha256) entry = path.join(file, 'main.js');
  }
} catch (_) { /* güncelleme yok ya da okunamadı: kurulumla gelen sürüm */ }

require(entry);
