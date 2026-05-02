import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">
          llm-wiki
        </h1>
        <HealthBadge />
      </header>
      <main className="flex-1 overflow-hidden">
        <Chat />
      </main>
    </div>
  );
}
