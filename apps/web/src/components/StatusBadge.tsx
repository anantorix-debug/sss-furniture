import type { DeliveryStatus } from '@/types';

// Exact hex values from the Woodworks Saas Figma file's dot-chip pattern
// (Screen — Users & Access Management, node 1:19615).
export const CHIP_COLORS = {
  green: { dot: '#2e7d32', bg: '#e6f1e7', text: '#2e7d32' }, // Active / Delivered / Settled / Full
  darkGreen: { dot: '#1f5c45', bg: '#e9f0ed', text: '#1f5c45' }, // Super Admin
  blue: { dot: '#1565c0', bg: '#e5eef8', text: '#1565c0' }, // Admin / read-only
  gray: { dot: '#6b7280', bg: '#efeee9', text: '#6b7280' }, // Employee / no access
  red: { dot: '#b42318', bg: '#fbe9e7', text: '#b42318' }, // Inactive / Hidden / Due
  amber: { dot: '#8a6100', bg: '#fbf0d9', text: '#8a6100' }, // Configurable / Pending / Limited
} as const;

export type ChipColor = keyof typeof CHIP_COLORS;

export function Chip({ color, label }: { color: ChipColor; label: string }) {
  const c = CHIP_COLORS[color];
  return (
    <span
      className="inline-flex items-center gap-1.5 h-[23px] px-2.5 rounded-full text-[10px] font-medium tracking-[0.2px]"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.dot }} />
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  if (status === 'DELIVERED') return <Chip color="green" label="Delivered" />;
  if (status === 'OUT_FOR_DELIVERY') return <Chip color="blue" label="Out for Delivery" />;
  if (status === 'DELIVERY_FAILED') return <Chip color="red" label="Delivery Failed" />;
  if (status === 'CANCELLED') return <Chip color="red" label="Cancelled" />;
  return <Chip color="amber" label="Pending" />;
}

export function BalanceBadge({ amount }: { amount: number }) {
  if (amount <= 0) return <Chip color="green" label="Settled" />;
  return <Chip color="red" label="Due" />;
}
