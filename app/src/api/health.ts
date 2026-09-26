export type HealthResponse = {
  ok: boolean;
  /** Config-file profile label (e.g. 'claude-sdk'). Diagnostic only — the UI shows `llm`/`model`. */
  profile: string;
  /** Active LLM provider id (e.g. 'gemini', 'anthropic', 'openai'). */
  llm: string;
  /** Active model id (e.g. 'gemini-flash-lite-latest'). Null when the provider has no model concept. */
  model: string | null;
  embedder: string;
  /** True when the backend runs with OPENCANVAS_DEMO=1. Optional for older backends. */
  demo?: boolean;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/v1/health');
  if (!res.ok) {
    throw new Error(`Backend health check failed: ${res.status}`);
  }
  return res.json();
}
