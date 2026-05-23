# Security Policy

## Supported Versions

OpenCanvas is in active development and ships from `main`. The most
recent tagged release is the only supported version for security
patches. Please update before reporting an issue.

## Reporting a Vulnerability

If you find a security issue, please **do not** open a public GitHub
issue. Email **krunal.ashar@gmail.com** with:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof-of-concept is ideal)
- The OpenCanvas version (`pnpm cli --probe`) and your platform

You'll get an acknowledgement within 72 hours. We'll work with you on a
fix and a disclosure timeline — typically a coordinated release within
14 days for high-severity issues, longer for lower-impact reports.

## Security Model

OpenCanvas runs entirely on your machine. The threat model is **local
single-user**: the user's filesystem, network, and processes are
considered trusted; everything else is not.

### What we defend against

1. **Cross-tab CSRF.** A malicious website you visit while OpenCanvas
   is running cannot POST to `http://127.0.0.1:3457` because CORS is
   locked to the Vite dev server and Electron `file://` origins only.
2. **Cross-process tampering.** A rogue process running on the same
   machine cannot mutate canvas state because state-mutating routes
   (`POST/PUT/PATCH/DELETE /v1/*`) require an `X-OpenCanvas-Token`
   header. The token is a 256-bit random value persisted to
   `~/.opencanvas/auth-token` with file mode `0600`.
3. **Renderer escape.** The Electron renderer runs with
   `contextIsolation: true`, `nodeIntegration: false`, and `sandbox:
   true` in packaged builds. The preload script exposes exactly one
   read-only field (`window.opencanvasAuth`).
4. **Untrusted iframe content.** The plugin and `html` widgets render
   user/agent-supplied HTML in `<iframe sandbox="allow-scripts">` with
   no `allow-same-origin`, so the iframe gets a `null` origin and
   cannot reach the parent DOM, cookies, or localStorage.

### What we explicitly do **not** defend against

1. **Malicious models or MCP servers.** OpenCanvas hands tool-call
   payloads to whatever LLM and MCP servers you configure. If you
   point it at a compromised model or a malicious MCP server, that
   actor can read your KB and place arbitrary widgets. Treat the
   model + server list as part of your trust boundary.
2. **The `plugin-fetch` proxy.** `/v1/plugin-fetch` exists so
   `null`-origin plugin iframes can call HTTP APIs. It is gated by
   the auth token, but once authenticated it forwards arbitrary
   URLs — including private corporate hosts if your machine has VPN
   access. Don't run untrusted plugins.
3. **Disk-level attackers.** SQLite KB, conversation history, and the
   auth token live in `~/.opencanvas/`. Anyone with read access to
   your home directory can exfiltrate them.

### Opting out of auth (development only)

Set `OPENCANVAS_REQUIRE_AUTH=0` before starting the backend. Useful
when scripting against the API from another local process where
plumbing the header is friction. **Do not** ship a build with this
default — it re-opens the cross-process tampering window.

### Content-Security-Policy

The Electron renderer applies a default CSP via `Content-Security-Policy`
meta tag in `app/index.html`:

- `default-src 'self'` — block 3rd-party resources by default
- `connect-src` pinned to `127.0.0.1:3457` / `localhost:3457` (backend)
  + `ws://*:3458` (Vite HMR)
- `object-src 'none'` and `base-uri 'self'` — no plugin escape via
  `<object>`/`<base>`
- `script-src` still allows `'unsafe-inline' 'unsafe-eval'` because
  Vite HMR and a few libs (Shiki) need it. Tightening this for the
  bundled prod build is a v0.2 task — would need a build-time CSP
  swap (separate `index.prod.html`) or nonce injection.

Plugins that need to load external scripts inside their sandboxed
iframe declare their sources in the plugin manifest. We do not
auto-merge plugin CSP into the host CSP — plugin iframes are sandboxed
(`allow-scripts` only, no `allow-same-origin`) so their CSP scope is
isolated by design.

## Disclosure

After a fix ships, we'll publish an advisory under the GitHub
"Security advisories" tab and credit the reporter (unless you ask to
stay anonymous).
