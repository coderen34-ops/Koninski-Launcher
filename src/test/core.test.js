'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const core = require('../core');

(async () => {
  // Offline UUID: bilinen vanilla değeri (Notch -> b50ad385-829d-3141-a216-7e7d7539ba7f)
  assert.strictEqual(core.offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');

  assert(core.validNick('Abc_12'));
  assert(!core.validNick('ab'));
  assert(!core.validNick('has space'));

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
  assert.throws(() => core.safeJoin(base, '../evil.jar'));
  assert.doesNotThrow(() => core.safeJoin(base, 'mods/a.jar'));

  // Yerel sunucu ile manifest sync testi
  const modA = Buffer.from('mod-a-v1'), modB = Buffer.from('mod-b');
  const sha = b => crypto.createHash('sha1').update(b).digest('hex');
  const srv = http.createServer((req, res) => {
    if (req.url === '/a.jar') return res.end(modA);
    if (req.url === '/b.jar') return res.end(modB);
    res.statusCode = 404; res.end();
  }).listen(0);
  const port = srv.address().port;
  const game = path.join(base, 'game');
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(game, 'mods', 'oyuncunun-kendi.jar'), 'x');

  const log = () => {};
  await core.syncFiles(game, { files: [
    { path: 'mods/a.jar', url: `http://localhost:${port}/a.jar`, sha1: sha(modA) },
    { path: 'mods/b.jar', url: `http://localhost:${port}/b.jar`, sha1: sha(modB) }
  ] }, log);
  assert(fs.existsSync(path.join(game, 'mods', 'a.jar')));
  assert(fs.existsSync(path.join(game, 'mods', 'b.jar')));

  // b manifest'ten çıkınca silinmeli, oyuncunun kendi modu kalmalı
  await core.syncFiles(game, { files: [
    { path: 'mods/a.jar', url: `http://localhost:${port}/a.jar`, sha1: sha(modA) }
  ] }, log);
  assert(!fs.existsSync(path.join(game, 'mods', 'b.jar')));
  assert(fs.existsSync(path.join(game, 'mods', 'oyuncunun-kendi.jar')));

  // Bozuk hash reddedilmeli
  await assert.rejects(core.syncFiles(game, { files: [
    { path: 'mods/c.jar', url: `http://localhost:${port}/b.jar`, sha1: 'deadbeef' }
  ] }, log), /Hash/);

  // Yol kaçışı reddedilmeli
  await assert.rejects(core.syncFiles(game, { files: [
    { path: '../../evil.jar', url: `http://localhost:${port}/a.jar` }
  ] }, log), /Geçersiz/);

  srv.close();
  console.log('Tüm testler geçti.');
})().catch(e => { console.error(e); process.exit(1); });

// ---- servers.dat testi ----
(() => {
  const nbt = require('prismarine-nbt');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-srv-'));
  core.ensureServers(dir, [{ name: 'Koninski SMP', ip: 'koninski.com.tr' }]);
  const read = () => nbt.simplify(nbt.parseUncompressed(fs.readFileSync(path.join(dir, 'servers.dat')), 'big'));
  assert.deepStrictEqual(read().servers.map(s => s.ip), ['koninski.com.tr']);
  // Tekrar çağrı: çift kayıt olmamalı
  core.ensureServers(dir, [{ name: 'Koninski SMP', ip: 'koninski.com.tr' }]);
  assert.strictEqual(read().servers.length, 1);
  // Oyuncunun kendi sunucusu korunmalı, yeni sunucu başa eklenmeli
  core.ensureServers(dir, [{ name: 'Diger', ip: 'diger.example' }, { name: 'Koninski SMP', ip: 'koninski.com.tr' }]);
  assert.deepStrictEqual(read().servers.map(s => s.ip), ['diger.example', 'koninski.com.tr']);
  console.log('servers.dat testi geçti.');
})();

// ---- Modrinth erişilemezken paketli jar'a düşme testi ----
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-mod-'));
  const bundled = path.join(__dirname, '..', 'bundled-mods');
  const cfg = require('../config.json');
  // Gerçek ağ olmadan çalışsın diye getJson'u geçici olarak kır
  const orig = core.getJson;
  const https = require('https');
  const realGet = https.get;
  https.get = (...a) => { const r = new (require('events'))(); process.nextTick(() => r.emit('error', new Error('ağ yok'))); return r; };
  const rv = core.resolveVersion(cfg, '26.2');
  await core.syncModrinth(dir, rv.mods, rv.minecraft, bundled, () => {});
  https.get = realGet;
  const jars = fs.readdirSync(path.join(dir, 'mods')).sort();
  assert.strictEqual(jars.length, 4); // 3 yedek mod + koninski-guard
  assert(jars.some(j => j.startsWith('fabric-api')));
  console.log('Modrinth yedek testi geçti.');
})().catch(e => { console.error(e); process.exit(1); });

// ---- bundledOnly (koninski-guard) testi ----
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-guard-'));
  const bundled = path.join(dir, 'b'); fs.mkdirSync(bundled);
  fs.writeFileSync(path.join(bundled, 'koninski-guard-2.0.0.jar'), 'yeni');
  const modsDir = path.join(dir, 'g', 'mods'); fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'koninski-guard-1.0.0.jar'), 'eski');
  fs.writeFileSync(path.join(modsDir, 'baska-mod.jar'), 'x');
  await core.syncModrinth(path.join(dir, 'g'), [{ name: 'koninski-guard', bundledOnly: 'koninski-guard-2.0.0.jar' }], '26.2', bundled, () => {});
  assert.deepStrictEqual(fs.readdirSync(modsDir).sort(), ['baska-mod.jar', 'koninski-guard-2.0.0.jar']);
  console.log('bundledOnly testi geçti.');
})().catch(e => { console.error(e); process.exit(1); });

// ---- sürüm profili testi ----
(() => {
  const cfg = require('../config.json');
  const a = core.resolveVersion(cfg, '26.2');
  assert.strictEqual(a.gameDirName, 'game');
  assert.strictEqual(a.javaMajor, 25);
  assert.ok(a.mods.some(m => m.bundled), '26.2: yedek jar korunmalı');
  const b = core.resolveVersion(cfg, '1.20.1');
  assert.strictEqual(b.gameDirName, 'game-1.20.1');
  assert.strictEqual(b.javaMajor, 17);
  assert.ok(!b.mods.some(m => m.bundled), '1.20.1: 26.2 yedek jarları gelmemeli');
  assert.strictEqual(b.mods.find(m => m.name === 'koninski-guard').bundledOnly, `koninski-guard-mod-${cfg.guardVersion}-mc1.20.1.jar`);
  assert.strictEqual(core.resolveVersion(cfg, 'yok').minecraft, '26.2'); // bilinmeyen -> varsayılan
  console.log('Sürüm profili testi geçti.');
})();
