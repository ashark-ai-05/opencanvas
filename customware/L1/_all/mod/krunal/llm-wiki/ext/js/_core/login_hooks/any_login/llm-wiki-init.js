// Fires after any successful login navigation. Pre-warms the embedder via
// the llm-wiki backend so the first user query doesn't pay the ONNX cold-
// start (~4.5s on M-series CPU). Best effort; failures are logged but
// do not block login.
//
// Per design spec amendment 3: pre-warm on app launch is mandatory.
//
// Upstream hook contract (from vendor/space-agent login_hooks/login-hooks.js):
//   The `any_login` extension point is called with a context object:
//   { identity, isFirstLogin, isLoginNavigation, markerPath, username }
//   The hook is called only when arrivedFromLogin === true (isLoginNavigation).

import { health, embed } from '../../../../request.js';

export default async function llmWikiInit(context = {}) {
  // health() fast-exits if backend isn't running; embed warmup is fire-and-forget.
  try {
    const h = await health();
    console.info('[llm-wiki] backend healthy:', h);
  } catch (e) {
    console.warn('[llm-wiki] backend health check failed:', e?.message ?? e);
    return;
  }

  // Fire-and-forget warmup. Do not await — returns immediately so login
  // is not delayed.
  embed(['warmup']).catch((e) => {
    console.warn('[llm-wiki] embedder warmup failed:', e?.message ?? e);
  });
}
