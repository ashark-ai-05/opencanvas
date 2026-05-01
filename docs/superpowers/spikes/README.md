# Pre-v1 Spikes — Index

Five investigations completed before any v1 production code is written.
Each spike produces a binding decision for Plan 1 (Foundation).

## Status

| # | Spike                                    | Status      | Decision    |
|---|------------------------------------------|-------------|-------------|
| 1 | Amp MCP overlap                          | not started | —           |
| 2 | Amp structured-output reliability        | not started | —           |
| 3 | Bundled ONNX viability                   | complete    | go          |
| 4 | Anthropic OAuth public availability      | complete    | no-go       |
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
