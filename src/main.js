'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const core = require('./core');
const updater = require('./updater');
const APP_VERSION = require('./package.json').version;
const config = require('./config.json');

const rootDir = path.join(app.getPath('appData'), '.koninski');
const settingsPath = path.join(rootDir, 'launcher-settings.json');
let win;
let launching = false;
let updating = false;

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) { return {}; }
}
function saveSettings(s) {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const log = (msg, extra) => send('status', { msg, ...(extra || {}) });

function createWindow() {
  win = new BrowserWindow({
    width: 880, height: 640, resizable: false, autoHideMenuBar: true,
    backgroundColor: '#14161c', title: config.serverName + ' Launcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.removeMenu();
  if (process.env.KONINSKI_SMOKE) {
    win.webContents.once('did-finish-load', () => {
      fs.writeFileSync(process.env.KONINSKI_SMOKE, APP_VERSION + '|' + __dirname);
      app.quit();
    });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('init', () => {
  const s = loadSettings();
  const prof = core.resolveProfile(config, s.profile, s.mcVersion);
  const ramByProfile = s.ramByProfile || {};
  return {
    serverName: config.serverName,
    nick: s.nick || '',
    ramMb: ramByProfile[prof.id] || (prof.id === 'smp' && s.ramMb) || prof.defaultRamMb,
    closeOnStart: s.closeOnStart !== false,
    version: APP_VERSION,
    versions: (config.versions || []).map(v => ({ mc: v.mc, label: v.label || v.mc })),
    selected: core.resolveVersion(config, s.mcVersion).minecraft,
    profiles: core.listProfiles(config).map(p => {
      const r = core.resolveProfile(config, p.id, s.mcVersion);
      return { ...p, minecraft: r.minecraft, versionLocked: r.versionLocked, hasServer: !!r.serverAddress,
        ramMb: ramByProfile[p.id] || (p.id === 'smp' && s.ramMb) || r.defaultRamMb };
    }),
    profile: prof.id
  };
});

ipcMain.handle('openFolder', (_e, sel) => {
  const s = loadSettings();
  const p = core.resolveProfile(config, (sel && sel.profile) || s.profile, (sel && sel.mcVersion) || s.mcVersion);
  const dir = path.join(rootDir, p.gameDirName);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('play', async (_e, { nick, ramMb, closeOnStart, mcVersion, profile }) => {
  if (updating) return { ok: false, error: 'Launcher güncelleniyor, birkaç saniye bekle.' };
  if (launching) return { ok: false, error: 'Zaten başlatılıyor.' };
  if (!core.validNick(nick)) return { ok: false, error: 'Nick 3-16 karakter olmalı (harf, rakam, _).' };
  launching = true;
  const prev = loadSettings();
  // Profil Fabric (SMP) değilse sürüm sabittir; SMP için kayıtlı sürüm seçimi korunur.
  const ver = core.resolveProfile(config, profile, mcVersion || prev.mcVersion);
  const ram = Math.max(1024, Math.min(parseInt(ramMb, 10) || ver.defaultRamMb, 16384));
  const ramByProfile = { ...(prev.ramByProfile || {}), [ver.id]: ram };
  saveSettings({ ...prev, nick, ramMb: ver.id === 'smp' ? ram : prev.ramMb, ramByProfile, closeOnStart: !!closeOnStart,
    mcVersion: ver.versionLocked ? prev.mcVersion : ver.minecraft, profile: ver.id });

  try {
    const gameDir = path.join(rootDir, ver.gameDirName);
    fs.mkdirSync(gameDir, { recursive: true });

    // Guard kimliği: ilk çalıştırmada otomatik üretilir, sonra hep aynısı kullanılır.
    let settings = loadSettings();
    if (!settings.identity) { settings.identity = core.newIdentity(); saveSettings(settings); }
    const identity = settings.identity;

    // Uzak manifest isteğe bağlı: yoksa/erişilemezse config.json varsayılanları kullanılır.
    let manifest = {};
    if (ver.manifestUrl) {
      try { log('Sunucu bilgileri alınıyor...'); manifest = await core.getJson(ver.manifestUrl); }
      catch (_) { log('Manifest alınamadı, varsayılan ayarlar kullanılıyor.'); }
    }
    const base = ver.loader === 'fabric'
      ? { ...config }
      : { serverAddress: ver.serverAddress, servers: ver.servers, jvmArgs: config.jvmArgs, quickPlay: ver.quickPlay };
    manifest = { ...base, ...manifest, minecraft: ver.minecraft, javaMajor: ver.javaMajor, mods: ver.mods };
    if (manifest.files && manifest.files.length) {
      log('Dosyalar kontrol ediliyor...');
      await core.syncFiles(gameDir, manifest, log);
    }

    log('Modlar güncelleniyor (Modrinth)...');
    await core.syncModrinth(gameDir, manifest.mods || [], manifest.minecraft, path.join(__dirname, 'bundled-mods'), log, ver.loader);
    if (ver.installPack) {
      try { core.installPack(gameDir, path.join(__dirname, 'bundled-pack', 'koninski-pack.zip')); } catch (e) { console.log('[pack]', e.message); }
    }
    const servers = manifest.servers || (ver.loader === 'fabric' ? config.servers : []) || [];
    if (servers.length) core.ensureServers(gameDir, servers);

    const javaPath = await core.ensureJava(rootDir, manifest.javaMajor, log);
    let custom = null, forgeInstaller = null;
    if (ver.loader === 'forge') forgeInstaller = await core.ensureForge(rootDir, manifest.minecraft, manifest.forgeVersion || ver.forgeVersion, log);
    else custom = await core.ensureFabric(rootDir, manifest.minecraft, manifest.fabricLoader || ver.fabricLoader, log);

    const uuid = core.offlineUuid(nick);
    const launcher = new Client();
    const opts = {
      authorization: {
        access_token: '0', client_token: '0', uuid, name: nick,
        user_properties: '{}', meta: { type: 'mojang', demo: false }
      },
      root: rootDir,
      javaPath,
      version: custom ? { number: manifest.minecraft, type: 'release', custom } : { number: manifest.minecraft, type: 'release' },
      memory: { max: `${ram}M`, min: '1024M' },
      overrides: { gameDirectory: gameDir },
      customArgs: [...(manifest.jvmArgs || []), `-Dkoninski.pub=${identity.pub}`, `-Dkoninski.priv=${identity.priv}`, `-Dkoninski.launcher=${APP_VERSION}`]
    };
    if (forgeInstaller) opts.forge = forgeInstaller; // MCLC, Forge'u bu installer ile kendisi kurar
    const addr = manifest.serverAddress || (ver.loader === 'fabric' ? config.serverAddress : '');
    if (manifest.quickPlay === true && addr) {
      opts.quickPlay = { type: 'multiplayer', identifier: addr };
    }

    launcher.on('progress', p => send('status', { msg: `Oyun dosyaları: ${p.type}`, progress: p.total ? p.task / p.total : undefined, file: p.type }));
    launcher.on('debug', d => console.log('[mclc]', d));
    launcher.on('close', code => { launching = false; send('closed', { code }); });

    log('Oyun başlatılıyor...');
    const proc = await launcher.launch(opts);
    if (!proc) throw new Error('Oyun başlatılamadı (log için konsola bak).');
    send('started', {});
    // Launcher açık kalırsa boşuna RAM tutar: oyun açılınca kapat (ayarlanabilir).
    if (closeOnStart) setTimeout(() => app.quit(), 5000);
    return { ok: true };
  } catch (err) {
    launching = false;
    return { ok: false, error: err.message };
  }
});

async function runUpdateCheck() {
  updating = true;
  let failMsg = '';
  log('Güncellemeler kontrol ediliyor...');
  try {
    const r = await updater.checkAndApply({
      currentVersion: APP_VERSION,
      updatesDir: path.join(rootDir, 'updates'),
      baseUrl: config.updateBaseUrl,
      log
    });
    if (r.updated) {
      log(`Launcher ${r.version} sürümüne güncellendi, yeniden başlatılıyor...`);
      setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
      return;
    }
  } catch (err) {
    console.log('[update]', err.message); // çevrimdışı olabilir; mevcut sürümle devam
    failMsg = err.message;
  }
  updating = false;
  log(failMsg ? 'Hazır. (güncelleme kontrolü yapılamadı: ' + failMsg + ')' : 'Hazır.');
}

app.whenReady().then(() => {
  createWindow();
  if (!process.env.KONINSKI_SMOKE) runUpdateCheck();
});
app.on('window-all-closed', () => app.quit());
