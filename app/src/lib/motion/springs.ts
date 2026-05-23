/**
 * Named spring presets — the single source of truth for motion physics.
 *
 * All surfaces (panels, palette, parallax) draw from these so the app
 * feels like one physical world. If you tune one preset, the whole
 * system updates.
 *
 * Calibration:
 *   soft   — drawer enter, card lift. Slow, organic, slight overshoot.
 *   firm   — palette open, parallax tilt. Default for most motion.
 *   snappy — button press, focus ring. Near-instant, no overshoot.
 */
export const spring = {
  soft:   { stiffness: 180, damping: 28, mass: 0.6 },
  firm:   { stiffness: 260, damping: 30, mass: 0.5 },
  snappy: { stiffness: 380, damping: 30, mass: 0.4 },
} as const;

export type SpringPreset = keyof typeof spring;
