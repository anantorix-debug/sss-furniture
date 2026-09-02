'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

const MENU_WIDTH = 192; // matches w-48
const ITEM_HEIGHT = 30;

export function ActionsMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibleItems = items.filter((i) => !i.hidden);

  // Rendered into document.body with position:fixed and coordinates taken
  // from the trigger button's actual screen position - immune to being
  // clipped by the table's horizontal-scroll container, unlike an
  // absolutely-positioned dropdown nested inside it.
  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    let left = rect.right - MENU_WIDTH;
    if (left < 8) left = 8;
    if (left + MENU_WIDTH > window.innerWidth - 8) left = window.innerWidth - MENU_WIDTH - 8;

    const menuHeight = visibleItems.length * ITEM_HEIGHT + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight && rect.top > menuHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;

    setPosition({ top, left });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    // Simplest robust fix for a portaled dropdown: close on scroll/resize
    // rather than continuously re-tracking the trigger's position.
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (visibleItems.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="h-7 px-2.5 rounded-[6px] border border-brand-200 bg-white text-xs text-ink-muted hover:bg-brand-50 inline-flex items-center gap-1 whitespace-nowrap"
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        Actions <span className="text-[9px]">▾</span>
      </button>
      {open &&
        position &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 w-48 rounded-[8px] border border-brand-200 bg-white shadow-lg py-1"
            style={{ top: position.top, left: position.left }}
          >
            {visibleItems.map((item, idx) => (
              <button
                key={idx}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-brand-50 ${item.danger ? 'text-red-600' : 'text-ink'}`}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
