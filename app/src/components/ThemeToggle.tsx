import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../state/theme-store';
import { HeaderIconButton } from './HeaderCanvasControls';

/**
 * Header button that flips the global theme. The icon shows what the
 * click WILL switch to (sun in dark mode = "click to go light"), which
 * is the convention every major editor uses.
 */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  return (
    <HeaderIconButton
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    >
      {theme === 'dark' ? (
        <Sun className="size-3.5" />
      ) : (
        <Moon className="size-3.5" />
      )}
    </HeaderIconButton>
  );
}
