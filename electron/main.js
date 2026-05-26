'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn, execFile } = require('child_process');

// ---- configuration ----
const CONFIG_URL = process.env.XMAGE_CONFIG || 'http://play.darrellbest.com:17080/config.json';
const INSTALL_ROOT = process.env.XMAGE_HOME || path.join(os.homedir(), 'Documents', 'xmage');
const JAVA = path.join(INSTALL_ROOT, 'java', 'jre1.8.0_201', 'bin', 'java');
const XMAGE_DIR = path.join(INSTALL_ROOT, 'xmage');
const CLIENT_DIR = path.join(XMAGE_DIR, 'mage-client');
const SERVER_DIR = path.join(XMAGE_DIR, 'mage-server');
const PROPS = path.join(INSTALL_ROOT, 'installed.properties');

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

// ---- helpers ----
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location));
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); res.resume(); return; }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest);
        return resolve(download(res.headers.location, dest, onProgress));
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      res.on('data', (c) => { got += c.length; if (total) onProgress(got / total); });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
  });
}

function readInstalledVersion() {
  try {
    const txt = fs.readFileSync(PROPS, 'utf8');
    const m = txt.match(/^xmage\.version=(.*)$/m);
    return m ? m[1].trim() : '(none)';
  } catch (_) { return '(not installed)'; }
}

function setInstalledVersion(v) {
  let txt = '';
  try { txt = fs.readFileSync(PROPS, 'utf8'); } catch (_) {}
  if (/^xmage\.version=/m.test(txt)) txt = txt.replace(/^xmage\.version=.*$/m, 'xmage.version=' + v);
  else txt += '\nxmage.version=' + v + '\n';
  try { fs.writeFileSync(PROPS, txt); } catch (_) {}
}

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function findJar(dir) {
  try {
    const lib = path.join(dir, 'lib');
    const f = fs.readdirSync(lib).find((n) => /^mage-(client|server).*\.jar$/.test(n));
    return f ? path.join('lib', f) : null;
  } catch (_) { return null; }
}

function launch(kind) {
  const dir = kind === 'client' ? CLIENT_DIR : SERVER_DIR;
  const jar = findJar(dir);
  if (!jar) { send('console:line', { kind: 'err', text: `${kind}: jar not found in ${dir}` }); return false; }
  const xmx = kind === 'client' ? '-Xmx2000m' : '-Xmx1024m';
  const args = [xmx, '-Dfile.encoding=UTF-8', '-Djava.net.preferIPv4Stack=true', '-jar', jar];
  send('console:line', { kind: 'sys', text: `Launching ${kind}: ${path.basename(JAVA)} ${args.join(' ')}` });
  const p = spawn(JAVA, args, { cwd: dir });
  procs[kind] = p;
  const onData = (b) => String(b).split(/\r?\n/).forEach((l) => l && send('console:line', { kind, text: l }));
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('exit', (code) => { send('console:line', { kind: 'sys', text: `${kind} exited (${code})` }); send('proc:state', { kind, running: false }); delete procs[kind]; });
  send('proc:state', { kind, running: true });
  return true;
}

// ---- IPC ----
ipcMain.handle('app:info', () => ({
  installRoot: INSTALL_ROOT, configUrl: CONFIG_URL,
  javaExists: fs.existsSync(JAVA), clientExists: !!findJar(CLIENT_DIR), serverExists: !!findJar(SERVER_DIR),
  installedVersion: readInstalledVersion()
}));

ipcMain.handle('config:get', async () => {
  const txt = await httpGet(CONFIG_URL);
  return JSON.parse(txt);
});

ipcMain.handle('client:launch', () => launch('client'));
ipcMain.handle('server:launch', () => launch('server'));
ipcMain.handle('server:running', () => !!procs.server);

ipcMain.handle('update:install', async (_e, cfg) => {
  const url = cfg && cfg.XMage && cfg.XMage.location;
  if (!url) throw new Error('no XMage.location in config');
  const tmp = path.join(os.tmpdir(), 'xmage-update.zip');
  send('console:line', { kind: 'sys', text: 'Downloading ' + url });
  await download(url, tmp, (pct) => send('update:progress', pct));
  send('console:line', { kind: 'sys', text: 'Installing update...' });
  await new Promise((res, rej) => {
    fs.mkdirSync(XMAGE_DIR, { recursive: true });
    execFile('unzip', ['-o', '-q', tmp, '-d', XMAGE_DIR], (err) => err ? rej(err) : res());
  });
  if (cfg.XMage.version) setInstalledVersion(cfg.XMage.version);
  send('update:progress', 1);
  send('console:line', { kind: 'sys', text: 'Update installed: ' + cfg.XMage.version });
  return readInstalledVersion();
});

ipcMain.handle('win:close', () => win.close());
ipcMain.handle('win:min', () => win.minimize());
ipcMain.handle('open:url', (_e, u) => shell.openExternal(u));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { Object.values(procs).forEach((p) => { try { p.kill(); } catch (_) {} }); if (process.platform !== 'darwin') app.quit(); });
