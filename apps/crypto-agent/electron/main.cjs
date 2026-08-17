const { app, BrowserWindow, nativeTheme } = require('electron');
const { fork } = require('node:child_process');
const { createServer } = require('node:http');
const { existsSync, readFileSync, createReadStream } = require('node:fs');
const { extname, join, resolve } = require('node:path');

app.setName('CryptoAgent');

let mainWindow;
let quitting = false;
let apiProcess;
let staticServer;

function loadLocalEnv() {
  const candidates = [
    process.env.CRYPTO_AGENT_ENV_FILE,
    join(app.getPath('userData'), '.env'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../.env'),
  ].filter(Boolean);
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function startApi() {
  if (process.env.CRYPTO_AGENT_DEV_SERVER === '1') return;
  loadLocalEnv();
  const serverPath = join(__dirname, '../server/index.mjs');
  apiProcess = fork(serverPath, [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CRYPTO_AGENT_API_PORT: '5451' }, silent: true });
}

function startStaticServer() {
  if (process.env.CRYPTO_AGENT_DEV_SERVER === '1') return Promise.resolve();
  const root = join(__dirname, '../dist');
  staticServer = createServer((request, response) => {
    if (request.url?.startsWith('/api/')) {
      const proxy = require('node:http').request({ hostname: '127.0.0.1', port: 5451, path: request.url, method: request.method, headers: request.headers }, (upstream) => {
        response.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(response);
      });
      proxy.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Local API unavailable.'); });
      request.pipe(proxy); return;
    }
    const requested = request.url === '/' ? '/index.html' : request.url?.split('?')[0];
    const safePath = requested?.replaceAll('..', '') || '/index.html';
    const file = join(root, safePath);
    if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response);
  });
  return new Promise((resolveServer) => staticServer.listen(5450, '127.0.0.1', resolveServer));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 920,
    minHeight: 640,
    title: 'CryptoAgent',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101214' : '#f4f5f6',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL('http://127.0.0.1:5450');
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

app.whenReady().then(async () => {
  startApi();
  await startStaticServer();
  createWindow();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => { quitting = true; apiProcess?.kill(); staticServer?.close(); });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
