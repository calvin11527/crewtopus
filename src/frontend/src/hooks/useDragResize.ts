import { useCallback, useEffect, useRef } from 'react';

interface UseDragResizeOptions {
  axis: 'horizontal' | 'vertical';
  min: number;
  max: number;
  onResize: (size: number) => void;
  onCommit?: (size: number) => void;
}

/** Pointer-driven resize handle. Right drawer: drag handle left → wider panel. */
export function useDragResize({ axis, min, max, onResize, onCommit }: UseDragResizeOptions) {
  const session = useRef<{ startPos: number; startSize: number } | null>(null);
  const lastSize = useRef(0);

  const clamp = useCallback((size: number) => Math.min(max, Math.max(min, size)), [min, max]);

  const endSession = useCallback(() => {
    if (session.current) {
      onCommit?.(lastSize.current);
    }
    session.current = null;
  }, [onCommit]);

  useEffect(() => {
    const onPointerUp = () => endSession();
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, [endSession]);

  const startDrag = useCallback(
    (event: React.PointerEvent, currentSize: number) => {
      event.preventDefault();
      event.stopPropagation();
      session.current = {
        startPos: axis === 'horizontal' ? event.clientX : event.clientY,
        startSize: currentSize,
      };
      lastSize.current = currentSize;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [axis]
  );

  const onDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!session.current) return;
      const pos = axis === 'horizontal' ? event.clientX : event.clientY;
      const delta = pos - session.current.startPos;
      const size =
        axis === 'horizontal'
          ? clamp(session.current.startSize + (session.current.startPos - pos))
          : clamp(session.current.startSize + delta);
      lastSize.current = size;
      onResize(size);
    },
    [axis, clamp, onResize]
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!session.current) return;
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      endSession();
    },
    [endSession]
  );

  return { startDrag, onDrag, endDrag };
}