# Pre-v1 Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve five load-bearing technical questions before v1 implementation begins, producing go/no-go decisions and recorded findings that feed Plan 1 (Foundation).

**Architecture:** Five independent investigations, each producing a small throwaway TypeScript script and a structured findings document. No production code is written; outputs are decisions, measurements, and short writeups committed under `docs/superpowers/spikes/`. The spikes workspace lives at `spikes/` (separate from production source) and is gitignored from any future build pipeline.

**Tech Stack:** Node.js 24 LTS · TypeScript · `@sourcegraph/amp-sdk` · `onnxruntime-node` · `tree-sitter` (for symbol-extraction sanity-check during spike 5) · the upstream `agent0ai/space-agent` repo (cloned for inspection).

**Reference:** Design spec at `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §8 (Risks, open questions, v1 cut).

---

## File structure

```
spikes/                                       # throwaway working directory
├─ package.json
├─ tsconfig.json
├─ .gitignore                                 # node_modules, model files, secrets
├─ 01-amp-mcp-overlap/
│  ├─ run.ts
│  └─ test-mcp-config.json
├─ 02-amp-structured-output/
│  ├─ run.ts
│  ├─ schema.json
│  └─ prompts.json
├─ 03-onnx-bundled/
│  ├─ embed.ts
│  ├─ benchmark.ts
│  └─ models/                                  # gitignored
├─ 04-anthropic-oauth/
│  └─ probe.ts
└─ 05-space-agent-fork/
   └─ inspect.sh

docs/superpowers/spikes/                      # committed findings (the deliverable)
├─ README.md                                   # index + summary table
├─ 01-amp-mcp-overlap.md
├─ 02-amp-structured-output.md
├─ 03-onnx-bundled.md
├─ 04-anthropic-oauth.md
└─ 05-space-agent-fork.md
```

Each `findings.md` has a fixed structure:

```markdown
# Spike NN: <title>

**Status:** Complete · YYYY-MM-DD
**Decision:** <go | no-go | conditional>

## Question
## Method
## Measurements / observations
## Decision criteria
## Outcome
## Implications for v1
## Artifacts
```

---

## Task 0: Workspace setup

**Files:**
- Create: `spikes/package.json`
- Create: `spikes/tsconfig.json`
- Create: `spikes/.gitignore`
- Create: `docs/superpowers/spikes/README.md`

- [ ] **Step 1: Create `spikes/package.json`**

```json
{
  "name": "llm-wiki-spikes",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "spike": "tsx",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=24" },
  "dependencies": {
    "@sourcegraph/amp-sdk": "*",
    "onnxruntime-node": "*",
    "@huggingface/transformers": "*",
    "ajv": "*",
    "ajv-formats": "*"
  },
  "devDependencies": {
    "tsx": "*",
    "typescript": "*",
    "@types/node": "*"
  }
}
```

- [ ] **Step 2: Create `spikes/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create `spikes/.gitignore`**

```
node_modules
*.onnx
models/
.env
.env.local
*.log
```

- [ ] **Step 4: Install dependencies**

```bash
cd spikes && npm install
```

Expected: clean install, `node_modules/` populated, no peer-dependency errors.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd spikes && npm run typecheck
```

Expected: exit code 0 (no .ts files yet, so trivially passes).

- [ ] **Step 6: Create `docs/superpowers/spikes/README.md` skeleton**

```markdown
# Pre-v1 Spikes — Index

Five investigations completed before any v1 production code is written.
Each spike produces a binding decision for Plan 1 (Foundation).

## Status

| # | Spike                                    | Status      | Decision    |
|---|------------------------------------------|-------------|-------------|
| 1 | Amp MCP overlap                          | not started | —           |
| 2 | Amp structured-output reliability        | not started | —           |
| 3 | Bundled ONNX viability                   | not started | —           |
| 4 | Anthropic OAuth public availability      | not started | —           |
| 5 | Space-agent fork strategy                | not started | —           |

## Reading order

Recommended: 4 → 3 → 5 → 2 → 1. Spike 4 is shortest and frees the
config schema; spike 3 unblocks the embedder default; spike 5 frames
the foundation work; spikes 2 and 1 inform the agent-mode design.

## Spike findings

- [01 — Amp MCP overlap](./01-amp-mcp-overlap.md)
- [02 — Amp structured-output](./02-amp-structured-output.md)
- [03 — Bundled ONNX viability](./03-onnx-bundled.md)
- [04 — Anthropic OAuth availability](./04-anthropic-oauth.md)
- [05 — Space-agent fork strategy](./05-space-agent-fork.md)
```

- [ ] **Step 7: Commit**

```bash
git add spikes/package.json spikes/tsconfig.json spikes/.gitignore \
        docs/superpowers/spikes/README.md
git commit -m "chore: scaffold spikes workspace and findings index"
```

---

## Task 1: Spike 04 — Anthropic OAuth public availability

*(Done first because it's shortest and gates the LLM provider config schema.)*

**Files:**
- Create: `spikes/04-anthropic-oauth/probe.ts`
- Create: `docs/superpowers/spikes/04-anthropic-oauth.md`

**Question:** Is OAuth-based authentication for Anthropic models publicly
available to third-party desktop apps (like Claude Code uses), or is it
restricted to Anthropic's own clients?

**Decision criteria:**
- **Go (OAuth in v1):** public OAuth endpoint documented, third-party
  client registration available
- **Conditional (OAuth in v1.1):** OAuth exists but registration is
  invite-only or undocumented for third-party apps
- **No-go (API-key only in v1):** no public OAuth, no path forward

- [ ] **Step 1: Search Anthropic's developer docs for OAuth**

Run:
```bash
# Open in browser; record findings, do not script web scraping
open https://docs.anthropic.com/
open https://docs.anthropic.com/en/api/getting-started
```

Search terms to try: "OAuth", "third-party authentication", "client
registration", "Claude Code authentication".

Record: any URLs found that document OAuth flows, last-updated dates of
those pages.

- [ ] **Step 2: Inspect Claude Code's auth flow as reference**

```bash
# Claude Code's source at ~/.claude/ may reveal OAuth client_id usage
grep -r "oauth" ~/.claude/ 2>/dev/null | head -20
grep -r "client_id" ~/.claude/ 2>/dev/null | head -20
```

Record: whether Claude Code uses a hard-coded Anthropic-issued client_id
(which suggests OAuth is reserved for Anthropic clients) or a public
registration flow.

- [ ] **Step 3: Check Anthropic Console for client registration**

Open https://console.anthropic.com/ and look under Settings/Developers
for any "OAuth applications" / "Client registration" section.

Record: present, absent, or "request access" form.

- [ ] **Step 4: Write decision**

Create `docs/superpowers/spikes/04-anthropic-oauth.md` with this template:

```markdown
# Spike 04: Anthropic OAuth Public Availability

**Status:** Complete · 2026-05-02
**Decision:** <go | conditional | no-go>

## Question
Is Anthropic's OAuth flow publicly available for third-party desktop apps,
or restricted to Anthropic's own clients?

## Method
1. Searched docs.anthropic.com for OAuth-related documentation.
2. Inspected Claude Code's local config for client_id patterns.
3. Checked console.anthropic.com for client-registration UI.

## Observations
- Documentation findings: <list URLs + dates>
- Claude Code auth pattern: <quote, with file reference>
- Console UI: <screenshot or description>

## Outcome
<one paragraph summarizing what's available>

## Implications for v1
- LLM provider config schema for `anthropic`:
  - if go: support `auth.type = 'oauth' | 'apiKey'`
  - if conditional/no-go: support `auth.type = 'apiKey'` only;
    revisit OAuth in v1.1

## Artifacts
- (none — research-only spike)
```

- [ ] **Step 5: Update spike index**

Edit `docs/superpowers/spikes/README.md`: change spike 04's status to
"complete" and decision to whichever was reached.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/spikes/04-anthropic-oauth.md \
        docs/superpowers/spikes/README.md
git commit -m "spike(04): record decision on Anthropic OAuth availability"
```

---

## Task 2: Spike 03 — Bundled ONNX viability

**Files:**
- Create: `spikes/03-onnx-bundled/embed.ts`
- Create: `spikes/03-onnx-bundled/benchmark.ts`
- Create: `docs/superpowers/spikes/03-onnx-bundled.md`

**Question:** Can `bge-small-en-v1.5` be bundled into a desktop app, run
via `onnxruntime-node` on macOS / Linux / Windows, and embed text fast
enough to be the default embedder?

**Decision criteria:**
- Cold-start time (first embed call) < 5 seconds
- Throughput on CPU: > 50 chunks/sec at chunk size ~512 tokens
- Bundled model file size acceptable (< 200 MB)
- Works on at least the developer's primary OS without manual native-build steps

- [ ] **Step 1: Download `bge-small-en-v1.5` ONNX model**

```bash
mkdir -p spikes/03-onnx-bundled/models
cd spikes/03-onnx-bundled/models
# Use HuggingFace's BAAI/bge-small-en-v1.5 ONNX export
curl -L -o model.onnx \
  https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx
curl -L -o tokenizer.json \
  https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer.json
ls -lh model.onnx
```

Expected: `model.onnx` ~130 MB, `tokenizer.json` ~700 KB.

- [ ] **Step 2: Write `spikes/03-onnx-bundled/embed.ts`**

```typescript
import { pipeline, env } from '@huggingface/transformers';

// Force local model loading from ./models
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', import.meta.url).pathname;

export async function loadEmbedder() {
  const t0 = performance.now();
  const extractor = await pipeline(
    'feature-extraction',
    'BAAI/bge-small-en-v1.5',
    { device: 'cpu' }
  );
  const coldMs = performance.now() - t0;
  return { extractor, coldMs };
}

export async function embed(extractor: any, text: string): Promise<Float32Array> {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data as Float32Array;
}
```

- [ ] **Step 3: Write `spikes/03-onnx-bundled/benchmark.ts`**

```typescript
import { loadEmbedder, embed } from './embed.js';

const SAMPLES = [
  'function processOrder(order) { /* ... */ }',
  'The OrderProcessor service handles checkout flow.',
  'JIRA-1234: Fix race condition in payment retry logic.',
  // 30+ more lines, mix of code, docs, ticket text — paste real samples
];

async function main() {
  const { extractor, coldMs } = await loadEmbedder();
  console.log(`cold start: ${coldMs.toFixed(0)} ms`);

  // Warm-up
  await embed(extractor, 'warmup');

  // Throughput
  const N = 200;
  const corpus = Array.from({ length: N }, (_, i) => SAMPLES[i % SAMPLES.length]);
  const t0 = performance.now();
  for (const text of corpus) await embed(extractor, text);
  const ms = performance.now() - t0;
  const perSec = (N / ms) * 1000;

  console.log(`embedded ${N} chunks in ${ms.toFixed(0)} ms`);
  console.log(`throughput: ${perSec.toFixed(1)} chunks/sec`);

  // Output dim check
  const v = await embed(extractor, 'dim probe');
  console.log(`embedding dim: ${v.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run benchmark**

```bash
cd spikes && npx tsx 03-onnx-bundled/benchmark.ts
```

Expected output (rough targets, machine-dependent):
```
cold start: <5000 ms
embedded 200 chunks in <4000 ms
throughput: >50 chunks/sec
embedding dim: 384
```

Record actual numbers.

- [ ] **Step 5: Test bundling shape (Node SEA or pkg)**

```bash
# Quick check: can the model file be loaded from a path passed at runtime?
cd spikes && npx tsx -e "
import { pipeline, env } from '@huggingface/transformers';
env.allowRemoteModels = false;
env.localModelPath = process.env.MODEL_PATH;
const extractor = await pipeline('feature-extraction', 'BAAI/bge-small-en-v1.5');
const out = await extractor('test', { pooling: 'mean', normalize: true });
console.log('dim:', out.data.length);
" MODEL_PATH=$(pwd)/03-onnx-bundled/models/
```

Expected: dim: 384, no errors. This confirms model can live anywhere on disk.

- [ ] **Step 6: Write findings doc**

Create `docs/superpowers/spikes/03-onnx-bundled.md` using the standard template:

```markdown
# Spike 03: Bundled ONNX Embedder Viability

**Status:** Complete · 2026-05-02
**Decision:** <go | conditional | no-go>

## Question
Can `bge-small-en-v1.5` (ONNX, 130 MB) be bundled into a desktop app and
serve as the default embedder, meeting cold-start, throughput, and
portability targets?

## Method
- Downloaded model + tokenizer from HuggingFace
- Loaded via `@huggingface/transformers` with local-only paths
- Measured cold-start, warm throughput, embedding dim
- Verified loading from a runtime-configurable path

## Measurements
- Cold start: <X> ms (target <5000)
- Throughput: <Y> chunks/sec (target >50)
- Embedding dim: 384 (expected)
- Model file size: <Z> MB
- OS tested: <macos / linux / windows>

## Decision
- if all targets met: **GO** — ship as default embedder
- if cold-start > 5s but throughput OK: **CONDITIONAL** — pre-warm in
  background on app launch; keep as default
- if throughput < 50/sec: **NO-GO** — fall back to keyword-only retrieval
  default; require optional cloud embedder

## Implications for v1
- Plan 4 (Provider layer): default `EmbeddingProvider` is `onnx-bundled`
- Plan 1 (Foundation): include model file in app bundle, ~130 MB binary tax
- Initial-sync UX: pre-warm embedder before first index task to mask cold start

## Artifacts
- `spikes/03-onnx-bundled/embed.ts`
- `spikes/03-onnx-bundled/benchmark.ts`
- `spikes/03-onnx-bundled/models/` (gitignored)
```

- [ ] **Step 7: Update spike index + commit**

```bash
# Edit docs/superpowers/spikes/README.md: status=complete, decision=<reached>
git add spikes/03-onnx-bundled/ docs/superpowers/spikes/03-onnx-bundled.md \
        docs/superpowers/spikes/README.md
git commit -m "spike(03): record ONNX bundled embedder viability findings"
```

---

## Task 3: Spike 05 — Space-agent fork strategy

**Files:**
- Create: `spikes/05-space-agent-fork/inspect.sh`
- Create: `docs/superpowers/spikes/05-space-agent-fork.md`

**Question:** Should we (a) fork space-agent and modify it directly, or
(b) install/embed space-agent and add our customizations as external
modules / patches?

**Decision criteria:**
- How frequently does space-agent change upstream? (commits/week, breaking changes/quarter)
- What extension points does it expose for new sources, widgets, skills?
- How invasive are our required changes (MCP integration, profile config, our widget catalog)?
- Update-merge friction: cost of taking upstream updates

- [ ] **Step 1: Clone space-agent**

```bash
mkdir -p spikes/05-space-agent-fork
cd spikes/05-space-agent-fork
git clone https://github.com/agent0ai/space-agent.git
cd space-agent
git log --oneline -20
```

Record: branch structure, recent commit cadence.

- [ ] **Step 2: Build space-agent locally**

```bash
cd spikes/05-space-agent-fork/space-agent
npm install
node space user create admin --password "spike-only" --full-name "Admin" --groups _admin
node space serve &
sleep 5
curl -s http://localhost:3000 | head -50
kill %1
```

Record: build success/failure, time to first running, any platform-specific quirks.

- [ ] **Step 3: Map extension points**

Inspect:
- `app/L0/_all/mod/` — module structure
- `commands/params.yaml` — CLI surface
- Any `SKILL.md` files in repo
- `AGENTS.md` files (per the README, these are the architecture map)

```bash
cd spikes/05-space-agent-fork/space-agent
find . -name "AGENTS.md" -not -path "./node_modules/*" | head
find . -name "SKILL.md" -not -path "./node_modules/*" | head
ls app/L0/_all/mod/
```

Read each AGENTS.md found. Record extension model: do new modules drop
in cleanly, or is there core surgery required?

- [ ] **Step 4: Identify our required changes vs. extensions**

For each of these, classify as `extension` (drop-in module, no core changes)
or `fork-required` (core code modification):

| Required change                        | Classification |
|----------------------------------------|----------------|
| MCP transport adapter                  | ?              |
| Source registry + introspection        | ?              |
| Profile config + activation probe      | ?              |
| 14 widgets in our catalog              | ?              |
| 4 canvas templates                     | ?              |
| Cross-source link resolver             | ?              |
| LLM provider abstraction               | ?              |
| Index orchestrator + indexers          | ?              |
| Result/Capability schemas              | ?              |

- [ ] **Step 5: Estimate update-merge friction**

```bash
cd spikes/05-space-agent-fork/space-agent
# How active is upstream?
git log --since="3 months ago" --oneline | wc -l
git log --since="1 month ago" --oneline | wc -l
# Any major refactors visible in titles?
git log --since="3 months ago" --oneline | grep -iE "refactor|rename|breaking"
```

Record cadence + observed instability.

- [ ] **Step 6: Write findings**

Create `docs/superpowers/spikes/05-space-agent-fork.md`:

```markdown
# Spike 05: Space-agent Fork Strategy

**Status:** Complete · 2026-05-02
**Decision:** <fork | embed+extend | hybrid>

## Question
Fork space-agent and own the changes, or install/embed it and contribute
customizations as external modules?

## Method
- Cloned upstream, built locally
- Mapped extension points via AGENTS.md / module structure
- Classified each required v1 change as extension vs. core modification
- Measured upstream activity (commits/month, breaking change signals)

## Observations
- Upstream cadence: <N> commits/month, <M> apparent breaking changes/quarter
- Extension surface: <summary>
- Required-change classification: <table>

## Decision
- if all required changes are extensions: **embed+extend** — install
  space-agent as a dependency, add modules
- if 1–2 require core changes but rest are extensions: **hybrid** —
  pin a known-good upstream commit, maintain a small patch set
- if many require core changes: **fork** — diverge fully, accept loss of
  upstream updates as cost of velocity

## Implications for v1
- Plan 1 (Foundation) starts with: <git clone | npm install | git fork>
- Update strategy: <how we'll consume upstream changes>

## Artifacts
- `spikes/05-space-agent-fork/space-agent/` (gitignored — too large to commit)
- `spikes/05-space-agent-fork/inspect.sh` (the inspection commands above)
```

- [ ] **Step 7: Save the inspection commands**

Create `spikes/05-space-agent-fork/inspect.sh`:

```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d space-agent ]; then
  git clone https://github.com/agent0ai/space-agent.git
fi

cd space-agent
echo "=== recent commits ==="
git log --oneline -20

echo "=== AGENTS.md files ==="
find . -name "AGENTS.md" -not -path "./node_modules/*"

echo "=== module structure ==="
ls app/L0/_all/mod/ 2>/dev/null || echo "module path not found"

echo "=== upstream cadence (last 3 months) ==="
git log --since="3 months ago" --oneline | wc -l
```

```bash
chmod +x spikes/05-space-agent-fork/inspect.sh
```

- [ ] **Step 8: Update gitignore**

Add to `spikes/.gitignore`:

```
05-space-agent-fork/space-agent/
```

- [ ] **Step 9: Commit**

```bash
git add spikes/05-space-agent-fork/inspect.sh spikes/.gitignore \
        docs/superpowers/spikes/05-space-agent-fork.md \
        docs/superpowers/spikes/README.md
git commit -m "spike(05): record space-agent fork strategy decision"
```

---

## Task 4: Spike 02 — Amp structured-output reliability

**Files:**
- Create: `spikes/02-amp-structured-output/run.ts`
- Create: `spikes/02-amp-structured-output/schema.json`
- Create: `spikes/02-amp-structured-output/prompts.json`
- Create: `docs/superpowers/spikes/02-amp-structured-output.md`

**Question:** When asked to return JSON matching a specific schema, does
Amp reliably comply? At what rate first-try? After a stricter retry?

**Decision criteria:**
- First-try valid JSON matching schema: ≥80% → **go (clean)**
- First-try ≥50% with retry success: → **conditional** (parse + retry path acceptable)
- First-try <50%: → **redesign** (Mode B is fragile; consider Mode A only)

- [ ] **Step 1: Authenticate Amp**

```bash
# Per ampcode.com/manual: get token from ampcode.com/settings
export AMP_API_KEY=sgamp_<your-token>
```

Confirm:
```bash
echo $AMP_API_KEY | head -c 10
```

- [ ] **Step 2: Write `spikes/02-amp-structured-output/schema.json`**

A simplified ResultEnvelope schema for the spike (full schema lives in
the v1 codebase later):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["results"],
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "shape", "provenance"],
        "properties": {
          "id":   { "type": "string" },
          "kind": {
            "type": "string",
            "enum": ["text-document", "code-file", "code-symbol", "ticket",
                     "wiki-page", "log-stream", "k8s-resource", "web-page"]
          },
          "shape": { "type": "object" },
          "provenance": {
            "type": "object",
            "required": ["uri", "fetchedAt"],
            "properties": {
              "uri": { "type": "string" },
              "fetchedAt": { "type": "number" }
            }
          }
        }
      }
    },
    "narrative": { "type": "string" }
  },
  "additionalProperties": false
}
```

- [ ] **Step 3: Write `spikes/02-amp-structured-output/prompts.json`**

Ten representative prompts at varied complexity. Each entry has a
`prompt` and an optional `expected_kinds` (for sanity-checking):

```json
[
  { "prompt": "Find all references to the function processPayment in the codebase", "expected_kinds": ["code-symbol", "code-file"] },
  { "prompt": "Summarize the README of this repository", "expected_kinds": ["text-document"] },
  { "prompt": "List the open Jira tickets for the checkout service", "expected_kinds": ["ticket"] },
  { "prompt": "Show me the Confluence page on deployment runbooks", "expected_kinds": ["wiki-page"] },
  { "prompt": "What logs from the last hour mention 'TimeoutError'?", "expected_kinds": ["log-stream"] },
  { "prompt": "Tell me about the OrderProcessor class — its methods and where it's used", "expected_kinds": ["code-symbol", "code-file"] },
  { "prompt": "What's new in the auth service since last Tuesday?", "expected_kinds": ["code-diff", "ticket"] },
  { "prompt": "Find the kubernetes deployment manifest for the api-gateway", "expected_kinds": ["k8s-resource"] },
  { "prompt": "Show all incidents filed in the last 7 days that mention 'database'", "expected_kinds": ["ticket"] },
  { "prompt": "Trace the function authenticateUser across files and tickets", "expected_kinds": ["code-symbol", "ticket"] }
]
```

- [ ] **Step 4: Write `spikes/02-amp-structured-output/run.ts`**

```typescript
import { execute } from '@sourcegraph/amp-sdk';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, 'schema.json'), 'utf8'));
const prompts = JSON.parse(readFileSync(resolve(here, 'prompts.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const SYSTEM_INSTRUCTION = `
You will respond with ONLY a JSON object matching this schema:
${JSON.stringify(schema, null, 2)}

No prose, no markdown fences. The first character of your response must
be '{' and the last must be '}'.
`.trim();

const STRICT_RETRY = `
Your previous response did not parse as valid JSON or did not match the
schema. Respond again with ONLY a JSON object matching the schema. No
prose, no markdown fences. First character '{', last character '}'.
`.trim();

type Trial = {
  prompt: string;
  attempt1_valid: boolean;
  attempt1_errors?: string[];
  attempt2_valid?: boolean;
  attempt2_errors?: string[];
  raw1?: string;
  raw2?: string;
};

async function ampOnce(prompt: string): Promise<string> {
  let result = '';
  for await (const msg of execute({ prompt: `${SYSTEM_INSTRUCTION}\n\n${prompt}` })) {
    if (msg.type === 'result' && !msg.is_error) {
      result = msg.result;
      break;
    }
  }
  return result;
}

function parseAndValidate(raw: string): { ok: boolean; errors: string[] } {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, errors: [`parse: ${(e as Error).message}`] }; }
  const ok = validate(parsed);
  return ok
    ? { ok: true, errors: [] }
    : { ok: false, errors: (validate.errors ?? []).map(e => `${e.instancePath} ${e.message}`) };
}

async function main() {
  const trials: Trial[] = [];

  for (const { prompt } of prompts as Array<{ prompt: string }>) {
    process.stdout.write(`prompt: ${prompt.slice(0, 60)}... `);
    const raw1 = await ampOnce(prompt);
    const r1 = parseAndValidate(raw1);
    const trial: Trial = {
      prompt,
      attempt1_valid: r1.ok,
      attempt1_errors: r1.errors,
      raw1
    };

    if (!r1.ok) {
      const raw2 = await ampOnce(`${prompt}\n\n${STRICT_RETRY}`);
      const r2 = parseAndValidate(raw2);
      trial.attempt2_valid = r2.ok;
      trial.attempt2_errors = r2.errors;
      trial.raw2 = raw2;
    }

    trials.push(trial);
    console.log(r1.ok ? 'PASS' : (trial.attempt2_valid ? 'PASS-RETRY' : 'FAIL'));
  }

  const first = trials.filter(t => t.attempt1_valid).length;
  const retry = trials.filter(t => !t.attempt1_valid && t.attempt2_valid).length;
  const fail  = trials.filter(t => !t.attempt1_valid && !t.attempt2_valid).length;

  console.log(`\n=== Results (n=${trials.length}) ===`);
  console.log(`first-try valid:    ${first} (${(first/trials.length*100).toFixed(0)}%)`);
  console.log(`retry-valid:        ${retry} (${(retry/trials.length*100).toFixed(0)}%)`);
  console.log(`failed both:        ${fail} (${(fail/trials.length*100).toFixed(0)}%)`);

  writeFileSync(resolve(here, 'trials.json'), JSON.stringify(trials, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the spike**

```bash
cd spikes && npx tsx 02-amp-structured-output/run.ts | tee 02-amp-structured-output/run.log
```

Expected: 10 prompts processed, summary line at end with first-try / retry / fail counts.

- [ ] **Step 6: Inspect failures**

```bash
cd spikes && cat 02-amp-structured-output/trials.json | jq '.[] | select(.attempt1_valid == false) | { prompt, errors: .attempt1_errors, raw: (.raw1 | .[0:200]) }'
```

Record 2-3 representative failure modes (markdown fences? extra prose? wrong field names? schema violations?).

- [ ] **Step 7: Write findings doc**

Create `docs/superpowers/spikes/02-amp-structured-output.md`:

```markdown
# Spike 02: Amp Structured-Output Reliability

**Status:** Complete · 2026-05-02
**Decision:** <go-clean | conditional | redesign>

## Question
Does Amp reliably emit JSON matching a given schema when instructed to,
making `agent`-mode (Mode B) viable for our agent loop?

## Method
- Defined a simplified ResultEnvelope JSON schema (8 result kinds)
- Composed 10 representative prompts at varied complexity
- Sent each through Amp.execute() with a strict JSON-only system prompt
- On parse/schema failure, sent a stricter retry prompt
- Validated with ajv

## Measurements
- First-try valid: <N>/10 (<%)
- Retry-valid: <M>/10 (<%)
- Failed both: <F>/10 (<%)
- Common failure modes: <markdown-fence wrapping | extra prose | schema mismatch | invalid kind enum>

## Decision
- ≥80% first-try → **go-clean**: trust Amp output, parse and render
- ≥50% first-try with retry recovering most failures → **conditional**:
  build retry-once + MarkdownWidget fallback path
- <50% first-try → **redesign**: agent-mode is fragile; either prompt-engineer
  harder or treat agent-mode as v1.5 and ship with model-mode only

## Implications for v1
- Plan 5 (Agent loop): the parse-retry-fallback shape from spec §6.5 is
  <required | optional>; sets test fixture expectations
- Prompt engineering investment: <low | medium | high>

## Artifacts
- `spikes/02-amp-structured-output/run.ts`
- `spikes/02-amp-structured-output/schema.json`
- `spikes/02-amp-structured-output/prompts.json`
- `spikes/02-amp-structured-output/trials.json`
- `spikes/02-amp-structured-output/run.log`
```

- [ ] **Step 8: Commit**

```bash
git add spikes/02-amp-structured-output/run.ts \
        spikes/02-amp-structured-output/schema.json \
        spikes/02-amp-structured-output/prompts.json \
        spikes/02-amp-structured-output/trials.json \
        spikes/02-amp-structured-output/run.log \
        docs/superpowers/spikes/02-amp-structured-output.md \
        docs/superpowers/spikes/README.md
git commit -m "spike(02): measure Amp structured-output reliability"
```

---

## Task 5: Spike 01 — Amp MCP overlap

**Files:**
- Create: `spikes/01-amp-mcp-overlap/run.ts`
- Create: `spikes/01-amp-mcp-overlap/test-mcp-config.json`
- Create: `docs/superpowers/spikes/01-amp-mcp-overlap.md`

**Question:** When Amp is configured with the same MCP servers our app
uses, does it (a) discover and use them correctly, or (b) duplicate-call /
miscoordinate, requiring us to hide MCP from Amp and provide pre-fetched
context instead?

**Decision criteria:**
- **Option A (let Amp drive at work):** Amp called the right MCP tools,
  used results coherently, no duplicate fetches.
- **Option B (hide MCP from Amp):** Amp ignored or misused MCP; we
  pre-fetch and inject results into the Amp prompt.

- [ ] **Step 1: Pick a single MCP server for the spike**

Use the simplest available MCP server (e.g., a filesystem MCP, or a
fixtures-based MCP if no real one is convenient). The point of the spike
is the integration shape, not the depth of any single source.

Record which MCP server was chosen and why.

- [ ] **Step 2: Configure Amp to use the MCP server**

Per the Amp manual, Amp supports MCP via configuration. The location of
the config file varies — check `~/.config/amp/` or `~/.amp/`:

```bash
ls -la ~/.config/amp/ ~/.amp/ 2>/dev/null
cat ~/.config/amp/config.json 2>/dev/null || cat ~/.amp/config.json 2>/dev/null
```

Add an MCP server entry. Example shape (adjust to actual Amp config schema):

```json
{
  "mcpServers": {
    "spike-fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/spike-fs-fixture"]
    }
  }
}
```

Create the fixture directory:
```bash
mkdir -p /tmp/spike-fs-fixture
echo "this is a fixture file mentioning processPayment" > /tmp/spike-fs-fixture/sample.txt
echo "another fixture file mentioning OrderProcessor" > /tmp/spike-fs-fixture/orders.txt
```

- [ ] **Step 3: Write `spikes/01-amp-mcp-overlap/run.ts`**

```typescript
import { execute } from '@sourcegraph/amp-sdk';

type Mode = 'mcp-exposed' | 'mcp-hidden';

const PROMPTS = [
  'Find files in the configured filesystem source that mention "processPayment". List the file paths.',
  'Read /tmp/spike-fs-fixture/orders.txt and summarize its contents.',
  'How many files are in /tmp/spike-fs-fixture/ and what do they contain?'
];

async function runMode(mode: Mode, prompt: string) {
  console.log(`\n--- ${mode}: ${prompt.slice(0, 60)}... ---`);
  const enriched = mode === 'mcp-hidden'
    ? `Do not call any MCP tools. Use only the context provided here.\n\nContext:\n` +
      `<files>\n` +
      `/tmp/spike-fs-fixture/sample.txt: this is a fixture file mentioning processPayment\n` +
      `/tmp/spike-fs-fixture/orders.txt: another fixture file mentioning OrderProcessor\n` +
      `</files>\n\n${prompt}`
    : prompt;

  const events: Array<{ type: string; tool?: string; result?: string }> = [];
  for await (const msg of execute({ prompt: enriched })) {
    if (msg.type === 'system')    events.push({ type: 'system' });
    if (msg.type === 'assistant') events.push({ type: 'assistant', tool: extractToolName(msg) });
    if (msg.type === 'result')    events.push({ type: 'result', result: (msg as any).result });
  }
  return events;
}

function extractToolName(msg: any): string | undefined {
  // Amp's assistant messages may include tool_use blocks; record names if present
  try {
    const blocks = msg.content ?? msg.message?.content ?? [];
    return blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => b.name).join(',') || undefined;
  } catch { return undefined; }
}

async function main() {
  const log: any = { exposed: [], hidden: [] };
  for (const prompt of PROMPTS) {
    log.exposed.push({ prompt, events: await runMode('mcp-exposed', prompt) });
    log.hidden.push({ prompt, events: await runMode('mcp-hidden', prompt) });
  }
  console.log(JSON.stringify(log, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run with MCP exposed**

```bash
cd spikes && npx tsx 01-amp-mcp-overlap/run.ts | tee 01-amp-mcp-overlap/run.log
```

Observe:
- Did Amp call any MCP tools? Which?
- Did the final result reference the fixture files correctly?
- Were there redundant tool calls?

- [ ] **Step 5: Run with MCP hidden (pre-fetched context)**

Edit `run.ts` to switch the default mode, or run a second pass — already
covered by the dual-mode design above. Compare results:
- Final result quality: same / better / worse?
- Latency: same / longer (Amp's reasoning loop) / shorter (no tool calls)?
- Token usage: visible from `system` messages?

- [ ] **Step 6: Write findings**

Create `docs/superpowers/spikes/01-amp-mcp-overlap.md`:

```markdown
# Spike 01: Amp MCP Overlap

**Status:** Complete · 2026-05-02
**Decision:** <expose-mcp-to-amp | hide-mcp-prefetch | mixed>

## Question
Should Amp share MCP server access with our app's agent layer (Mode A),
or should we hide MCP from Amp and inject pre-fetched context (Mode B)?

## Method
- Configured Amp with one filesystem MCP server (fixture data)
- Ran 3 prompts in two modes: `mcp-exposed` and `mcp-hidden + injected-context`
- Captured tool calls, result quality, and observed coordination

## Observations
- mcp-exposed:
  - Tool calls per prompt: <list>
  - Result quality: <good / ok / bad>
  - Coordination issues: <none / duplicate fetches / wrong tool order>
- mcp-hidden + injected:
  - Result quality vs. exposed: <better / same / worse>
  - Latency: <faster / same / slower>

## Decision
- if expose works cleanly: **expose-mcp-to-amp** — at work, configure
  Amp with the same MCP servers; let it drive
- if expose is messy: **hide-mcp-prefetch** — our app fetches via MCP,
  injects results into Amp's prompt; Amp focuses on synthesis only
- if mixed: **mixed** — expose simple sources (filesystem, web), hide
  rich ones (Confluence/Jira) where coordination matters

## Implications for v1
- Plan 5 (Agent loop) `AgentExecutor` shape:
  - if expose: build task envelope without retrieval results; trust Amp
  - if hide: run our retrieval first, then call Amp.execute() with results in prompt
  - if mixed: per-source allowlist for Amp exposure

## Artifacts
- `spikes/01-amp-mcp-overlap/run.ts`
- `spikes/01-amp-mcp-overlap/run.log`
- Fixture directory: `/tmp/spike-fs-fixture/` (recreate via above commands)
```

- [ ] **Step 7: Commit**

```bash
git add spikes/01-amp-mcp-overlap/run.ts spikes/01-amp-mcp-overlap/run.log \
        docs/superpowers/spikes/01-amp-mcp-overlap.md \
        docs/superpowers/spikes/README.md
git commit -m "spike(01): record Amp MCP overlap behavior"
```

---

## Task 6: Spike summary + handoff to Plan 1

**Files:**
- Modify: `docs/superpowers/spikes/README.md`

- [ ] **Step 1: Update the spike index summary**

Edit `docs/superpowers/spikes/README.md`:

- Set every row in the status table to `complete` with the recorded decision
- Append a "Plan 1 implications" section at the bottom, derived from the
  five `findings.md` files

```markdown
## Plan 1 implications

Synthesizing the five spike outcomes, Plan 1 (Foundation) should:

- Embedder default: <onnx-bundled | keyword-only> based on spike 03
- Space-agent integration: <fork | embed+extend | hybrid> based on spike 05
- Anthropic OAuth: <ship in v1 | defer to v1.1> based on spike 04
- AgentExecutor shape: <trust Amp + MCP | inject pre-fetched | mixed> based on spike 01
- ResultEnvelope robustness: <strict | parse-retry-fallback | redesign> based on spike 02

Changes to the design spec (§ to update): <list specific section numbers>
```

- [ ] **Step 2: If any spike outcome contradicts the design spec, file a follow-up note**

If, e.g., spike 03 fails and ONNX is no-go, Plan 1 cannot proceed without a
design-spec amendment. Capture this:

```bash
# Only if the spec needs an amendment based on spike findings:
cat > docs/superpowers/specs/2026-05-02-llm-wiki-design-amendments.md <<'EOF'
# Design Spec Amendments — Post-Spikes

Amendments to `2026-05-02-llm-wiki-design.md` driven by Plan 0 outcomes.
Each amendment names the affected section and the new decision.

## Amendment 1: <title>

**Affected section:** §X.Y
**Spike that drove this:** <NN>
**Original wording:** "..."
**New wording:** "..."
**Reason:** "..."
EOF
```

- [ ] **Step 3: Commit the summary**

```bash
git add docs/superpowers/spikes/README.md \
        docs/superpowers/specs/2026-05-02-llm-wiki-design-amendments.md
git commit -m "spikes: synthesize Plan 1 implications and any spec amendments"
```

- [ ] **Step 4: Tag the milestone**

```bash
git tag plan-0-spikes-complete -m "Pre-v1 spikes complete; Plan 1 unblocked"
```

---

## Spec coverage check

| Spec section / requirement                              | Covered by                  |
|---------------------------------------------------------|------------------------------|
| §8 risk #1 — Amp structured-output reliability          | Task 4 (spike 02)            |
| §8 risk #2 — codebase indexing time                     | not a spike; covered in Plan 3 |
| §8 risk #3 — bundled ONNX recall quality                | Task 2 (spike 03)            |
| §8 spike #1 — Amp MCP overlap                           | Task 5 (spike 01)            |
| §8 spike #2 — Amp structured-output                     | Task 4 (spike 02)            |
| §8 spike #3 — bundled ONNX viability                    | Task 2 (spike 03)            |
| §8 spike #4 — Anthropic OAuth availability              | Task 1 (spike 04)            |
| §8 spike #5 — Space-agent fork strategy                 | Task 3 (spike 05)            |
| Plan 0 deliverable: 5 go/no-go decisions + writeups     | Tasks 1–5                    |
| Plan 0 deliverable: implications for Plan 1             | Task 6                       |

All Plan 0 spec requirements are covered.

---

*End of plan.*
