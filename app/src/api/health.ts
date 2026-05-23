export type HealthResponse = {
  ok: boolean;
  profile: string;
  llm: string;
  embedder: string;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/v1/health');
  if (!res.ok) {
    throw new Error(`Backend health check failed: ${res.status}`);
  }
  return res.json();
}
