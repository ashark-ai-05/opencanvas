import { useEditor } from 'tldraw';

const SAMPLE_MARKDOWN = `# Auth architecture

JWT tokens issued by **auth-svc**. See [TICKET-101](#).

- Access token: 1h
- Refresh token: 30d
- JWKS cache: 24h

| field | type |
| --- | --- |
| sub | string |
| exp | number |
`.trim();

const SAMPLE_CODE = `export async function processPayment(
  order: Order,
  card: Card,
): Promise<PaymentResult> {
  const charge = await chargeService.charge(card, order.totalCents);
  if (!charge.ok) {
    return { ok: false, error: charge.error };
  }
  return { ok: true, paymentId: charge.id };
}
`.trim();

export function DebugToolbar() {
  const editor = useEditor();

  const create = (type: string, props: Record<string, unknown>) => {
    // Place the new shape near the camera centre.
    const camera = editor.getCamera();
    const viewport = editor.getViewportPageBounds();
    editor.createShape({
      type,
      x: viewport.x + 80,
      y: viewport.y + 80,
      props,
    });
    void camera; // Acknowledge unused — kept for future positioning logic
  };

  const buttons: Array<{ label: string; onClick: () => void }> = [
    {
      label: 'Markdown',
      onClick: () =>
        create('llm-wiki:markdown', {
          w: 360,
          h: 240,
          title: 'Auth architecture',
          body: SAMPLE_MARKDOWN,
          uri: 'demo://auth-architecture',
        }),
    },
    {
      label: 'Code',
      onClick: () =>
        create('llm-wiki:code-block', {
          w: 480,
          h: 280,
          language: 'typescript',
          symbolName: 'processPayment',
          filePath: 'src/payments/process.ts',
          body: SAMPLE_CODE,
          uri: 'file://src/payments/process.ts#processPayment',
        }),
    },
    {
      label: 'Ticket',
      onClick: () =>
        create('llm-wiki:ticket', {
          w: 320,
          h: 200,
          ticketId: 'TICKET-101',
          title: 'Add OAuth support to login flow',
          status: 'in-progress',
          assignee: 'alice',
          description: 'OAuth via Google + GitHub. Spec in auth-architecture.',
          uri: 'demo://TICKET-101',
        }),
    },
    {
      label: 'Web embed',
      onClick: () =>
        create('llm-wiki:web-embed', {
          w: 480,
          h: 360,
          url: 'https://example.com/',
          title: 'example.com',
        }),
    },
    {
      label: 'Key/value',
      onClick: () =>
        create('llm-wiki:key-value-card', {
          w: 320,
          h: 200,
          title: 'k8s deployment',
          pairs: [
            { key: 'name', value: 'auth-svc' },
            { key: 'replicas', value: '3' },
            { key: 'image', value: 'auth-svc:v1.2.3' },
            { key: 'ready', value: '3/3' },
          ],
          uri: 'k8s://default/auth-svc',
        }),
    },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: 12,
        zIndex: 200,
        display: 'flex',
        gap: 6,
        padding: 6,
        background: 'rgba(24, 24, 27, 0.95)',
        border: '1px solid #3f3f46',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{ fontSize: 11, color: '#71717a', alignSelf: 'center', padding: '0 6px' }}>
        debug
      </span>
      {buttons.map((b) => (
        <button
          key={b.label}
          onClick={b.onClick}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: '#27272a',
            color: '#fafafa',
            border: '1px solid #3f3f46',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
