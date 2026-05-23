/**
 * Frontend logger. In dev (Vite injects `import.meta.env.DEV`) all
 * levels write through to the console as usual; in a production build,
 * `debug` and `info` are no-ops, while `warn` and `error` still surface
 * so genuine runtime problems remain visible in DevTools.
 *
 * Use this instead of console.* in app code so packaged builds don't
 * leak our internal diagnostic chatter to user-opened DevTools panels.
 * CLI scripts (src/cli.ts, src/kb/cli-commands.ts) where stdout IS the
 * UI should keep using console directly.
 */
const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ??
  false;

type LogFn = (...args: unknown[]) => void;
const noop: LogFn = () => undefined;

// Delegate at call-time rather than binding at module-load time. This
// matters for tests: `vi.spyOn(console, 'warn')` only intercepts calls
// made AFTER the spy is installed, so a pre-bound reference would skip
// the spy. The closure-form keeps `console.warn` resolved lazily.
export const logger = {
  debug: (isDev ? (...args: unknown[]) => console.debug(...args) : noop) as LogFn,
  info: (isDev ? (...args: unknown[]) => console.info(...args) : noop) as LogFn,
  warn: ((...args: unknown[]) => console.warn(...args)) as LogFn,
  error: ((...args: unknown[]) => console.error(...args)) as LogFn,
};
