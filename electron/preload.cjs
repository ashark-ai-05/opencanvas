/**
 * Electron preload — runs in the renderer's isolated world with access
 * to a small Node surface. We expose a single read-only field:
 *   window.opencanvasAuth.token
 * The renderer attaches it to /v1/* fetch requests so the backend
 * accepts the call. Without this bridge, the packaged-app renderer has
 * no way to learn the token without round-tripping through the network
 * (which is what we're trying to authenticate).
 *
 * Synchronous IPC because the token is needed before the very first
 * fetch fires. The handler in main.cjs just returns a constant string,
 * so this is microseconds.
 */
const { contextBridge, ipcRenderer } = require('electron');

let cachedToken = null;
async function getToken() {
  if (cachedToken) return cachedToken;
  cachedToken = await ipcRenderer.invoke('opencanvas:get-auth-token');
  return cachedToken;
}

contextBridge.exposeInMainWorld('opencanvasAuth', {
  getToken,
});
