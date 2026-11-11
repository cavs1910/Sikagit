import { useEffect } from 'react';

// iOS keeps the layout viewport tall when its keyboard opens. Use the visible
// height for the shell and expanded editor so their scroll areas stay reachable.
export function useViewportHeight(mobile: boolean) {
  useEffect(() => {
    if (!mobile) return;
    const viewport = window.visualViewport;
    const update = () => document.documentElement.style.setProperty(
      '--app-viewport-height', `${viewport?.height ?? window.innerHeight}px`,
    );
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-viewport-height');
    };
  }, [mobile]);
}
