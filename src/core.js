'use strict';
// Launcher çekirdeği: Electron'dan bağımsız, test edilebilir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');

// ---------- Yardımcılar ----------

// Sunucu offline-mode olduğu için UUID, "OfflinePlayer:<nick>" MD5'inden türetilir
// (vanilla sunucunun yaptığıyla birebir aynı; böylece envanter/izin eşleşir).
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function validNick(n) {
  return /^[A-Za-z0-9_]{3,16}$/.test(n || '');
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

// Güvenli yol: manifest'ten gelen yolun oyun klasörü dışına çıkmasını engeller.
function safeJoin(base, rel) {
  const full = path.resolve(base, rel);
  if (full !== path.resolve(base) && !full.startsWith(path.resolve(base) + path.sep)) {
    throw new Error('Geçersiz dosya yolu: ' + rel);
  }
  return full;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'KoninskiLauncher/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}: ${url}`)); }
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'KoninskiLauncher/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}: ${url}`)); }
      mkdirp(path.dirname(dest));
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      res.on('data', c => { got += c.length; if (onProgress && total) onProgress(got, total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ---------- Manifest senkronu (modlar, config, resourcepack...) ----------
// manifest.files[]: { path: "mods/x.jar", url, sha1 }
// Daha önce launcher'ın indirdiği ama artık manifest'te olmayan dosyalar silinir;
// oyuncunun kendi eklediği dosyalara dokunulmaz.
async function syncFiles(gameDir, manifest, log) {
  const statePath = path.join(gameDir, '.koninski-managed.json');
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}
  const files = manifest.files || [];
  const want = new Set(files.map(f => f.path.replace(/\\/g, '/')));

  for (const old of prev) {
    if (!want.has(old)) {
      try { fs.unlinkSync(safeJoin(gameDir, old)); log(`Kaldırıldı: ${old}`); } catch (_) {}
    }
  }

  let i = 0;
  for (const f of files) {
    i++;
    const dest = safeJoin(gameDir, f.path);
    let ok = false;
    if (fs.existsSync(dest) && f.sha1) ok = (await sha1File(dest)) === f.sha1.toLowerCase();
    else if (fs.existsSync(dest)) ok = true;
    if (ok) continue;
    log(`İndiriliyor (${i}/${files.length}): ${path.basename(f.path)}`, { file: f.path });
    await download(f.url, dest, (g, t) => log(null, { progress: g / t, file: f.path }));
    if (f.sha1 && (await sha1File(dest)).toLowerCase() !== f.sha1.toLowerCase()) {
      fs.unlinkSync(dest);
      throw new Error(`Hash uyuşmadı: ${f.path}`);
    }
  }
  fs.writeFileSync(statePath, JSON.stringify([...want]));
}

// ---------- Java (Adoptium JRE, Windows) ----------
async function ensureJava(rootDir, major, log) {
  const jreDir = path.join(rootDir, 'runtime', `jre-${major}`);
  const javaw = () => {
    if (!fs.existsSync(jreDir)) return null;
    for (const d of fs.readdirSync(jreDir)) {
      const p = path.join(jreDir, d, 'bin', 'javaw.exe');
      if (fs.existsSync(p)) return p;
      const q = path.join(jreDir, d, 'bin', 'java');
      if (fs.existsSync(q)) return q;
    }
    return null;
  };
  const existing = javaw();
  if (existing) return existing;

  log(`Java ${major} indiriliyor...`);
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  const zipPath = path.join(rootDir, 'runtime', `jre-${major}.zip`);
  await download(url, zipPath, (g, t) => log(null, { progress: g / t, file: 'Java' }));
  log('Java çıkarılıyor...');
  mkdirp(jreDir);
  new AdmZip(zipPath).extractAllTo(jreDir, true);
  fs.unlinkSync(zipPath);
  const j = javaw();
  if (!j) throw new Error('Java kurulumu başarısız.');
  return j;
}

// ---------- Fabric ----------
// Fabric'in profil JSON'unu indirip versions/ altına koyar; MCLC bunu custom sürüm olarak kullanır.
async function ensureFabric(rootDir, mcVersion, loaderVersion, log) {
  let loader = loaderVersion;
  if (!loader || loader === 'latest') {
    const list = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!list.length) throw new Error(`Fabric, ${mcVersion} için bulunamadı.`);
    loader = list[0].loader.version;
  }
  const id = `fabric-loader-${loader}-${mcVersion}`;
  const dir = path.join(rootDir, 'versions', id);
  const jsonPath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(jsonPath)) {
    log(`Fabric ${loader} hazırlanıyor...`);
    const prof = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loader}/profile/json`);
    mkdirp(dir);
    fs.writeFileSync(jsonPath, JSON.stringify(prof));
  }
  return id;
}

// ---------- Modrinth: her mod için en güncel sürümü bul ve indir ----------
// mods[]: { slug, bundled }  -> bundled: ağ yoksa kullanılacak, launcher ile gelen jar adı
// Modrinth erişilemezse paketle gelen jar kullanılır; hiçbir şey bozulmaz.
async function syncModrinth(gameDir, mods, mcVersion, bundledDir, log) {
  const modsDir = path.join(gameDir, 'mods');
  mkdirp(modsDir);
  const statePath = path.join(gameDir, '.koninski-modrinth.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}

  for (const m of mods) {
    // Sadece launcher ile gelen mod (ör. koninski-guard): her açılışta yerel jar ile eşitlenir,
    // aynı ada ait eski sürümler silinir.
    if (m.bundledOnly) {
      const src = path.join(bundledDir, m.bundledOnly);
      const dest = path.join(modsDir, m.bundledOnly);
      for (const f of fs.readdirSync(modsDir)) {
        if (f.startsWith(m.name + '-') && f !== m.bundledOnly) { try { fs.unlinkSync(path.join(modsDir, f)); } catch (_) {} }
      }
      const data = fs.readFileSync(src);
      if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(data)) fs.writeFileSync(dest, data);
      continue;
    }
    let latest = null;
    try {
      const q = `https://api.modrinth.com/v2/project/${m.slug}/version`
        + `?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`;
      const list = await getJson(q);
      if (Array.isArray(list) && list.length) {
        list.sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
        const f = list[0].files.find(x => x.primary) || list[0].files[0];
        latest = { file: f.filename, url: f.url, sha1: f.hashes.sha1 };
      }
    } catch (e) {
      log(`${m.slug}: Modrinth'e ulaşılamadı, yerel sürüm kullanılacak.`);
    }

    const current = state[m.slug];
    if (latest) {
      const dest = path.join(modsDir, latest.file);
      let ok = fs.existsSync(dest) && (await sha1File(dest)) === latest.sha1.toLowerCase();
      if (!ok) {
        log(`İndiriliyor: ${latest.file}`, { file: latest.file });
        await download(latest.url, dest, (g, t) => log(null, { progress: g / t, file: latest.file }));
        if ((await sha1File(dest)).toLowerCase() !== latest.sha1.toLowerCase()) {
          fs.unlinkSync(dest);
          throw new Error(`Hash uyuşmadı: ${latest.file}`);
        }
      }
      if (current && current !== latest.file) { try { fs.unlinkSync(path.join(modsDir, current)); } catch (_) {} }
      state[m.slug] = latest.file;
    } else if (!current && m.bundled) {
      // İlk kurulum + ağ yok: paketle gelen jar'ı kopyala
      const src = path.join(bundledDir, m.bundled);
      if (fs.existsSync(src)) {
        fs.writeFileSync(path.join(modsDir, m.bundled), fs.readFileSync(src));
        state[m.slug] = m.bundled;
      }
    }
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}


// ---------- Sürüm profilleri ----------
// config.versions içinden seçilen sürüm için: Minecraft, Java, oyun klasörü adı ve mod listesi.
// 26.2 eski kurulumlarla uyumlu kalsın diye "game" klasörünü kullanır; diğerleri "game-<mc>".
function resolveVersion(config, id) {
  const list = config.versions || [{ mc: config.minecraft, java: config.javaMajor }];
  const v = list.find(x => x.mc === id) || list.find(x => x.mc === (config.defaultVersion || config.minecraft)) || list[0];
  const mods = (config.mods || []).map(m => {
    const o = { ...m };
    if (o.bundledOnly) o.bundledOnly = o.bundledOnly.replace('{gv}', config.guardVersion || '').replace('{mc}', v.mc);
    if (o.bundled && o.bundledMc && o.bundledMc !== v.mc) delete o.bundled; // yedek jar sadece kendi sürümüne uygun
    return o;
  });
  return { minecraft: v.mc, javaMajor: v.java, gameDirName: v.mc === '26.2' ? 'game' : 'game-' + v.mc, mods };
}

// ---------- Çoklu oyuncu listesine sunucuları ekle (servers.dat) ----------
// Var olan sunucular korunur; aynı IP zaten varsa tekrar eklenmez.
function ensureServers(gameDir, servers) {
  const nbt = require('prismarine-nbt');
  const file = path.join(gameDir, 'servers.dat');
  let entries = [];
  if (fs.existsSync(file)) {
    try {
      const parsed = nbt.parseUncompressed(fs.readFileSync(file), 'big');
      const list = parsed && parsed.value.servers && parsed.value.servers.value.value;
      if (Array.isArray(list)) entries = list;
    } catch (_) { entries = []; }
  }
  const have = new Set(entries.map(e => e.ip && e.ip.value));
  const wanted = [];
  for (const s of servers) if (!have.has(s.ip)) wanted.push({ name: nbt.string(s.name), ip: nbt.string(s.ip) });
  if (!wanted.length && fs.existsSync(file)) return;
  // Bizim sunucular listenin başına, oyuncunun kendi sunucuları arkasına
  const all = [...wanted, ...entries];
  const root = nbt.comp({ servers: nbt.list(nbt.comp(all)) });
  mkdirp(gameDir);
  fs.writeFileSync(file, nbt.writeUncompressed(root, 'big'));
}

// ---------- Oyuncu kimliği (Guard) ----------
// İlk çalıştırmada Ed25519 anahtar çifti üretilir ve ayarlarda saklanır; kullanıcı hiçbir şey girmez.
function newIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  return { pub: publicKey.toString('base64'), priv: privateKey.toString('base64') };
}

module.exports = {
  resolveVersion, newIdentity, offlineUuid, validNick, sha1File, safeJoin, getJson, download, syncFiles, ensureJava, ensureFabric, syncModrinth, ensureServers };
