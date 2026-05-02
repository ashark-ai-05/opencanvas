// llm-wiki backend client. Loaded by customware extension hooks.
//
// The backend listens on http://127.0.0.1:3457 by default. Override with
// the LLM_WIKI_BACKEND_URL env var when launching space-agent.

const DEFAULT_URL = 'http://127.0.0.1:3457';

export function getBackendUrl() {
  return (
    (typeof process !== 'undefined' && process.env?.LLM_WIKI_BACKEND_URL) ||
    DEFAULT_URL
  );
}

export async function health() {
  const res = await fetch(`${getBackendUrl()}/v1/health`);
  if (!res.ok) throw new Error(`llm-wiki backend health failed: ${res.status}`);
  return res.json();
}

export async function embed(texts) {
  const res = await fetch(`${getBackendUrl()}/v1/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`llm-wiki embed failed: ${err.error}`);
  }
  return res.json();
}

/**
 * Query the LLM. Returns an async iterator of ProviderEvent objects parsed
 * from the SSE stream.
 */
export async function* query({ prompt, systemPrompt }) {
  const res = await fetch(`${getBackendUrl()}/v1/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, systemPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`llm-wiki query failed: ${err.error}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE events (separated by \n\n)
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim());
      } catch {
        // skip malformed
      }
    }
  }
}
