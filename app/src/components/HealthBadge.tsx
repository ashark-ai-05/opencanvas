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

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-300">
      <span className="size-2 rounded-full bg-green-500" />
      <span className="font-medium">{health.data.profile}</span>
      <span className="text-zinc-500">·</span>
      <span className="text-zinc-500">{health.data.llm}</span>
    </div>
  );
}
