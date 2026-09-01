'use client';

import { useAuth } from '@/context/AuthContext';

interface WhatsAppActionButtonProps {
  recipientName: string;
  recipientPhone?: string;
  onClick: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function WhatsAppActionButton({
  recipientName,
  recipientPhone,
  onClick,
  disabled,
  size = 'sm',
}: WhatsAppActionButtonProps) {
  const { hasRole } = useAuth();

  if (!hasRole('SUPERADMIN')) return null;

  const buttonClass = size === 'sm'
    ? 'px-3 py-1 text-xs'
    : 'px-4 py-2 text-sm';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={`Send WhatsApp to ${recipientName}${recipientPhone ? ` (${recipientPhone})` : ''}`}
      className={`${buttonClass} bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
    >
      💬 WhatsApp
    </button>
  );
}
