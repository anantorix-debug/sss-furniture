'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A hover-triggered preview box that always stays on screen, regardless of
// where its trigger sits in a scrollable list - a plain CSS group-hover
// popup (position:absolute, always opening one fixed direction) clips off
// the top of the viewport for a row near the top of a table and off the
// bottom for a row near the bottom, since it can only ever open one way.
// This computes real available space above/below the trigger on hover and
// portals the content into document.body with position:fixed, same
// "escape any scrollable/overflow ancestor" approach as ModelNoPicker.
export function HoverPreview({
  trigger,
  children,
  triggerClassName,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    // Prefer opening downward (the natural reading direction) unless there's
    // meaningfully more room above than below.
    if (spaceBelow < 300 && spaceAbove > spaceBelow) {
      setPos({ bottom: window.innerHeight - r.top + 4, left: r.left });
    } else {
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(true);
  }

  // A short delay before closing lets the pointer travel from the trigger
  // into the portalled popup itself (they're not DOM siblings, so a plain
  // mouseleave on the trigger alone would close it before the pointer ever
  // reaches content the user is moving toward).
  function scheduleHide() {
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  }

  return (
    <div className={triggerClassName} ref={ref} onMouseEnter={show} onMouseLeave={scheduleHide}>
      {trigger}
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed z-50" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }} onMouseEnter={show} onMouseLeave={scheduleHide}>
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
