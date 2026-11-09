'use strict';
// Sunucu profilleri (Koninski SMP / Demir ve Siper) ve Forge kurulum dosyası seçimi.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../core');
const cfg = require('../config.json');

(async () => {
  // Profil listesi: iki sunucu, SMP önce
  const list = core.listProfiles(cfg);
  assert.deepStrictEqual(list.map(p => p.id), ['smp', 'dvs']);
  assert.strictEqual(list[1].loader, 'forge');

  // SMP: eski sürüm sistemi aynen çalışır (oyun klasörü, Java, Guard modları)
  const smp = core.resolveProfile(cfg, 'smp', '26.2');
  assert.strictEqual(smp.gameDirName, 'game');
  assert.strictEqual(smp.javaMajor, 25);
  assert.strictEqual(smp.loader, 'fabric');
  assert.strictEqual(smp.versionLocked, false);
  assert.ok(smp.mods.some(m => m.name === 'koninski-guard'));
  assert.strictEqual(core.resolveProfile(cfg, 'smp', '1.20.1').gameDirName, 'game-1.20.1');

  // Demir ve Siper: Forge 1.20.1, Java 17, ayrı klasör, Fabric'e özel Koninski modları YOK
  const dvs = core.resolveProfile(cfg, 'dvs', '26.2');
  assert.strictEqual(dvs.serverAddress, 'demirvesiper.exaroton.me');
  assert.strictEqual(dvs.quickPlay, true);
  assert.strictEqual(dvs.loader, 'forge');
  assert.strictEqual(dvs.minecraft, '1.20.1');
  assert.strictEqual(dvs.javaMajor, 17);
  assert.strictEqual(dvs.gameDirName, 'game-dvs');
  assert.strictEqual(dvs.versionLocked, true);
  assert.ok(!dvs.mods.some(m => m.bundledOnly || m.slug === 'fabric-api'));
  assert.strictEqual(dvs.forgeVersion, '47.4.29'); // sunucuyla aynı Forge
  // Sunucudaki modlar sabit dosya listesi olarak gelir: hepsi mods/ altında, SHA1'li, Modrinth CDN'den
  assert.ok(dvs.files.length >= 18);
  for (const f of dvs.files) {
    assert.ok(f.path.startsWith('mods/') && f.path.endsWith('.jar'), f.path);
    assert.match(f.sha1, /^[0-9a-f]{40}$/);
    assert.ok(f.url.startsWith('https://cdn.modrinth.com/'), f.url);
  }
  assert.ok(dvs.files.some(f => f.path.includes('create-1.20.1')));
  assert.deepStrictEqual(core.resolveProfile(cfg, 'smp', '26.2').files, undefined);
  assert.deepStrictEqual(dvs.servers, [{ name: 'Demir ve Siper', ip: 'demirvesiper.exaroton.me' }]);
  // Adres boş bırakılırsa: listeye bir şey eklenmez, otomatik bağlanılmaz
  const noAddr = { ...cfg, profiles: cfg.profiles.map(p => p.id === 'dvs' ? { ...p, serverAddress: '' } : p) };
  const d2 = core.resolveProfile(noAddr, 'dvs');
  assert.strictEqual(d2.quickPlay, false);
  assert.deepStrictEqual(d2.servers, []);

  // Bilinmeyen profil -> varsayılan (smp); profil tanımı olmayan eski config -> tek SMP profili
  assert.strictEqual(core.resolveProfile(cfg, 'yok').id, 'smp');
  const legacy = { ...cfg }; delete legacy.profiles;
  assert.deepStrictEqual(core.listProfiles(legacy).map(p => p.id), ['smp']);
  assert.strictEqual(core.resolveProfile(legacy, undefined, '26.2').gameDirName, 'game');

  // Forge sürüm seçimi
  const promos = { promos: { '1.20.1-latest': '47.9.9', '1.20.1-recommended': '47.4.0' } };
  assert.strictEqual(core.pickForgeVersion(promos, '1.20.1', 'recommended'), '47.4.0');
  assert.strictEqual(core.pickForgeVersion(promos, '1.20.1', 'latest'), '47.9.9');
  assert.strictEqual(core.pickForgeVersion(promos, '1.20.1', '47.1.0'), '47.1.0');
  assert.strictEqual(core.pickForgeVersion({ promos: { '1.20.1-latest': '47.9.9' } }, '1.20.1', 'recommended'), '47.9.9');
  assert.strictEqual(core.pickForgeVersion(promos, '1.19.2', 'recommended'), null);

  // ensureForge: doğru adresten indirir, ikinci çağrıda tekrar indirmez, ağ yokken eldekini kullanır
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-forge-'));
  const urls = [];
  const fakeDl = async (url, dest) => { urls.push(url); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'jar'); };
  const f1 = await core.ensureForge(root, '1.20.1', 'recommended', () => {}, async () => promos, fakeDl);
  assert.strictEqual(path.basename(f1), 'forge-1.20.1-47.4.0-installer.jar');
  assert.deepStrictEqual(urls, ['https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.0/forge-1.20.1-47.4.0-installer.jar']);
  await core.ensureForge(root, '1.20.1', 'recommended', () => {}, async () => promos, fakeDl);
  assert.strictEqual(urls.length, 1);
  const offline = await core.ensureForge(root, '1.20.1', 'recommended', () => {}, async () => { throw new Error('ağ yok'); }, fakeDl);
  assert.strictEqual(offline, f1);
  await assert.rejects(core.ensureForge(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-f2-')), '1.20.1', 'recommended', () => {},
    async () => { throw new Error('ağ yok'); }, fakeDl), /bulunamadı/);

  console.log('Profil testleri geçti.');
})().catch(e => { console.error(e); process.exit(1); });
