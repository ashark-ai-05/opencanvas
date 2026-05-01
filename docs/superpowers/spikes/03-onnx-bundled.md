# Spike 03: Bundled ONNX Embedder Viability

**Status:** Complete · 2026-05-01
**Decision:** GO

## Question
Can `bge-small-en-v1.5` (ONNX, ~130 MB) be bundled into a desktop app and
serve as the default embedder, meeting cold-start, throughput, and
portability targets?

## Method
- Loaded model via `@huggingface/transformers` (CPU, ONNX runtime via `onnxruntime-node`)
- Model downloaded on first run and cached at `spikes/node_modules/@huggingface/transformers/.cache/BAAI/bge-small-en-v1.5/onnx/model.onnx`
- Measured cold-start, warm throughput, embedding dim on a 200-chunk corpus
  of representative text (code, docs, tickets, logs, k8s commands)
- Tested offline (`allowRemoteModels = false`) load from cache
- Recorded cached model file size on disk

## Measurements
- Cold start: 4551 ms (target <5000) — PASS (borderline)
- Throughput: 272.0 chunks/sec (target >50) — PASS (5.4× headroom)
- Embedding dim: 384 (expected) — PASS
- Model file size on disk: 127 MB (target <200) — PASS
- Offline load (cache only): pass
- OS/CPU: macOS arm64
- Node version: v25.7.0

## Decision
**GO** — all four targets met. Cold-start is borderline (4551 ms vs 5000 ms
target) but throughput is 5× above target with significant headroom. Ship as
default embedder; pre-warm on app launch to mitigate the cold-start latency.

## Implications for v1
- Plan 4 (Provider layer): default `EmbeddingProvider` is `onnx-bundled`
- Plan 1 (Foundation): include model file in app bundle — 127 MB binary tax
- Initial-sync UX: pre-warm embedder on app launch (trigger first embed call
  in the background immediately after startup) to absorb the ~4.5 s cold-start
  before the user initiates any sync. Show a subtle "preparing search index"
  indicator if pre-warm is still in progress when the user first triggers sync.
- The cached model is self-contained under the HF transformers cache directory;
  no native build steps required — `onnxruntime-node` ships prebuilt binaries.

## Artifacts
- `spikes/03-onnx-bundled/embed.ts`
- `spikes/03-onnx-bundled/benchmark.ts`
- `spikes/03-onnx-bundled/run.log`
- Model cache: `spikes/node_modules/@huggingface/transformers/.cache/BAAI/bge-small-en-v1.5/onnx/model.onnx` (127 MB)
