'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const tar = require('tar');
const extractZip = require('extract-zip');

// ---- configuration ----
const CONFIG_URL = process.env.XMAGE_CONFIG || 'http://play.darrellbest.com:17080/config.json';
const INSTALL_ROOT = process.env.XMAGE_HOME || path.join(os.homedir(), 'Documents', 'xmage');
const XMAGE_DIR = path.join(INSTALL_ROOT, 'xmage');
const JAVA_DIR = path.join(INSTALL_ROOT, 'java');
const PROPS = path.join(INSTALL_ROOT, 'installed.properties');
const PLAT = process.platform; // 'win32' | 'darwin' | 'linux'
const JAVA_SUFFIX = PLAT === 'win32' ? 'windows-x64' : PLAT === 'darwin' ? 'macosx-x64' : 'linux-x64';
// Performance/graphics flags (per the project readme's "Performance tweaks").
// OpenGL accelerates rendering on capable GPUs; on Linux it has a known file-
// chooser bug (deck loading), so use XRender there instead.
const GRAPHICS_OPTS = PLAT === 'linux' ? ['-Dsun.java2d.xrender=true'] : ['-Dsun.java2d.opengl=true'];
const CLIENT_OPTS = ['-Xmx4096m', ...GRAPHICS_OPTS, '-Dfile.encoding=UTF-8', '-Dsun.jnu.encoding=UTF-8', '-Djava.net.preferIPv4Stack=true'];
const SERVER_OPTS = ['-Xmx1024m'];

let win;
const procs = {};

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 980, minHeight: 640,
    frame: false, backgroundColor: '#0a0712', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

// ---- net helpers ----
function httpGet(url) {
  return new Promise((resolve, reject) => {
    (url.startsWith('https') ? https : http).get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(httpGet(res.headers.location)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = ''; res.on('data', (c) => data += c); res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    (url.startsWith('https') ? https : http).get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); try { fs.unlinkSync(dest); } catch (_) {}
        return resolve(download(res.headers.location, dest, onProgress));
      }
      if (res.statusCode !== 200) { return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10); let got = 0;
      res.on('data', (c) => { got += c.length; if (total) onProgress(got / total); });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
  });
}

// ---- props ----
function readProp(key) {
  try { const m = fs.readFileSync(PROPS, 'utf8').match(new RegExp('^' + key.replace(/\./g, '\\.') + '=(.*)$', 'm')); return m ? m[1].trim() : ''; } catch (_) { return ''; }
}
function writeProp(key, val) {
  let txt = ''; try { txt = fs.readFileSync(PROPS, 'utf8'); } catch (_) {}
  const re = new RegExp('^' + key.replace(/\./g, '\\.') + '=.*$', 'm');
  if (re.test(txt)) txt = txt.replace(re, key + '=' + val); else txt += (txt.endsWith('\n') || !txt ? '' : '\n') + key + '=' + val + '\n';
  fs.mkdirSync(INSTALL_ROOT, { recursive: true }); fs.writeFileSync(PROPS, txt);
}

// ---- java/client discovery ----
function findJavaHome() {
  try {
    for (const d of fs.readdirSync(JAVA_DIR)) {
      if (!d.startsWith('jre')) continue;
      const home = PLAT === 'darwin' ? path.join(JAVA_DIR, d, 'Contents', 'Home') : path.join(JAVA_DIR, d);
      if (fs.existsSync(path.join(home, 'bin', PLAT === 'win32' ? 'java.exe' : 'java'))) return home;
    }
  } catch (_) {}
  return null;
}
function clientInstalled() {
  try { return fs.readdirSync(path.join(XMAGE_DIR, 'mage-client', 'lib')).some((f) => /^mage-client.*\.jar$/.test(f)); } catch (_) { return false; }
}
function send(ch, p) { if (win && !win.isDestroyed()) win.webContents.send(ch, p); }
function log(kind, text) { send('console:line', { kind, text }); }

// ---- install ----
async function ensureJava(cfg) {
  if (findJavaHome()) { log('sys', 'Java already installed.'); return; }
  const ver = cfg.java.version;
  const url = cfg.java.location + JAVA_SUFFIX + '.tar.gz';
  const tmp = path.join(os.tmpdir(), 'xmage-java.tar.gz');
  log('sys', 'Downloading Java (' + ver + ') from ' + url);
  send('phase', 'Downloading Java…');
  await download(url, tmp, (p) => send('progress', p));
  log('sys', 'Installing Java…'); send('phase', 'Installing Java…'); send('progress', 1);
  fs.mkdirSync(JAVA_DIR, { recursive: true });
  await tar.x({ file: tmp, cwd: JAVA_DIR });
  writeProp('java.version', ver);
  log('ok2', 'Java installed.');
}
async function ensureXMage(cfg, force) {
  const avail = cfg.XMage.version, inst = readProp('xmage.version');
  if (!force && clientInstalled() && avail === inst) { log('sys', 'XMage already up to date.'); return; }
  if (force) log('sys', 'Force update: reinstalling current build (' + avail + ')…');
  const tmp = path.join(os.tmpdir(), 'xmage-update.zip');
  log('sys', 'Downloading XMage from ' + cfg.XMage.location);
  send('phase', 'Downloading XMage…');
  await download(cfg.XMage.location, tmp, (p) => send('progress', p));
  log('sys', 'Installing XMage…'); send('phase', 'Installing XMage…'); send('progress', 1);
  fs.mkdirSync(XMAGE_DIR, { recursive: true });
  // Remove old version-stamped jars before extracting. mage-*.jar files carry the
  // version in their name (mage-1.4.59.jar vs mage-1.4.60.jar), so unzipping a new
  // build on top would leave BOTH on the lib/* classpath — the client can then load
  // the stale MageVersion and fail the server handshake ("wrong client version").
  // The zip fully repopulates lib/, so clearing it first is safe. (plugins/ jars are
  // versioned independently, aren't duplicated, and may cache images — left alone.)
  for (const sub of ['mage-client/lib', 'mage-server/lib']) {
    try { fs.rmSync(path.join(XMAGE_DIR, sub), { recursive: true, force: true }); } catch (_) {}
  }
  await extractZip(tmp, { dir: XMAGE_DIR });
  writeProp('xmage.version', avail);
  log('ok2', 'XMage installed: ' + avail);
}
async function install(cfg, force) {
  await ensureJava(cfg);
  await ensureXMage(cfg, force);
  send('phase', 'Ready'); send('progress', 1);
}

// ---- launch ----
function launch(kind) {
  const home = findJavaHome();
  const dir = path.join(XMAGE_DIR, kind === 'client' ? 'mage-client' : 'mage-server');
  if (!home || !fs.existsSync(dir)) { log('err', kind + ': not installed yet — run Install first.'); return false; }
  const bin = path.join(home, 'bin', PLAT === 'win32' ? 'java.exe' : 'java');
  const opts = kind === 'client' ? CLIENT_OPTS : SERVER_OPTS;
  const main = kind === 'client' ? 'mage.client.MageFrame' : 'mage.server.Main';
  const args = [...opts, '-cp', path.join(dir, 'lib', '*'), main];
  log('sys', 'Launching ' + kind + '…');
  const p = spawn(bin, args, { cwd: dir, env: { ...process.env, JAVA_HOME: home } });
  procs[kind] = p;
  const onData = (b) => String(b).split(/\r?\n/).forEach((l) => l && log(kind, l));
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('exit', (code) => { log('sys', kind + ' exited (' + code + ')'); send('proc:state', { kind, running: false }); delete procs[kind]; });
  send('proc:state', { kind, running: true });
  return true;
}

// ---- IPC ----
ipcMain.handle('app:info', () => ({
  installRoot: INSTALL_ROOT, configUrl: CONFIG_URL, platform: PLAT,
  javaInstalled: !!findJavaHome(), clientInstalled: clientInstalled(), installedVersion: readProp('xmage.version') || '(none)'
}));
ipcMain.handle('config:get', async () => JSON.parse(await httpGet(CONFIG_URL)));
ipcMain.handle('install:run', async (_e, cfg, force) => { await install(cfg, force); return { installedVersion: readProp('xmage.version'), clientInstalled: clientInstalled() }; });
ipcMain.handle('client:launch', () => launch('client'));
ipcMain.handle('server:launch', () => launch('server'));
ipcMain.handle('open:url', (_e, u) => shell.openExternal(u));
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:min', () => win.minimize());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { Object.values(procs).forEach((p) => { try { p.kill(); } catch (_) {} }); if (process.platform !== 'darwin') app.quit(); });
