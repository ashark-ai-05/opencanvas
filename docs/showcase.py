"""
Q3 Operations Dashboard — the README showcase.

Renders 11 themed widgets via OpenCanvas's /v1/canvas/* REST surface.
No agent required; pure HTTP so it runs even without an LLM key
configured.

Usage:
  python3 docs/showcase.py

Optional:
  OPENCANVAS_BASE  — defaults to http://127.0.0.1:3457
  OPENCANVAS_API_KEY  — only needed if you've set the same env var
                        on the backend (Authorization: Bearer)

Auto-tidy will reflow the burst into the active template's role slots
~700ms after the last placement. Pinned widgets survive /clear.
"""
from __future__ import annotations
import json
import os
import time
import urllib.request

BASE = os.environ.get("OPENCANVAS_BASE", "http://127.0.0.1:3457").rstrip("/")
API_KEY = os.environ.get("OPENCANVAS_API_KEY")
NOW_MS = int(time.time() * 1000)


def post(path: str, body: dict) -> dict:
    headers = {"content-type": "application/json"}
    if API_KEY:
        headers["authorization"] = f"Bearer {API_KEY}"
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


WIDGETS: list[dict] = [
    # ── 1. Hero markdown — sets the scene ─────────────────────────────
    {"kind": "markdown", "role": "primary", "payload": {
        "title": "Q3 Operations Dashboard",
        "body": (
            "## Welcome back\n\n"
            "Six countries, eleven product lines, one canvas.\n\n"
            "**Today's themes**\n"
            "- 🚀 EU launch is **3 weeks out** — go/no-go review Friday\n"
            "- 📈 MAU growth **+18% MoM** (best month since Q4 last year)\n"
            "- ⚠️ Latency creeping up in `ap-south` — eng investigating\n\n"
            "_Hover any widget for actions. ⌘K to find anything._"
        ),
    }},

    # ── 2. Live Vega-Lite chart — the centerpiece ─────────────────────
    {"kind": "chart", "role": "primary", "payload": {
        "title": "Monthly Active Users — last 8 months",
        "spec": {
            "data": {"values": [
                {"month": "Jan", "users": 1200, "target": 1500},
                {"month": "Feb", "users": 1450, "target": 1700},
                {"month": "Mar", "users": 1820, "target": 1900},
                {"month": "Apr", "users": 2100, "target": 2200},
                {"month": "May", "users": 2480, "target": 2600},
                {"month": "Jun", "users": 2950, "target": 2900},
                {"month": "Jul", "users": 3420, "target": 3300},
                {"month": "Aug", "users": 4100, "target": 3800},
            ]},
            "layer": [
                {"mark": {"type": "area", "opacity": 0.18, "color": "#a78bfa"},
                 "encoding": {"x": {"field": "month", "type": "ordinal"},
                              "y": {"field": "users", "type": "quantitative"}}},
                {"mark": {"type": "line", "strokeWidth": 3, "point": True, "tooltip": True},
                 "encoding": {"x": {"field": "month", "type": "ordinal",
                                    "axis": {"labelAngle": 0, "title": None}},
                              "y": {"field": "users", "type": "quantitative",
                                    "axis": {"title": "MAU"}}}},
                {"mark": {"type": "line", "strokeDash": [4, 4],
                          "color": "#71717a", "tooltip": True},
                 "encoding": {"x": {"field": "month", "type": "ordinal"},
                              "y": {"field": "target", "type": "quantitative"}}},
            ],
        },
    }},

    # ── 3. Pomodoro — focus block ─────────────────────────────────────
    {"kind": "time", "role": "detail", "payload": {
        "mode": "pomodoro",
        "label": "Deep work · 25/5",
        "startedAt": NOW_MS,
        "elapsedAtPause": 0,
        "paused": False,
        "pomodoro": {"workSec": 1500, "breakSec": 300, "longBreakSec": 900,
                     "longBreakEvery": 4, "sessions": 0, "phase": "work"},
    }},

    # ── 4. SF clock ───────────────────────────────────────────────────
    {"kind": "time", "role": "detail", "payload": {
        "mode": "clock", "label": "San Francisco",
        "tz": "America/Los_Angeles", "format": "12h",
    }},

    # ── 5. Tokyo clock ────────────────────────────────────────────────
    {"kind": "time", "role": "detail", "payload": {
        "mode": "clock", "label": "Tokyo",
        "tz": "Asia/Tokyo", "format": "24h",
    }},

    # ── 6. Region health table ────────────────────────────────────────
    {"kind": "table", "role": "related", "payload": {
        "title": "Region health · last 24h",
        "columns": [
            {"key": "region", "label": "Region"},
            {"key": "rps",    "label": "RPS",    "align": "right", "mono": True},
            {"key": "p95",    "label": "p95 ms", "align": "right", "mono": True},
            {"key": "uptime", "label": "Uptime", "align": "right", "mono": True},
            {"key": "trend",  "label": "Trend"},
        ],
        "rows": [
            ["us-east",    "4,200", " 22", "99.99%", "↗ steady"],
            ["us-west",    "3,400", " 18", "99.98%", "↗ steady"],
            ["eu-west",    "2,800", " 31", "99.95%", "→ flat"],
            ["eu-central", "2,950", " 28", "99.97%", "↗ steady"],
            ["ap-south",   "1,900", " 47", "99.82%", "↘ degrading"],
            ["ap-east",    "1,700", " 52", "99.79%", "↘ degrading"],
            ["sa-east",    "1,300", " 64", "99.68%", "→ flat"],
        ],
    }},

    # ── 7. Q3 deliverables kanban ─────────────────────────────────────
    {"kind": "kanban", "role": "related", "payload": {
        "title": "Q3 deliverables",
        "columns": [
            {"name": "Backlog", "colour": "neutral", "cards": [
                {"title": "Mobile push for EU launch", "tag": "growth", "priority": "med"},
                {"title": "Refresh pricing page",      "tag": "marketing"},
            ]},
            {"name": "In progress", "colour": "amber", "cards": [
                {"title": "Latency: ap-south remediation", "tag": "infra",
                 "assignee": "Priya", "priority": "high"},
                {"title": "Onboarding rewrite (v3)", "tag": "growth", "assignee": "Marc"},
                {"title": "Audit log export",        "tag": "compliance"},
            ]},
            {"name": "Review", "colour": "violet", "cards": [
                {"title": "EU launch — go/no-go", "tag": "launch",
                 "assignee": "Anya", "priority": "high"},
            ]},
            {"name": "Shipped", "colour": "green", "cards": [
                {"title": "SAML SSO",          "tag": "compliance", "assignee": "Priya"},
                {"title": "Activity timeline", "tag": "product"},
            ]},
        ],
    }},

    # ── 8. Decisions timeline ─────────────────────────────────────────
    {"kind": "timeline", "role": "timeline", "payload": {
        "title": "Recent decisions",
        "events": [
            {"timestamp": "2026-04-18", "label": "Approved EU data residency plan",
             "kind": "release"},
            {"timestamp": "2026-04-22", "label": "Tracing rollout (us-east)",
             "kind": "deploy"},
            {"timestamp": "2026-04-29", "label": "ap-south latency incident",
             "kind": "incident",
             "body": "p95 spiked to 180ms for 2h. Root cause: connection pool "
                     "exhaustion on the analytics replica."},
            {"timestamp": "2026-05-02", "label": "Hired SRE lead", "kind": "note"},
            {"timestamp": "2026-05-05", "label": "v3 onboarding flow merged",
             "kind": "commit"},
        ],
    }},

    # ── 9. Reference web embed ────────────────────────────────────────
    {"kind": "web-embed", "role": "reference", "payload": {
        "title": "Internal docs · ops runbook",
        "url": "https://en.wikipedia.org/wiki/Site_reliability_engineering",
    }},

    # ── 10. Weekly KV summary ─────────────────────────────────────────
    {"kind": "key-value-card", "role": "node", "payload": {
        "title": "This week at a glance",
        "fields": [
            {"key": "MAU",            "value": "4,128 (+18%)"},
            {"key": "Revenue",        "value": "$284K (+12%)"},
            {"key": "p95 (global)",   "value": "29 ms"},
            {"key": "Open incidents", "value": "1 (P3, ap-south)"},
            {"key": "Releases",       "value": "7 this week"},
            {"key": "On-call",        "value": "Priya → Marc (Fri)"},
        ],
    }},

    # ── 11. Sticky note — motivational ────────────────────────────────
    {"kind": "sticky-note", "role": "node", "payload": {
        "body": "Make the EU launch boring 🚢\n\n— a calm launch is a successful launch",
        "author": "Anya",
        "colour": "violet",
    }},
]


def main() -> None:
    print(f"Placing {len(WIDGETS)} widgets on {BASE}\n")
    print(f"  {'kind':16s} {'role':10s} {'id':10s} title")
    print(f"  {'-'*16} {'-'*10} {'-'*10} {'-'*40}")
    for w in WIDGETS:
        res = post("/v1/canvas/widgets", w)
        title = w["payload"].get("title") or w["payload"].get("body", "")[:40]
        print(f"  {w['kind']:16s} {w['role']:10s} {res['id'][:8]}   {title[:40]}")
    print("\nAuto-tidy will arrange them into role slots in ~700ms.")


if __name__ == "__main__":
    main()
