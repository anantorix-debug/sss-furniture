import { useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';

interface UseWhatsAppOptions {
  recipientName: string;
  recipientPhone?: string;
  defaultMessage?: string;
  defaultImageUrl?: string;
}

export function useWhatsApp() {
  const { hasRole } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [whatsappOptions, setWhatsappOptions] = useState<UseWhatsAppOptions | null>(null);

  const canUseWhatsApp = hasRole('SUPERADMIN');

  const openWhatsApp = useCallback(
    (options: UseWhatsAppOptions) => {
      if (!canUseWhatsApp) return;
      setWhatsappOptions(options);
      setShowModal(true);
    },
    [canUseWhatsApp]
  );

  const closeWhatsApp = useCallback(() => {
    setShowModal(false);
    setWhatsappOptions(null);
  }, []);

  return {
    canUseWhatsApp,
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  };
}
