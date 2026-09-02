'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import type { WhatsappChat } from '@/types';
import { Modal } from './Modal';

interface WhatsAppModalProps {
  onClose: () => void;
  recipientInfo: {
    name: string;
    phone?: string;
  };
  onSuccess?: () => void;
  defaultMessage?: string;
}

export function WhatsAppModal({
  onClose,
  recipientInfo,
  onSuccess,
  defaultMessage = '',
}: WhatsAppModalProps) {
  const router = useRouter();
  const [selectedChat, setSelectedChat] = useState<WhatsappChat | null>(null);
  const [message, setMessage] = useState(defaultMessage);
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { data: status } = useSWR<{ operational: boolean; state: string }>(
    '/whatsapp/status',
    fetcher
  );

  const { data: chats } = useSWR<WhatsappChat[]>(
    status?.operational ? '/whatsapp/chats' : null,
    fetcher
  );

  useEffect(() => {
    setMessage(defaultMessage);
    setError(null);
    setSuccess(false);
  }, [defaultMessage]);

  const filteredChats = chats?.filter(
    (chat) =>
      chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  async function handleSend() {
    if (!selectedChat || !message.trim()) {
      setError('Please select a chat and enter a message');
      return;
    }

    setSending(true);
    setError(null);

    try {
      await api.post(`/whatsapp/send/${encodeURIComponent(selectedChat.id)}`, {
        message,
      });
      setSuccess(true);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Failed to send message'
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Send WhatsApp Message" onClose={onClose}>
      <div className="w-full max-w-2xl">
        <p className="text-sm text-brand-500 mb-4">
          To: <span className="font-semibold text-brand-900">{recipientInfo.name}</span>
          {recipientInfo.phone && <span className="text-brand-500"> ({recipientInfo.phone})</span>}
        </p>

        {!status?.operational ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-4 flex items-center justify-between">
            <span>⚠ WhatsApp is not connected. Connect it first.</span>
            <button
              onClick={() => {
                onClose();
                router.push('/settings/whatsapp');
              }}
              className="btn-primary text-xs px-3 py-1.5 ml-2 whitespace-nowrap"
            >
              Go to Settings
            </button>
          </div>
        ) : (
          <>
            {/* Chat Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-brand-900 mb-2">
                Select Chat or Group
              </label>
              <input
                type="text"
                placeholder="Search contacts or groups..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input w-full mb-2"
              />

              {filteredChats.length > 0 ? (
                <div className="border border-brand-200 rounded-lg max-h-48 overflow-y-auto">
                  {filteredChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => setSelectedChat(chat)}
                      className={`w-full px-4 py-3 text-left border-b border-brand-100 last:border-0 transition-colors ${
                        selectedChat?.id === chat.id
                          ? 'bg-blue-50 text-blue-900'
                          : 'hover:bg-brand-50 text-brand-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-medium">{chat.name}</p>
                          <p className="text-xs text-brand-500">
                            {chat.isGroup ? '👥 Group' : '👤 Contact'}
                            {chat.isLid && ' • @lid'}
                            {chat.unread > 0 && ` • ${chat.unread} unread`}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-brand-50 rounded-lg text-center text-sm text-brand-500">
                  {chats?.length === 0
                    ? 'No chats available'
                    : 'No chats match your search'}
                </div>
              )}
            </div>

            {/* Message Input */}
            {selectedChat && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-sm text-brand-900 font-medium mb-1">Sending to:</p>
                <div className="flex items-center gap-2">
                  <span className="text-blue-600 font-semibold">{selectedChat.name}</span>
                  {selectedChat.isGroup && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      👥 Group
                    </span>
                  )}
                  {selectedChat.isLid && (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                      @lid
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-brand-900 mb-2">
                Message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                className="input w-full resize-none"
              />
              <p className="text-xs text-brand-400 mt-1">{message.length} characters</p>
            </div>

            {/* Status Messages */}
            {error && <p className="text-xs text-red-600 mb-3">❌ {error}</p>}
            {success && (
              <p className="text-xs text-emerald-600 mb-3">✓ Message sent successfully!</p>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary" disabled={sending}>
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!selectedChat || !message.trim() || sending || !status?.operational}
            className="btn-primary"
          >
            {sending ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
