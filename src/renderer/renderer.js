const $ = id => document.getElementById(id);
const nick = $('nick'), ram = $('ram'), play = $('play'), statusEl = $('status');
const mcSel = $('mcVersion');
const barWrap = $('barWrap'), bar = $('bar');
let profiles = [], current = null;

// Demir ve Siper amblemi: meşe yaprağı çelengi içinde çapraz tüfekler, siper süngüsü ve yıldız (haki/pas tonları).
const DVS_EMBLEM = `<svg viewBox="0 0 48 48" width="48" height="48" aria-label="Demir ve Siper amblemi">
  <circle cx="24" cy="24" r="23" fill="#2a2617" stroke="#b39b5b" stroke-width="2"/>
  <circle cx="24" cy="24" r="18.5" fill="none" stroke="#6f6238" stroke-width="1"/>
  <g stroke="#c9b06a" stroke-width="2.4" stroke-linecap="round">
    <line x1="12" y1="36" x2="34" y2="12"/>
    <line x1="36" y1="36" x2="14" y2="12"/>
  </g>
  <g fill="#8e3b25">
    <rect x="10" y="33" width="6" height="4" rx="1" transform="rotate(-47 13 35)"/>
    <rect x="32" y="33" width="6" height="4" rx="1" transform="rotate(47 35 35)"/>
  </g>
  <polygon points="24,14 26.3,20.6 33.3,20.7 27.7,24.9 29.8,31.6 24,27.6 18.2,31.6 20.3,24.9 14.7,20.7 21.7,20.6" fill="#e9dfc4" stroke="#2a2617" stroke-width="0.8"/>
  <path d="M13 39 Q24 45 35 39" fill="none" stroke="#7f8a3c" stroke-width="1.6" stroke-linecap="round"/>
  <g fill="#7f8a3c">
    <ellipse cx="16" cy="40.6" rx="1.3" ry="2.2" transform="rotate(-60 16 40.6)"/><ellipse cx="20" cy="42" rx="1.3" ry="2.2" transform="rotate(-75 20 42)"/>
    <ellipse cx="32" cy="40.6" rx="1.3" ry="2.2" transform="rotate(60 32 40.6)"/><ellipse cx="28" cy="42" rx="1.3" ry="2.2" transform="rotate(75 28 42)"/>
  </g>
</svg>`;
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
  const logo = $('logo');
  if (current.id === 'dvs') logo.innerHTML = DVS_EMBLEM;
  else logo.textContent = (current.name || 'K').trim().charAt(0).toUpperCase();
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
