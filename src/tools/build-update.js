'use strict';
// Kullanım: node tools/build-update.js <imza-anahtari.pem> [çıktı-klasörü]
// app-<sürüm>.asar paketini üretir ve imzalı latest.json yazar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const asar = require('@electron/asar');
const { signedMessage } = require('../updater');

(async () => {
  const keyFile = process.argv[2];
  const outDir = path.resolve(process.argv[3] || 'update-out');
  if (!keyFile) { console.error('Kullanım: node tools/build-update.js <anahtar.pem> [çıktı]'); process.exit(1); }
  const root = path.join(__dirname, '..');
  const pkg = require('../package.json');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'koninski-stage-'));

  for (const f of ['main.js', 'core.js', 'updater.js', 'bootstrap.js', 'preload.js', 'config.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, f), path.join(stage, f));
  }
  fs.cpSync(path.join(root, 'renderer'), path.join(stage, 'renderer'), { recursive: true });
  // Üçüncü taraf yedek jar'lar (Fabric API, Voice Chat...) herkese açık pakete konmaz; yalnızca Guard modu.
  fs.mkdirSync(path.join(stage, 'bundled-mods'));
  for (const f of fs.readdirSync(path.join(root, 'bundled-mods'))) {
    if (/^koninski-(guard|client)-/.test(f)) fs.copyFileSync(path.join(root, 'bundled-mods', f), path.join(stage, 'bundled-mods', f));
  }

  // Kaynak paketi (yemek ve eşya görselleri): launcher oyuncuya otomatik kurar.
  fs.cpSync(path.join(root, 'bundled-pack'), path.join(stage, 'bundled-pack'), { recursive: true });

  const stagePkg = { ...pkg };
  if (process.argv[4]) stagePkg.version = process.argv[4]; // sınama için sürüm geçersiz kılma
  delete stagePkg.devDependencies; delete stagePkg.build; delete stagePkg.scripts;
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagePkg, null, 2));
  cp.execSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts', { cwd: stage, stdio: 'inherit' });

  fs.mkdirSync(outDir, { recursive: true });
  const version = process.argv[4] || pkg.version;
  const file = `app-${version}.asar`;
  const outFile = path.join(outDir, file);
  await asar.createPackage(stage, outFile);

  const data = fs.readFileSync(outFile);
  const meta = { version, file, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length };
  meta.sig = crypto.sign(null, signedMessage(meta), fs.readFileSync(keyFile)).toString('base64');
  meta.date = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(meta, null, 2));
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('Hazır:', outFile, (data.length / 1048576).toFixed(1) + ' MB');
  console.log(JSON.stringify(meta));
})().catch(e => { console.error(e); process.exit(1); });
