import { useLayoutEffect, useReducer } from "react";

/**
 * Virtualized lists receive their scroll container through a ref owned by the
 * parent that renders the list, and React attaches that ref *after* the
 * children's layout effects. So the virtualizer's first setup pass resolves a
 * null scroll element and renders zero rows. It normally recovers on the next
 * render, but a list mounted from cache (react-query data still fresh) has no
 * further render, leaving the view blank until a hard reload. Re-rendering once
 * on mount lets the virtualizer bind to the now-attached element.
 */
export function useVirtualizerScrollBinding(): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Layout effect: the extra pass happens in the same commit, before paint.
  useLayoutEffect(rerender, []);
}
