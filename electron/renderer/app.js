'use strict';
const $ = (id) => document.getElementById(id);

// ---- ember/mote particle field ----
const c = $('fx'), x = c.getContext('2d');
let W, H, P = [];
function rs() { W = c.width = innerWidth; H = c.height = innerHeight; }
addEventListener('resize', rs); rs();
const COLS = ['168,117,255', '70,230,214', '243,201,122', '255,125,77'];
for (let i = 0; i < 70; i++) P.push({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*2.2+.4, s: Math.random()*.5+.12, d: Math.random()*Math.PI*2, c: COLS[i%COLS.length], a: Math.random()*.5+.2 });
(function tick() {
  x.clearRect(0, 0, W, H);
  for (const p of P) {
    p.y -= p.s; p.x += Math.sin(p.d += .01) * .25;
    if (p.y < -10) { p.y = H + 10; p.x = Math.random()*W; }
    x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7);
    x.fillStyle = 'rgba(' + p.c + ',' + p.a + ')'; x.shadowBlur = 12; x.shadowColor = 'rgba(' + p.c + ',.9)'; x.fill();
  }
  requestAnimationFrame(tick);
})();

// ---- console / progress ----
const term = $('term');
function log(kind, text) {
  const d = document.createElement('div');
  if (kind && kind !== 'out') d.className = kind;
  d.textContent = text; term.appendChild(d);
  while (term.children.length > 500) term.removeChild(term.firstChild);
  term.scrollTop = term.scrollHeight;
}
window.xmage.onConsole((p) => log(p.kind, p.text));
window.xmage.onProgress((pct) => { $('bar').style.width = Math.round(pct * 100) + '%'; });
window.xmage.onPhase((text) => { $('upstat').textContent = text; });

// ---- window controls + links ----
$('min').onclick = () => window.xmage.winMin();
$('close').onclick = () => window.xmage.winClose();
document.querySelectorAll('.tnav a').forEach((a) => a.onclick = () => window.xmage.openUrl(a.dataset.url));

let CFG = null, READY = false, BUSY = false;

function setBadge(cls, text, onclick) {
  const b = $('badge'); b.className = 'badge ' + cls; b.textContent = text; b.onclick = onclick || null;
}

async function doInstall() {
  if (!CFG || BUSY) return;
  BUSY = true; $('play').disabled = true; setBadge('new', '… working', null);
  log('sys', '▶ Installing / updating from play.darrellbest.com…');
  try {
    const r = await window.xmage.runInstall(CFG);
    READY = r.clientInstalled;
    $('ver').textContent = r.installedVersion;
    $('upstat').textContent = 'Up to date'; $('upsub').textContent = 'v' + r.installedVersion;
    setBadge('ok', '✦ READY');
    $('play').disabled = false;
    log('ok2', 'Install complete — ready to play.');
  } catch (e) {
    log('err', 'Install failed: ' + (e.message || e));
    setBadge('new', '⬇ RETRY', doInstall);
  }
  BUSY = false;
}

// "Enter the Fray": install if needed, then launch
$('play').onclick = async () => {
  if (BUSY) return;
  if (!READY) { await doInstall(); if (!READY) return; }
  $('play').disabled = true;
  log('sys', '▶ Entering the fray…');
  const ok = await window.xmage.launchClient();
  if (!ok) { $('play').disabled = false; log('err', 'Client failed to launch.'); }
  else setTimeout(() => { $('play').disabled = false; }, 4000);
};
$('server').onclick = async () => {
  if (!READY) { await doInstall(); if (!READY) return; }
  log('sys', '▶ Starting local server…'); await window.xmage.launchServer();
};

async function boot() {
  const info = await window.xmage.appInfo();
  $('ver').textContent = info.installedVersion;
  $('foot-install').textContent = info.installRoot;
  $('foot-java').textContent = info.platform + ' · ' + (info.javaInstalled ? 'java ready' : 'java needed');
  READY = info.clientInstalled && info.javaInstalled;
  log('sys', 'Launcher ready. Install root: ' + info.installRoot);
  log('sys', 'Reading config from ' + info.configUrl);
  try {
    CFG = await window.xmage.getConfig();
    $('srvdot').className = 'dot on';
    const avail = CFG.XMage.version, inst = info.installedVersion;
    log('sys', 'Config OK. Available: ' + avail + ' · Installed: ' + inst);
    if (!info.clientInstalled || !info.javaInstalled) {
      $('upstat').textContent = 'Install required'; $('upsub').textContent = (info.javaInstalled ? '' : 'Java + ') + 'XMage ' + avail;
      setBadge('new', '⬇ INSTALL', doInstall); READY = false;
    } else if (avail !== inst) {
      $('upstat').textContent = 'Update available'; $('upsub').textContent = avail;
      setBadge('new', '⬇ UPDATE', doInstall);
    } else {
      $('upstat').textContent = 'Up to date'; $('upsub').textContent = 'v' + inst;
      setBadge('ok', '✦ READY');
    }
  } catch (e) {
    $('srvdot').className = 'dot bad';
    $('upstat').textContent = 'Server unreachable'; $('upsub').textContent = String(e.message || e);
    setBadge('ok', '✕ OFFLINE');
    log('err', 'Config fetch failed: ' + (e.message || e));
  }
}
boot();
