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
        create('strata:markdown', {
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
        create('strata:code-block', {
          w: 480,
          h: 280,
          language: 'typescript',
          symbolName: 'processPayment',
          filePath: 'src/payments/process.ts',
          code: SAMPLE_CODE,
          uri: 'file://src/payments/process.ts#processPayment',
        }),
    },
    {
      label: 'Ticket',
      onClick: () =>
        create('strata:ticket', {
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
        create('strata:web-embed', {
          w: 480,
          h: 360,
          url: 'https://example.com/',
          title: 'example.com',
        }),
    },
    {
      label: 'Key/value',
      onClick: () =>
        create('strata:key-value-card', {
          w: 320,
          h: 200,
          title: 'k8s deployment',
          fields: [
            { key: 'name', value: 'auth-svc' },
            { key: 'replicas', value: '3' },
            { key: 'image', value: 'auth-svc:v1.2.3' },
            { key: 'ready', value: '3/3' },
          ],
          uri: 'k8s://default/auth-svc',
        }),
    },
  ];

  const clearAll = () => {
    const ids = editor
      .getCurrentPageShapes()
      .filter((s) => s.type.startsWith('strata:'))
      .map((s) => s.id);
    if (ids.length > 0) editor.deleteShapes(ids);
  };

  return (
    <div
      className="strata-glass"
      style={{
        position: 'absolute',
        top: 60,
        left: 12,
        zIndex: 200,
        display: 'flex',
        gap: 4,
        padding: 5,
        borderRadius: 10,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#71717a',
          alignSelf: 'center',
          padding: '0 8px',
        }}
      >
        debug
      </span>
      {buttons.map((b) => (
        <button
          key={b.label}
          onClick={b.onClick}
          className="strata-toolbar-btn"
          style={{
            padding: '5px 11px',
            fontSize: 12,
            fontWeight: 500,
            background: 'rgba(39, 39, 42, 0.6)',
            color: '#e4e4e7',
            border: '1px solid rgba(63, 63, 70, 0.5)',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 120ms ease, border-color 120ms ease, transform 120ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(63, 63, 70, 0.7)';
            e.currentTarget.style.borderColor = 'rgba(82, 82, 91, 0.8)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(39, 39, 42, 0.6)';
            e.currentTarget.style.borderColor = 'rgba(63, 63, 70, 0.5)';
          }}
        >
          {b.label}
        </button>
      ))}
      <span style={{ width: 1, background: 'rgba(63,63,70,0.5)', alignSelf: 'stretch', margin: '2px 4px' }} />
      <button
        onClick={clearAll}
        title="Remove all Strata widgets from the canvas"
        style={{
          padding: '5px 11px',
          fontSize: 12,
          fontWeight: 500,
          background: 'rgba(239, 68, 68, 0.08)',
          color: '#fca5a5',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'background 120ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
        }}
      >
        Clear all
      </button>
    </div>
  );
}
