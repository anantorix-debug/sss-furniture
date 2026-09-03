'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, sendWhatsappMedia, WHATSAPP_MEDIA_MAX_BYTES } from '@/lib/api';
import type { WhatsappChat } from '@/types';
import { Modal } from './Modal';

// WhatsApp renders no HTML - these are its own native markdown wrappers, so
// this toolbar wraps the textarea's selection with the syntax WhatsApp
// itself will format on the recipient's end. Kept identical to the toolbar
// in settings/whatsapp/page.tsx so formatting behaves the same everywhere.
const FORMAT_BUTTONS: { label: string; wrap: string; title: string }[] = [
  { label: 'B', wrap: '*', title: 'Bold' },
  { label: 'I', wrap: '_', title: 'Italic' },
  { label: 'S', wrap: '~', title: 'Strikethrough' },
  { label: '</>', wrap: '```', title: 'Monospace' },
];

interface WhatsAppModalProps {
  onClose: () => void;
  recipientInfo: {
    name: string;
    phone?: string;
  };
  onSuccess?: () => void;
  defaultMessage?: string;
  // A path under /public (e.g. "/wa-template.jpeg") to auto-attach as the
  // outgoing media, for templated sends (order confirmation, payment
  // update) that always go out with the same branded header image. Still
  // removable/replaceable via the file picker like any other attachment.
  defaultImageUrl?: string;
}

export function WhatsAppModal({
  onClose,
  recipientInfo,
  onSuccess,
  defaultMessage = '',
  defaultImageUrl,
}: WhatsAppModalProps) {
  const router = useRouter();
  const [selectedChat, setSelectedChat] = useState<WhatsappChat | null>(null);
  const [message, setMessage] = useState(defaultMessage);
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyFormat(wrap: string) {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd) || 'text';
    const next = value.slice(0, selectionStart) + wrap + selected + wrap + value.slice(selectionEnd);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart + wrap.length, selectionStart + wrap.length + selected.length);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (file && file.size > WHATSAPP_MEDIA_MAX_BYTES) {
      setError('File must be 64 MB or less.');
      setMediaFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setMediaFile(file);
  }

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

  // Pre-fill the chat search with the recipient's known phone number so the
  // right contact is usually the only (or first) result, instead of making
  // the sender hunt through the full chat list every time.
  useEffect(() => {
    if (recipientInfo.phone) setSearchQuery(recipientInfo.phone);
  }, [recipientInfo.phone]);

  useEffect(() => {
    if (!defaultImageUrl) return;
    let cancelled = false;
    fetch(defaultImageUrl)
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return;
        const filename = defaultImageUrl.split('/').pop() || 'image.jpg';
        setMediaFile(new File([blob], filename, { type: blob.type || 'image/jpeg' }));
      })
      .catch(() => {
        // Non-fatal - sender can still attach a file manually.
      });
    return () => {
      cancelled = true;
    };
  }, [defaultImageUrl]);

  const filteredChats = chats?.filter(
    (chat) =>
      chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Not everyone the app needs to message is already a WhatsApp contact -
  // the backend accepts a raw phone number directly (it normalizes/resolves
  // it the same way it would an existing chat), so once the search box
  // holds something phone-shaped, offer sending to it directly instead of
  // dead-ending on "no chats match".
  const manualDigits = searchQuery.replace(/\D/g, '');
  const canSendManually = manualDigits.length >= 10;

  async function handleSend() {
    if (!selectedChat || (!message.trim() && !mediaFile)) {
      setError('Please select a chat and enter a message or attach a file');
      return;
    }

    setSending(true);
    setError(null);

    try {
      if (mediaFile) {
        const result = await sendWhatsappMedia(selectedChat.id, mediaFile, message.trim() || undefined);
        if (!result.sent) throw new ApiError(502, result.error || result.reason || 'Failed to send media', result);
      } else {
        await api.post(`/whatsapp/send/${encodeURIComponent(selectedChat.id)}`, {
          message,
        });
      }
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
                <div className="p-4 bg-brand-50 rounded-lg text-center text-sm text-brand-500 space-y-2">
                  <p>{chats?.length === 0 ? 'No chats available' : 'No chats match your search'}</p>
                  {canSendManually && (
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedChat({ id: manualDigits, name: searchQuery, isGroup: false, unread: 0, timestamp: null, phoneNumber: manualDigits })
                      }
                      className="btn-secondary text-xs"
                    >
                      Send to {searchQuery} directly (not in contacts)
                    </button>
                  )}
                </div>
              )}

              {/* Manually-entered number, not one of the fetched chats - still
                  shown as a selectable option so it isn't lost once chosen. */}
              {selectedChat && !chats?.some((c) => c.id === selectedChat.id) && (
                <div className="mt-2 p-3 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-900 flex items-center justify-between">
                  <span>Manually entered: {selectedChat.name}</span>
                  <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setSelectedChat(null)}>
                    Change
                  </button>
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
              <div className="flex gap-1 border border-brand-100 rounded-t-lg border-b-0 bg-brand-50 px-2 py-1">
                {FORMAT_BUTTONS.map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    title={btn.title}
                    onClick={() => applyFormat(btn.wrap)}
                    className="px-2 py-1 text-xs font-semibold rounded hover:bg-brand-100 text-brand-700"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={mediaFile ? 'Add a caption (optional)...' : 'Type your message...'}
                rows={4}
                className="input w-full resize-none rounded-t-none"
              />
              <p className="text-xs text-brand-400 mt-1">{message.length} characters</p>

              <div className="flex items-center gap-2 mt-2">
                <input ref={fileInputRef} type="file" onChange={handleFileChange} className="text-xs text-brand-600 flex-1" />
                {mediaFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setMediaFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-xs text-red-500 hover:underline whitespace-nowrap"
                  >
                    Remove file
                  </button>
                )}
              </div>
              {mediaFile && (
                <p className="text-xs text-brand-500 mt-1">
                  📎 {mediaFile.name} ({(mediaFile.size / 1024).toFixed(0)} KB) — sent directly, never stored on this server.
                </p>
              )}
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
            disabled={!selectedChat || (!message.trim() && !mediaFile) || sending || !status?.operational}
            className="btn-primary"
          >
            {sending ? 'Sending...' : mediaFile ? 'Send File' : 'Send Message'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
