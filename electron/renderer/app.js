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
document.querySelectorAll('.tnav a[data-url]').forEach((a) => a.onclick = () => window.xmage.openUrl(a.dataset.url));
// Force update: re-download + reinstall the current build, bypassing the "up to date"
// check. Heals a stuck/mismatched install (e.g. client/server version mismatch).
$('forceUpdate').onclick = async () => {
  if (BUSY || !CFG) return;
  log('sys', '▶ Force update — reinstalling current build…');
  const ok = await doInstall(true);
  log(ok ? 'ok2' : 'err', ok ? 'Force update complete — ready to play.' : 'Force update failed.');
};

let CFG = null, READY = false, BUSY = false, UPDATE_AVAIL = false, NEEDS_INSTALL = false, CLIENT_RUNNING = false;

// The hero button doubles as the update notifier AND launch guard: its label reflects
// state, and it's disabled while busy OR a client is already running (no double-launch).
function refreshPlayButton() {
  const label = CLIENT_RUNNING ? 'In the fray…'
    : (NEEDS_INSTALL ? 'Install' : (UPDATE_AVAIL ? 'Update' : 'Enter the Fray'));
  $('play').innerHTML = '<span class="glint"></span>' + label;
  $('play').disabled = BUSY || CLIENT_RUNNING;
}

async function doInstall(force) {
  if (!CFG || BUSY) return false;
  BUSY = true; refreshPlayButton();
  $('upstat').textContent = 'Working…'; $('upsub').textContent = 'installing / updating';
  log('sys', '▶ Installing / updating from play.darrellbest.com…');
  let ok = false;
  try {
    const r = await window.xmage.runInstall(CFG, force);
    READY = r.clientInstalled;
    NEEDS_INSTALL = false; UPDATE_AVAIL = false;
    $('ver').textContent = r.installedVersion;
    $('upstat').textContent = 'Up to date'; $('upsub').textContent = 'v' + r.installedVersion;
    log('ok2', 'Install complete — ready to play.');
    ok = READY;
  } catch (e) {
    log('err', 'Install failed: ' + (e.message || e));
    $('upstat').textContent = 'Update failed'; $('upsub').textContent = 'click to retry';
  }
  BUSY = false;
  refreshPlayButton();
  return ok;
}

// Hero button installs/updates if needed, then launches (auto-launch after update).
$('play').onclick = async () => {
  if (BUSY || CLIENT_RUNNING) return;
  if (NEEDS_INSTALL || UPDATE_AVAIL || !READY) {
    const ok = await doInstall();
    if (!ok) return;
  }
  BUSY = true; refreshPlayButton();
  log('sys', '▶ Entering the fray…');
  const ok = await window.xmage.launchClient();
  BUSY = false;
  if (ok) CLIENT_RUNNING = true;   // proc:state(exit) re-enables the button when the client closes
  else log('err', 'Client failed to launch.');
  refreshPlayButton();
};
$('server').onclick = async () => {
  if (!READY) { await doInstall(); if (!READY) return; }
  log('sys', '▶ Starting local server…'); await window.xmage.launchServer();
};

// Track the running client so the play button stays disabled until it exits.
window.xmage.onProcState((p) => {
  if (p.kind !== 'client') return;
  CLIENT_RUNNING = p.running;
  refreshPlayButton();
});

// ---- client settings modal ----
async function openSettings() {
  const s = await window.xmage.getSettings();
  $('setGraphics').value = s.graphics;
  $('setMemory').value = s.memory;
  $('setJava').value = s.java;
  $('setIpv4').checked = s.ipv4 === 'true';
  $('setExtra').value = s.extraArgs || '';
  $('settings').style.display = '';
}
function closeSettings() { $('settings').style.display = 'none'; }
$('openSettings').onclick = openSettings;
$('setClose').onclick = closeSettings;
$('setCancel').onclick = closeSettings;
$('settings').onclick = (e) => { if (e.target === $('settings')) closeSettings(); }; // click backdrop to dismiss
$('setSave').onclick = async () => {
  await window.xmage.saveSettings({
    graphics: $('setGraphics').value,
    memory: $('setMemory').value,
    java: $('setJava').value,
    ipv4: $('setIpv4').checked ? 'true' : 'false',
    extraArgs: $('setExtra').value.trim(),
  });
  log('sys', '⚙ Client settings saved — applied on next launch.');
  closeSettings();
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
      NEEDS_INSTALL = true; READY = false;
      $('upstat').textContent = 'Install required'; $('upsub').textContent = (info.javaInstalled ? '' : 'Java + ') + 'XMage ' + avail;
    } else if (avail !== inst) {
      UPDATE_AVAIL = true;
      $('upstat').textContent = 'Update available'; $('upsub').textContent = avail;
    } else {
      $('upstat').textContent = 'Up to date'; $('upsub').textContent = 'v' + inst;
    }
    refreshPlayButton();
  } catch (e) {
    $('srvdot').className = 'dot bad';
    $('upstat').textContent = 'Server unreachable'; $('upsub').textContent = String(e.message || e);
    log('err', 'Config fetch failed: ' + (e.message || e));
    refreshPlayButton();
  }
}
boot();
