'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const updater = require('../updater');

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), priv: privateKey };
}
function makeMeta(kp, version, data, over = {}) {
  const m = { version, file: `app-${version}.asar`, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length, ...over };
  m.sig = crypto.sign(null, updater.signedMessage(m), kp.priv).toString('base64');
  return m;
}

(async () => {
  assert.strictEqual(updater.cmpVersion('1.1.0', '1.0.9'), 1);
  assert.strictEqual(updater.cmpVersion('1.10.0', '1.9.0'), 1);
  assert.strictEqual(updater.cmpVersion('1.1.0', '1.1.0'), 0);

  const kp = keypair(), other = keypair();
  const data = crypto.randomBytes(5000);
  let served = { meta: null, bytes: data };
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/latest.json')) return res.end(JSON.stringify(served.meta));
    if (req.url.startsWith('/app-')) return res.end(served.bytes);
    res.statusCode = 404; res.end();
  }).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-upd-'));
  const run = (cur) => updater.checkAndApply({ currentVersion: cur, updatesDir: dir, baseUrl: base, publicKey: kp.pub });

  // 1) Daha yeni, doğru imzalı sürüm uygulanır
  served.meta = makeMeta(kp, '1.2.0', data);
  let r = await run('1.1.0');
  assert.deepStrictEqual(r, { updated: true, version: '1.2.0' });
  const cur = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'));
  assert.strictEqual(cur.version, '1.2.0');
  assert(fs.existsSync(path.join(dir, 'app-1.2.0.asar')));

  // 2) Aynı sürüm: güncelleme yok
  assert.strictEqual((await run('1.2.0')).updated, false);
  // 3) Daha eski sürüm sunulursa (geri alma saldırısı) uygulanmaz
  served.meta = makeMeta(kp, '1.0.5', data);
  assert.strictEqual((await run('1.2.0')).updated, false);

  // 4) Başka anahtarla imzalı paket reddedilir
  served.meta = makeMeta(other, '1.3.0', data);
  await assert.rejects(run('1.2.0'), /imza/);
  // 5) Meta kurcalanmış (imzadan sonra sürüm değişmiş) reddedilir
  const good = makeMeta(kp, '1.3.0', data); good.version = '9.9.9'; good.file = 'app-9.9.9.asar';
  served.meta = good;
  await assert.rejects(run('1.2.0'), /imza/);
  // 6) İmza doğru ama indirilen içerik farklı: hash reddi, current.json değişmez
  served.meta = makeMeta(kp, '1.3.0', data); served.bytes = crypto.randomBytes(5000);
  await assert.rejects(run('1.2.0'), /doğrulanamadı/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8')).version, '1.2.0');
  assert(!fs.existsSync(path.join(dir, 'app-1.3.0.asar')));
  // 7) Dosya adı yol kaçışı içeriyorsa geçersiz
  served.bytes = data;
  served.meta = makeMeta(kp, '1.3.0', data, { file: '../evil.asar' });
  await assert.rejects(run('1.2.0'), /geçersiz/);
  // 8) Sonraki geçerli sürüm: eskiler temizlenir, bir önceki saklanır
  served.meta = makeMeta(kp, '1.3.0', data);
  assert.strictEqual((await run('1.2.0')).updated, true);
  served.meta = makeMeta(kp, '1.4.0', data);
  assert.strictEqual((await run('1.3.0')).updated, true);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.asar')).sort();
  assert.deepStrictEqual(files, ['app-1.3.0.asar', 'app-1.4.0.asar']);

  srv.close();
  console.log('Güncelleyici testleri geçti.');
})().catch(e => { console.error(e); process.exit(1); });
