import { useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';

interface UseWhatsAppOptions {
  recipientName: string;
  recipientPhone?: string;
  defaultMessage?: string;
  defaultImageUrl?: string;
  defaultImageUrls?: string[];
  // Backend route (e.g. `/customer-orders/:id/pdf`) the modal can fetch on
  // demand and attach as a file - lets the sender pick the chat/group first
  // instead of it going out automatically to the order's own phone number.
  pdfUrl?: string;
  pdfFilename?: string;
  autoAttachPdf?: boolean;
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
