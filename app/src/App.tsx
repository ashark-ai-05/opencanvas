import { Canvas } from './canvas/Canvas';
import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3 shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">llm-wiki</h1>
        <HealthBadge />
      </header>
      <main className="flex-1 min-h-0 grid grid-rows-[1fr_minmax(160px,28%)]">
        <section className="min-h-0 overflow-hidden border-b border-zinc-800">
          <Canvas />
        </section>
        <section className="min-h-0 overflow-hidden">
          <Chat />
        </section>
      </main>
    </div>
  );
}
