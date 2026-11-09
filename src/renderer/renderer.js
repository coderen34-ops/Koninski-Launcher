const $ = id => document.getElementById(id);
const nick = $('nick'), ram = $('ram'), play = $('play'), statusEl = $('status');
const mcSel = $('mcVersion');
const barWrap = $('barWrap'), bar = $('bar');
let profiles = [], current = null;
const ramByProfile = {};

// Profil (sunucu) seçimi: başlık, sürüm alanı ve RAM o profile göre değişir.
function selectProfile(id) {
  if (current) ramByProfile[current.id] = ram.value;
  current = profiles.find(p => p.id === id) || profiles[0];
  document.body.dataset.profile = current.id;
  for (const b of $('profiles').children) {
    const on = b.dataset.id === current.id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  $('serverName').textContent = current.name;
  $('subtitle').textContent = current.subtitle || '';
  $('logo').textContent = (current.name || 'K').trim().charAt(0).toUpperCase();
  $('versionRow').hidden = !!current.versionLocked;
  const info = $('profileInfo');
  if (current.versionLocked) {
    info.hidden = false;
    info.textContent = `Minecraft ${current.minecraft} · ${current.loader === 'forge' ? 'Forge' : 'Fabric'}`
      + (current.hasServer ? '' : ' · sunucu adresi henüz yok, oyun ana menüde açılır');
  } else {
    info.hidden = true;
  }
  ram.value = ramByProfile[current.id] || current.ramMb;
  syncRamLabel();
}

function setStatus(msg, err) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', !!err);
}
function syncRamLabel() { $('ramLabel').textContent = (ram.value / 1024).toFixed(1) + ' GB'; }
ram.addEventListener('input', syncRamLabel);

window.api.init().then(s => {
  $('ver').textContent = 'v' + s.version;
  profiles = s.profiles || [];
  const nav = $('profiles');
  nav.hidden = profiles.length < 2;
  for (const p of profiles) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.dataset.id = p.id; b.setAttribute('role', 'tab');
    b.textContent = p.name;
    b.addEventListener('click', () => { if (!play.disabled) selectProfile(p.id); });
    nav.appendChild(b);
  }
  for (const v of s.versions) { const o = document.createElement('option'); o.value = v.mc; o.textContent = v.label; mcSel.appendChild(o); }
  mcSel.value = s.selected;
  nick.value = s.nick;
  $('closeOnStart').checked = s.closeOnStart;
  if (profiles.length) selectProfile(s.profile);
  else { ram.value = s.ramMb; syncRamLabel(); }
});

window.api.onStatus(p => {
  if (p.msg) setStatus(p.msg);
  if (typeof p.progress === 'number') {
    barWrap.hidden = false;
    bar.style.width = Math.round(p.progress * 100) + '%';
  }
});
window.api.onStarted(() => {
  barWrap.hidden = true;
  setStatus('Oyun açıldı, iyi eğlenceler!');
});
window.api.onClosed(() => {
  play.disabled = false;
  setStatus('Oyun kapandı.');
});

play.addEventListener('click', async () => {
  play.disabled = true;
  barWrap.hidden = true;
  bar.style.width = '0';
  setStatus('Başlatılıyor...');
  const r = await window.api.play({ nick: nick.value.trim(), ramMb: ram.value, closeOnStart: $('closeOnStart').checked, mcVersion: mcSel.value, profile: current && current.id });
  if (!r.ok) {
    setStatus(r.error, true);
    play.disabled = false;
    barWrap.hidden = true;
  }
});
$('folder').addEventListener('click', () => window.api.openFolder({ profile: current && current.id, mcVersion: mcSel.value }));
