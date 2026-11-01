const $ = id => document.getElementById(id);
const nick = $('nick'), ram = $('ram'), play = $('play'), statusEl = $('status');
const barWrap = $('barWrap'), bar = $('bar');

function setStatus(msg, err) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', !!err);
}
function syncRamLabel() { $('ramLabel').textContent = (ram.value / 1024).toFixed(1) + ' GB'; }
ram.addEventListener('input', syncRamLabel);

window.api.init().then(s => {
  $('serverName').textContent = s.serverName;
  $('ver').textContent = 'v' + s.version;
  nick.value = s.nick;
  ram.value = s.ramMb;
  $('closeOnStart').checked = s.closeOnStart;
  syncRamLabel();
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
  const r = await window.api.play({ nick: nick.value.trim(), ramMb: ram.value, closeOnStart: $('closeOnStart').checked });
  if (!r.ok) {
    setStatus(r.error, true);
    play.disabled = false;
    barWrap.hidden = true;
  }
});
$('folder').addEventListener('click', () => window.api.openFolder());
