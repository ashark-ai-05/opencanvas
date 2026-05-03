import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { getLatestSnapshot } from '../state/snapshot-ref';

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/v1/chat',
      body: () => ({ canvasSnapshot: getLatestSnapshot() }),
    }),
  });
  const [input, setInput] = useState('');
  const isStreaming = status === 'streaming';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-500 mt-12">
            <p className="text-lg">llm-wiki</p>
            <p className="text-sm">Type a message to start.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              {m.role}
            </div>
            <div className="whitespace-pre-wrap text-zinc-100">
              {m.parts
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map((p, i) => <span key={i}>{p.text}</span>)}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800 p-4 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          disabled={isStreaming}
          className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-50 disabled:hover:bg-zinc-800 transition-colors"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
