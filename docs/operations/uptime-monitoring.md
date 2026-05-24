# Uptime monitoring for the public demo

A broken demo URL is the worst possible first impression for marketing.
This doc walks through setting up uptime monitoring so you know within
1 minute if the Railway demo is down — and so visitors who arrive
during an outage see a graceful "we're back shortly" page instead of
a blank one.

Total setup: ~30 minutes. Cost: $0 on free tiers.

---

## 1. Pick a service

All four below have a free tier sufficient for one URL with email/SMS
alerts. Pick by feature mix; you can switch later — the health
endpoint is the same.

| Service | Free tier limits | Best for |
|---|---|---|
| **[Better Stack](https://betterstack.com/uptime)** | 10 monitors, 30s checks, public status page | Best UX; native Slack/Discord integration |
| **[UptimeRobot](https://uptimerobot.com)** | 50 monitors, 5min checks | Highest free-tier monitor count |
| **[Pingdom](https://www.pingdom.com)** | 1 monitor, 1min checks | If you already have a Solarwinds account |
| **[Cronitor](https://cronitor.io)** | 5 monitors, 60s checks, public status page | Best CLI / API for automation |

**Recommendation:** Better Stack. Sub-minute checks on the free tier
+ a polished public status page is the right starter shape for a
demo product.

---

## 2. The endpoint to monitor

OpenCanvas exposes a JSON health endpoint at:

```
GET https://opencanvas-production.up.railway.app/v1/health
```

Expected `200` response body:

```json
{
  "ok": true,
  "profile": "claude-sdk",
  "llm": "gemini",
  "model": "gemini-flash-lite-latest",
  "embedder": "onnx-bundled:BAAI/bge-small-en-v1.5"
}
```

The endpoint:
- Always returns 200 when the backend is alive (even when the LLM
  upstream is rate-limited — that's a separate concern below).
- Is auth-free in demo mode.
- Lazily initializes `BackendState` on first hit (~1-2s); subsequent
  hits are <100ms.

**Configure your monitor with:**

| Field | Value |
|---|---|
| Method | `GET` |
| URL | `https://opencanvas-production.up.railway.app/v1/health` |
| Expected status | `200` |
| Expected body contains | `"ok":true` |
| Check interval | `30s` (Better Stack free) or `1m` (UptimeRobot free) |
| Timeout | `15s` (the lazy boot can take ~3-5s) |
| Locations | At least US-East + EU-West (catches regional outages) |
| Alert delay | `1 confirmed failure` (don't burn yourself on transient blips) |

---

## 3. Set up a *deeper* health check too

`/v1/health` returns 200 even if the LLM upstream is broken (e.g.
the demo's Gemini key got rate-limited to zero quota — which actually
happened during initial setup; see `docs/deploy-railway.md`). To
catch this class of "backend up, demo dead" issues, add a second
monitor that hits the chat endpoint:

```http
POST https://opencanvas-production.up.railway.app/v1/chat
Content-Type: application/json

{
  "id": "uptime-probe",
  "conversationId": "uptime",
  "messages": [
    { "id": "m1", "role": "user", "parts": [{ "type": "text", "text": "say ok" }] }
  ]
}
```

**Expected response:** SSE stream that includes a `text-delta` chunk
within ~5s. **NOT** an `errorText` chunk.

| Field | Value |
|---|---|
| Method | `POST` |
| Body | (the JSON above) |
| Expected body contains | `"text-delta"` |
| Body NOT contains | `"errorText"` |
| Check interval | `5m` (this one costs an LLM call — keep it rare) |
| Timeout | `30s` |

**Why the longer interval:** every check fires a real Gemini call. At
5min checks that's ~9k calls/month, well within the free tier
(~45k/day). At 30s checks it'd be ~85k/month and would noticeably
eat into the demo's shared quota.

---

## 4. Public status page

The status page is marketing surface. Both Better Stack and Cronitor
let you point a subdomain at it:

```
status.opencanvas.app  →  CNAME  →  better-stack-hosted-page
```

Customize:
- Branding (logo, primary color)
- The two monitors above: rename to "Backend (health)" and "Agent (chat)"
- A nice incident-history view (last 90 days)

**Linked from:**
- The README under "Status:" near the badges
- The 404 / 5xx error pages of the demo (footer link)
- The "About" / footer of the marketing site

---

## 5. Alert channels

Different urgency = different channels:

| Severity | Channel | Configuration |
|---|---|---|
| Backend down >2min | Email + SMS | Better Stack free tier supports both |
| Chat endpoint fails | Email + Slack/Discord | Slower; just notify |
| Slow response (>5s) | Slack only | Watch but don't wake up for it |

**Don't:** route everything to PagerDuty. The demo is best-effort;
2am alerts will burn you out.

---

## 6. Graceful degradation in the app

If the demo IS down for >5min, the visitor's experience should
degrade gracefully rather than show a white page:

- **Frontend**: when `/v1/health` fails 3 times in a row, the
  `HealthBadge` already shows "backend down" + the error string. We
  should additionally:
  - Disable the chat input with a friendly "Demo is offline — try
    again in a few minutes" message
  - Link to `https://status.opencanvas.app` (when it's set up)
  - Suggest "or run locally — `pnpm dev` takes 60 seconds"

This isn't shipped yet — it's a TODO that becomes important once you
have monitoring + you've seen the first outage. Add a `<DemoOffline/>`
component that the `HealthBadge` flips to when `health.status === 'fail'`
for >30s.

---

## 7. What metrics to track over time

Beyond uptime, you'll want to know:

| Metric | Source | Why |
|---|---|---|
| Daily unique visitors | Railway logs or Plausible/Umami | Marketing impact |
| Chat requests per day | Railway logs | LLM cost forecasting |
| Median chat-to-widget latency | Custom — log in `chat.ts onFinish` | UX bottleneck |
| Rate-limit hits per IP | `src/backend/demo.ts` — log when bucket exhausts | Abuse pattern |
| API key 429s from upstream | `model-resolver.ts` error path | Quota planning |
| Templates auto-extracted per day | `template-extractor.ts` | "Learning" effectiveness |

For Phase 1 just wire visitor count + chat requests via the simplest
tool (Plausible script tag in `app/index.html`). Iterate.

---

## 8. One-time setup checklist

Copy this into the project's launch issue:

- [ ] Sign up at Better Stack (free tier)
- [ ] Create monitor: `GET /v1/health` every 30s, US-East + EU-West
- [ ] Create monitor: `POST /v1/chat` every 5m, US-East only
- [ ] Configure email alerts → your inbox
- [ ] Configure Slack/Discord webhook (optional)
- [ ] Set up `status.opencanvas.app` subdomain → status page
- [ ] Add a "Status" badge to the README pointing at the page
- [ ] Run a deliberate downtime test (stop the Railway service for
      60s) to confirm alerts fire
- [ ] Document the monitor URLs in a private team note
- [ ] (Once it's working) Add a `<DemoOffline/>` component for the
      `HealthBadge` fail state

---

## 9. When to revisit

- After the first 100 GitHub stars: alert thresholds are probably
  too noisy; tighten them.
- After the first real outage: post-mortem; update this doc with
  what failed and why.
- When auth ships: per-user errors become more interesting than
  global health; add per-user error rate to the dashboard.
- When traffic >10k requests/day: free tiers won't cover the
  deeper probe; consider paid monitoring (~$10/mo).
