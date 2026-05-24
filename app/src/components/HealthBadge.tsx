import { useEffect } from 'react';
import { useAppStore } from '../state/app-store';

export function HealthBadge() {
  const { health, refreshHealth } = useAppStore();

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 30_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  if (health.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="size-2 rounded-full bg-zinc-500 animate-pulse" />
        <span>loading…</span>
      </div>
    );
  }

  if (health.status === 'fail') {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400" title={health.error}>
        <span className="size-2 rounded-full bg-red-500" />
        <span>backend down</span>
        <span className="text-xs text-zinc-500 truncate max-w-xs">{health.error}</span>
      </div>
    );
  }

  // Show the active LLM provider + model (what the user actually picked /
  // overrode via env). Profile name goes in the tooltip — it's a config-file
  // label that's often misleading (e.g. the default 'claude-sdk' profile
  // can be env-overridden to use Gemini, so showing 'claude-sdk' to the
  // user implies the wrong model).
  const { llm, model, profile, embedder } = health.data;
  const tooltip =
    `profile: ${profile}` +
    `\nllm:     ${llm}` +
    (model ? `\nmodel:   ${model}` : '') +
    `\nembed:   ${embedder}`;
  return (
    <div
      className="flex items-center gap-2 text-sm text-zinc-300"
      title={tooltip}
    >
      <span className="size-2 rounded-full bg-green-500" />
      <span className="font-medium">{llm}</span>
      {model ? (
        <>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-500">{model}</span>
        </>
      ) : null}
    </div>
  );
}
