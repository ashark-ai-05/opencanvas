import { TEMPLATES } from '../canvas/templates';
import { useTemplateStore } from '../state/template-store';

export function TemplatePicker() {
  const activeId = useTemplateStore((s) => s.activeTemplateId);
  const setActive = useTemplateStore((s) => s.setActiveTemplateId);

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 320, // sit to the left of SearchBar (which is at right: 12 with min-width 280 + padding)
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
        layout
      </span>
      <select
        value={activeId}
        onChange={(e) => setActive(e.target.value as typeof activeId)}
        aria-label="Canvas layout"
        style={{
          padding: '4px 10px',
          fontSize: 12,
          background: '#27272a',
          color: '#fafafa',
          border: '1px solid #3f3f46',
          borderRadius: 4,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
