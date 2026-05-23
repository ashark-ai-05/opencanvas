/**
 * OpenCanvas Electron main process.
 *
 * Dev mode: assumes `pnpm dev` already runs Vite (3458) + backend (3457).
 * We poll http://127.0.0.1:3458 until ready (30s timeout) then load it.
 *
 * Prod mode: spawn the bundled backend via Electron's bundled Node
 * (process.execPath + ELECTRON_RUN_AS_NODE=1) on port 3457; load the
 * bundled Vite dist out of `app/dist`.
 *
 * Spec: REPLICATION-PROMPT.md §16.
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const isDev = !app.isPackaged;
const APP_PORT = 3458;
const BACKEND_PORT = 3457;
const userDataDir = app.getPath('userData');

// Backend auth token. Generated once and shared between the spawned
// backend (via OPENCANVAS_AUTH_TOKEN env) and the renderer (via preload
// + IPC). Reusing a stable file in ~/.opencanvas means dev (Vite proxy)
// and packaged Electron point at the same token, so curl from the
// terminal also works for power users.
const TOKEN_FILE = path.join(os.homedir(), '.opencanvas', 'auth-token');
function ensureAuthToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t.length >= 16) return t;
    }
  } catch {
    // fall through and regenerate
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, generated, 'utf8');
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* windows */ }
  return generated;
}
const AUTH_TOKEN = ensureAuthToken();
ipcMain.handle('opencanvas:get-auth-token', () => AUTH_TOKEN);

let backendProcess = null;
let mainWindow = null;

function spawnBackend() {
  const backendEntry = path.join(__dirname, '..', 'dist-backend', 'server.js');
  backendProcess = spawn(process.execPath, [backendEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCANVAS_BACKEND_PORT: String(BACKEND_PORT),
      OPENCANVAS_CONFIG: path.join(userDataDir, 'config.json'),
      OPENCANVAS_AUTH_TOKEN: AUTH_TOKEN,
    },
    stdio: 'inherit',
  });
  backendProcess.on('exit', (code) => {
    console.log(`[opencanvas] bundled backend exited with code ${code}`);
    backendProcess = null;
  });
}

function killBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function pingPort(port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (attemptsLeft-- <= 0) {
          reject(new Error(`port ${port} did not respond after retries`));
          return;
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox is preferred for prod (signed installer ships its own
      // setuid chrome-sandbox helper). In dev the SUID helper is rarely
      // configured, so we drop sandbox to avoid the SETUID_SANDBOX error
      // that would otherwise abort startup. See electron/electron#17972.
      sandbox: !isDev,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    // Wait for the dev server to come up — `pnpm dev` is responsible for
    // launching it, this app just waits and loads.
    try {
      await pingPort(APP_PORT, 120);
      mainWindow.loadURL(`http://127.0.0.1:${APP_PORT}`);
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (err) {
      console.error(
        `[opencanvas] dev: vite server not reachable on :${APP_PORT}.`,
        err && err.message ? err.message : err,
      );
      const fallbackHtml =
        '<pre style="color:#fff;background:#0a0a0a;padding:24px;font:14px monospace">' +
        'Vite dev server not running on :' + APP_PORT + '. ' +
        'Run `pnpm dev` first, or use `pnpm electron:dev`.' +
        '</pre>';
      mainWindow.loadURL('data:text/html,' + encodeURIComponent(fallbackHtml));
    }
  } else {
    spawnBackend();
    try {
      await pingPort(BACKEND_PORT, 120);
    } catch (err) {
      console.error('[opencanvas] prod: bundled backend did not start', err);
    }
    const indexHtml = path.join(__dirname, '..', 'app', 'dist', 'index.html');
    mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  killBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', killBackend);

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.whenReady().then(createWindow);
