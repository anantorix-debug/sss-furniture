'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import type { WhatsappChat } from '@/types';

interface WhatsappStatus {
  ready: boolean;
  state: string;
  authenticated: boolean;
  storesReady: boolean;
  operational?: boolean;
  qr?: string;
  error?: string;
}

function WhatsappSettingsContent() {
  const { data: status, isLoading: statusLoading, mutate: mutateStatus } = useSWR<WhatsappStatus>(
    '/whatsapp/status',
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const { data: chats, isLoading: chatsLoading, error: chatsError } = useSWR<WhatsappChat[]>(
    status?.operational ? '/whatsapp/chats' : null,
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChat, setSelectedChat] = useState<WhatsappChat | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const filteredChats = useMemo(() => {
    if (!chats) return [];
    if (!searchQuery.trim()) return chats;
    const query = searchQuery.toLowerCase();
    return chats.filter((chat) => chat.name.toLowerCase().includes(query));
  }, [chats, searchQuery]);

  async function handleLogout() {
    if (!confirm('Are you sure you want to disconnect WhatsApp?')) return;
    try {
      await api.post('/whatsapp/logout');
      mutateStatus();
      setSelectedChat(null);
      setMessageText('');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to logout');
    }
  }

  async function handleSendMessage() {
    if (!selectedChat || !messageText.trim()) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(false);

    try {
      const result = await api.post(`/whatsapp/send/${encodeURIComponent(selectedChat.id)}`, { message: messageText });
      setSendSuccess(true);
      setMessageText('');
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 0) {
          setSendError('Message status could not be confirmed. Check WhatsApp before retrying.');
        } else {
          setSendError(err.message);
        }
      } else {
        setSendError('Failed to send message');
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">WhatsApp Integration</h1>
        <p className="text-sm text-brand-500 mt-1">
          Connect your WhatsApp account and send messages to any chat. Notifications are rate-limited and single-recipient only.
        </p>
      </div>

      {/* Connection Status Card */}
      <div className="card p-6 text-center">
        {statusLoading && <p className="text-brand-400 text-sm">Checking connection...</p>}

        {!statusLoading && status?.operational && (
          <div className="space-y-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl">
              ✓
            </div>
            <p className="font-semibold text-emerald-700">Connected</p>
            <p className="text-sm text-brand-500">Your WhatsApp account is connected and ready to send messages.</p>
            <button className="btn-danger mt-2" onClick={handleLogout}>
              Disconnect WhatsApp
            </button>
          </div>
        )}

        {!statusLoading && !status?.operational && (
          <div className="space-y-3">
            <p className="font-semibold text-amber-700">Not connected</p>
            {status?.qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={status.qr} alt="WhatsApp QR code" className="mx-auto rounded-lg border border-brand-100" width={220} height={220} />
                <p className="text-sm text-brand-500">Scan with WhatsApp on your phone (Linked Devices → Link a Device)</p>
              </>
            ) : (
              <p className="text-sm text-brand-500">Waiting for QR code...</p>
            )}
            <button className="btn-secondary" onClick={() => mutateStatus()}>
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Chat Selection Panel - Only show when connected */}
      {!statusLoading && status?.operational && (
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-brand-900 mb-1">Send Message</h2>
            <p className="text-xs text-brand-500">
              Select a chat from your WhatsApp account and compose a message. {chats?.length ?? 0} chats available.
            </p>
          </div>

          {/* Search Box */}
          <input
            type="text"
            placeholder="Search chats by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input w-full"
          />

          {/* Chat List */}
          <div className="space-y-2">
            {chatsLoading && <p className="text-sm text-brand-400">Loading chats...</p>}
            {chatsError && (
              <p className="text-xs text-red-600">
                Error loading chats:{' '}
                {chatsError instanceof ApiError ? chatsError.message : String(chatsError)}
              </p>
            )}

            {!chatsLoading && filteredChats.length > 0 && (
              <div className="border border-brand-100 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                {filteredChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedChat(chat)}
                    className={`w-full px-4 py-3 text-left text-sm border-b border-brand-100 last:border-0 transition-colors ${
                      selectedChat?.id === chat.id
                        ? 'bg-blue-50 text-blue-900'
                        : 'hover:bg-brand-50 text-brand-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{chat.name}</p>
                          {chat.isLid && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded whitespace-nowrap">@lid</span>
                          )}
                          {chat.isGroup && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded whitespace-nowrap">Group</span>
                          )}
                        </div>
                        <p className="text-xs text-brand-500 mt-1">
                          {chat.phoneNumber && !chat.isGroup && (
                            <>
                              📱 {chat.phoneNumber}
                              {chat.unread > 0 && ` • ${chat.unread} unread`}
                            </>
                          )}
                          {!chat.phoneNumber && chat.unread > 0 && `${chat.unread} unread`}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!chatsLoading && filteredChats.length === 0 && chats && chats.length > 0 && (
              <p className="text-sm text-brand-500 text-center py-4">No chats match your search</p>
            )}
          </div>

          {/* Message Composer - Only show when chat is selected */}
          {selectedChat && (
            <div className="border-t border-brand-100 pt-4 space-y-3">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                <p className="text-sm font-medium text-brand-900 mb-1">Sending to:</p>
                <div className="flex items-center gap-2">
                  <span className="text-blue-600 font-semibold">{selectedChat.name}</span>
                  {selectedChat.isLid && (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">@lid</span>
                  )}
                  {selectedChat.isGroup && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">👥 Group</span>
                  )}
                </div>
                {selectedChat.phoneNumber && !selectedChat.isGroup && (
                  <p className="text-xs text-brand-600 mt-2">📱 {selectedChat.phoneNumber}</p>
                )}
              </div>

              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your message here..."
                rows={4}
                className="input w-full resize-none"
              />

              {sendError && <p className="text-xs text-red-600">{sendError}</p>}
              {sendSuccess && <p className="text-xs text-emerald-600">✓ Message sent successfully</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSelectedChat(null);
                    setMessageText('');
                  }}
                  className="btn-secondary flex-1"
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() || sending}
                  className="btn-primary flex-1"
                >
                  {sending ? 'Sending...' : 'Send Message'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Anti-spam Info */}
      <div className="card p-5 text-sm text-brand-600 space-y-1">
        <p className="font-semibold text-brand-800">Safety & Rate Limits</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Messages are sent one at a time with human-like delays</li>
          <li>Daily cap per recipient, hourly cap for the account</li>
          <li>Session is isolated — each WhatsApp account only sees its own chats</li>
        </ul>
      </div>
    </div>
  );
}

export default function WhatsappSettingsPage() {
  return (
    <RoleGate minRole="SUPERADMIN">
      <WhatsappSettingsContent />
    </RoleGate>
  );
}
