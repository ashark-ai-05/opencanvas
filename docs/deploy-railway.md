# Deploy the public demo to Railway

A walkthrough for getting an OpenCanvas demo live on Railway in ~10
minutes, using **Groq** as the free LLM provider (Llama 3.1 70B,
no $ cap on the free tier).

The deployed demo runs in **demo mode**:
- Token auth is disabled (visitors don't have a token)
- CORS allows any origin
- `/v1/chat` is rate-limited to **5 messages per IP per hour**
- Conversation auto-indexing into the shared KB is disabled (visitor
  A's chats don't leak into visitor B's search results)

These are all gated on `OPENCANVAS_DEMO=1`. For a local install you
get the normal hardened model — token auth, strict CORS, no rate
limiting.

---

## 1. Get a free Groq API key

1. Go to <https://console.groq.com> and create an account.
2. Generate an API key under **API Keys** → **Create API Key**.
3. Copy the key (starts with `gsk_…`). You'll paste it into Railway
   in a moment.

Groq's free tier has generous per-minute rate limits and no $ cap.
Llama 3.1 70B is a strong default for the demo.

## 2. Create the Railway service

1. <https://railway.com> → **New Project** → **Deploy from GitHub**.
2. Pick the `opencanvas` repo. Railway autodetects the `Dockerfile`
   in the repo root and uses it (specified by `railway.toml`).
3. Wait for the first build (~5 minutes — native `better-sqlite3` +
   `onnxruntime-node` compilation is the slow part).

## 3. Set environment variables

In Railway's dashboard → your service → **Variables**, add:

| Variable | Value | Why |
|---|---|---|
| `GROQ_API_KEY` | `gsk_…` (from step 1) | LLM provider auth |
| `OPENCANVAS_DEMO` | `1` | enables the demo gates (also in `railway.toml`) |
| `OPENCANVAS_LLM_PROVIDER` | `groq` | overrides the default Claude profile |
| `OPENCANVAS_LLM_MODEL` | `llama-3.1-70b-versatile` | model id |
| `HOST` | `0.0.0.0` | bind container to all interfaces |
| `NODE_ENV` | `production` | drop dev-only behaviours |

`PORT` is injected by Railway automatically — don't set it yourself.

## 4. Add a public domain

In Railway → **Settings** → **Public networking** → **Generate
domain**. Railway gives you something like
`opencanvas-production.up.railway.app`. That's your demo URL.

(Optional) Add a custom domain (e.g. `demo.opencanvas.app`) via
**Custom Domain** → CNAME record.

## 5. First-deploy smoke test

```bash
DEMO=https://<your-railway-domain>

# Backend health probe (no auth needed in demo mode)
curl $DEMO/v1/health

# Should respond with something like:
# {"ok":true,"profile":"...","llm":"groq","embedder":"onnx-bundled:..."}

# Place a widget from your terminal (no token required)
curl -X POST $DEMO/v1/canvas/widgets \
  -H 'content-type: application/json' \
  -d '{"kind":"sticky-note","role":"primary","payload":{"body":"Hello from the demo"}}'

# Hammer the chat endpoint (should 429 after 5 in an hour)
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "request $i → HTTP %{http_code}\n" \
    -X POST $DEMO/v1/chat \
    -H 'content-type: application/json' \
    -d '{"messages":[{"role":"user","content":"hi"}]}'
done
```

## 6. Tune the rate limit (optional)

The cap lives in `src/backend/demo.ts`:

```ts
const CAPACITY = 5;
const REFILL_MS = (60 * 60 * 1000) / CAPACITY; // 1 token per 12 min
```

If you want a friendlier limit (say 20/hour), bump `CAPACITY` to 20.
Redeploy by pushing to `main` — Railway auto-builds.

## 7. Cost shape

| Component | Cost |
|---|---|
| Railway service (Hobby plan) | ~$5/mo credit included; demo uses ~$2-3/mo idle |
| Groq API | $0 — free tier covers conservative demo traffic |
| GitHub Actions (Pages deploy) | Free |

If demo traffic exceeds the free quotas, the worst case is the chat
endpoint starts returning 429 from Groq — the canvas still renders,
widget placement via REST still works.

## 8. What visitors see

- Land on the Railway URL → empty canvas + the onboarding modal
  appears
- Modal lets them skip ("Skip for now") — no API key needed since
  the backend already has `GROQ_API_KEY`
- They type a question in the chat → up to 5 turns per hour
- Widgets stream onto the canvas as the agent works
- Their browser cookie keeps their conversation history scoped to
  them; refreshing keeps state, opening from another browser starts
  fresh

## Troubleshooting

**Build fails with `gyp ERR! find Python`**
→ The Dockerfile installs `python3` + build tools — make sure Railway
is using `Dockerfile` mode (not Nixpacks). Check `railway.toml`.

**Backend boots but `/v1/health` returns `llm: "unconfigured"`**
→ `GROQ_API_KEY` is missing or `OPENCANVAS_LLM_PROVIDER` isn't set.
Both must be present.

**Visitors see a CORS error**
→ Confirm `OPENCANVAS_DEMO=1` is set. Without it the backend enforces
the localhost-only allowlist.

**Chat times out**
→ Groq's free tier rate limit is per-token-per-minute. If you hit it
during a turn, the request hangs. Switch the model to a smaller one
(`llama-3.1-8b-instant`) by updating `OPENCANVAS_LLM_MODEL`.
