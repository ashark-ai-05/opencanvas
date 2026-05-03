import { Toaster } from 'sonner';
import { Canvas } from './canvas/Canvas';
import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';

export function App() {
  return (
    <div className="flex h-full flex-col relative bg-[var(--color-bg)]">
      <header className="flex items-center justify-between px-5 h-12 shrink-0 strata-glass relative z-10 border-b border-white/5">
        <div className="flex items-center gap-3">
          {/* Mark — small square with the gradient, then wordmark */}
          <div
            aria-hidden
            className="size-5 rounded-md bg-gradient-to-br from-violet-400 to-fuchsia-400"
            style={{
              boxShadow:
                '0 0 0 1px rgba(255,255,255,0.06) inset, 0 4px 14px -4px rgba(167,139,250,0.6)',
            }}
          />
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Strata
          </h1>
        </div>
        <HealthBadge />
      </header>
      <main className="flex-1 min-h-0 grid grid-rows-[1fr_minmax(200px,34%)]">
        <section className="min-h-0 overflow-hidden border-b border-white/5 relative bg-[var(--color-bg)]">
          <Canvas />
        </section>
        <section className="min-h-0 overflow-hidden bg-[var(--color-bg)]">
          <Chat />
        </section>
      </main>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(10, 10, 13, 0.85)',
            color: '#f4f4f5',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(14px)',
          },
        }}
      />
    </div>
  );
}
