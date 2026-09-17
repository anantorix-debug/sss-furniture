import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcode = require('qrcode');

type WhatsAppState =
  | 'DISCONNECTED'
  | 'INITIALIZING'
  | 'QR_REQUIRED'
  | 'AUTHENTICATING'
  | 'AUTHENTICATED'
  | 'READY'
  | 'LOADING_SCREEN'
  | 'RECONNECTING'
  | 'ERROR';

interface WhatsAppStatus {
  state: WhatsAppState;
  authenticated: boolean;
  ready: boolean;
  storesReady: boolean;
  operational?: boolean;
  qr?: string;
  error?: string;
}

@Injectable()
export class WhatsappClientWrapper implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappClientWrapper.name);
  private client: any;
  private latestQr: string | null = null;
  private state: WhatsAppState = 'DISCONNECTED';
  private authenticated = false;
  private ready = false;
  private storesReady = false;
  private initialized = false;
  private lastError: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private lidToPhoneJidCache = new Map<string, string>();
  private readonly sendTimeoutMs: number;
  private readonly lidResolutionTimeoutMs: number;
  // Belt-and-suspenders against any future cause of client.initialize()
  // never emitting anything (a bad Puppeteer arg, a wedged Chromium launch,
  // a network stall loading web.whatsapp.com, ...) - self-heals by forcing
  // a restart instead of sitting in INITIALIZING forever with no way to
  // recover short of a manual PM2/container restart.
  private initWatchdog: NodeJS.Timeout | null = null;
  private static readonly INIT_TIMEOUT_MS = 90_000;

  constructor(private config: ConfigService) {
    this.sendTimeoutMs = Number(this.config.get('WHATSAPP_SEND_TIMEOUT_MS') ?? 30000);
    this.lidResolutionTimeoutMs = Number(this.config.get('WHATSAPP_LID_RESOLUTION_TIMEOUT_MS') ?? 8000);
    this.logger.log(`WhatsApp timeouts: send=${this.sendTimeoutMs}ms, lid-resolution=${this.lidResolutionTimeoutMs}ms`);
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    if (this.config.get<string>('WHATSAPP_ENABLED') === 'false') {
      this.logger.warn('[WhatsApp] Integration disabled via WHATSAPP_ENABLED=false');
      this.state = 'DISCONNECTED';
      return;
    }

    this.startClient();
  }

  // Tears down the current client (if any) and builds a fresh one after a
  // short delay. Used both for unexpected disconnects and for a deliberate
  // logout — either way we want the app to land back on a scannable QR
  // code on its own, without requiring a server restart.
  private restarting = false;

  private async restartClient(delayMs = 3000) {
    if (this.restarting) return;
    this.restarting = true;

    this.setState('RECONNECTING');
    this.authenticated = false;
    this.ready = false;
    this.storesReady = false;
    this.latestQr = null;

    if (this.client) {
      try {
        await Promise.race([
          this.client.destroy(),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch (err) {
        this.logger.warn(`[WhatsApp] Error destroying old client (ignored): ${err}`);
      }
      this.client = null;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    this.restarting = false;
    this.startClient();
  }

  private startClient() {
    this.setState('INITIALIZING');
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    if (this.initWatchdog) clearTimeout(this.initWatchdog);
    this.initWatchdog = setTimeout(() => {
      if (this.state === 'INITIALIZING') {
        this.logger.error(
          `[WhatsApp] Stuck in INITIALIZING for ${WhatsappClientWrapper.INIT_TIMEOUT_MS}ms - forcing a restart`,
        );
        this.restartClient();
      }
    }, WhatsappClientWrapper.INIT_TIMEOUT_MS);

    const authPath = this.config.get<string>('WWEBJS_AUTH_PATH') ?? '.wwebjs_auth';
    const chromePath = this.config.get<string>('PUPPETEER_EXECUTABLE_PATH');

    this.logger.log(`[WhatsApp] Initializing client`);
    this.logger.log(`[WhatsApp] Auth path: ${authPath}`);
    this.logger.log(`[WhatsApp] Chrome path: ${chromePath || '(default/bundled Chromium)'}`);

    this.client = new Client({
      // LocalAuth owns the Chrome profile directory (under authPath) - it
      // must be the only thing setting --user-data-dir. A previous
      // hardcoded `--user-data-dir=/app/data/whatsapp-session` here (a
      // leftover Docker WORKDIR path that doesn't exist outside that
      // container) silently won as Chromium's last-flag-wins, splitting
      // session data across two directories and leaving init stuck forever
      // outside Docker, since the profile LocalAuth thought it managed was
      // never the one Chromium actually used.
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled',
          '--disable-sync',
          '--metrics-recording-only',
          '--remote-debugging-port=9222',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-component-extensions-with-background-pages',
          '--disable-component-update',
          '--disable-default-apps-backup',
        ],
        executablePath: chromePath || undefined,
      },
    });

    // QR Code event - authentication required (only when truly needed)
    this.client.on('qr', async (qr: string) => {
      this.logger.log('[WhatsApp] QR code received - authentication required');
      this.setState('QR_REQUIRED');
      this.authenticated = false;
      this.ready = false;
      try {
        this.latestQr = await qrcode.toDataURL(qr);
        this.logger.log('[WhatsApp] QR code generated');
      } catch (err) {
        this.logger.error(`[WhatsApp] Failed to generate QR code: ${err}`);
      }
    });

    // Loading screen event - page is initializing
    this.client.on('loading_screen', (percent: number, message: string) => {
      this.logger.debug(`[WhatsApp] Loading: ${percent}% - ${message}`);
      if (this.state === 'INITIALIZING' || this.state === 'RECONNECTING') {
        this.setState('LOADING_SCREEN');
      }
    });

    // Authenticated event - session valid, stores still loading
    this.client.on('authenticated', () => {
      this.logger.log('[WhatsApp] Authenticated - session restored');
      this.authenticated = true;
      this.latestQr = null;
      // Stay in LOADING_SCREEN until ready event
      if (this.state !== 'LOADING_SCREEN') {
        this.setState('LOADING_SCREEN');
      }
    });

    // Ready event - fully initialized and operational
    this.client.on('ready', () => {
      this.logger.log('[WhatsApp] Ready - client fully initialized');
      this.setState('READY');
      this.ready = true;
      this.authenticated = true;
      this.latestQr = null;
      this.lastError = null;
      if (this.readyResolve) {
        this.readyResolve();
        this.readyResolve = null;
      }
    });

    // Disconnected event - connection lost (phone unlinked, network drop, or
    // a deliberate logout() call). Auto-recover so a fresh QR shows up on
    // its own instead of leaving the app stuck until someone restarts it.
    this.client.on('disconnected', (reason: string) => {
      this.logger.warn(`[WhatsApp] Disconnected: ${reason}`);
      this.setState('DISCONNECTED');
      this.ready = false;
      this.latestQr = null;
      this.lastError = `Disconnected: ${reason}`;
      this.restartClient();
    });

    // Auth failure event - session invalid. Same recovery: tear down and
    // rebuild so a new QR is generated instead of dead-ending in ERROR.
    this.client.on('auth_failure', (msg: string) => {
      this.logger.error(`[WhatsApp] Auth failure: ${msg}`);
      this.setState('ERROR');
      this.authenticated = false;
      this.ready = false;
      this.lastError = msg;
      this.restartClient();
    });

    // Error event - unexpected error
    this.client.on('error', (err: any) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WhatsApp] Error: ${errorMsg}`);
      this.setState('ERROR');
      this.lastError = errorMsg;
    });

    // Initialize the client
    this.client.initialize().catch((err: Error) => {
      const errorMsg = err.message || 'Unknown initialization error';
      this.logger.error(`[WhatsApp] Initialization failed: ${errorMsg}`);
      this.setState('ERROR');
      this.lastError = errorMsg;
    });
  }

  private setState(newState: WhatsAppState) {
    if (this.state !== newState) {
      this.logger.log(`[STATE] ${this.state} → ${newState}`);
      this.state = newState;
    }
    // Any forward progress out of INITIALIZING means client.initialize()
    // is actually alive - disarm the watchdog. It only fires again once
    // startClient() re-arms it (a fresh init or a restart).
    if (newState !== 'INITIALIZING' && this.initWatchdog) {
      clearTimeout(this.initWatchdog);
      this.initWatchdog = null;
    }
  }

  async waitForReady(timeoutMs = 60000): Promise<void> {
    if (this.state === 'READY') {
      return;
    }

    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });
    }

    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout waiting for ready state after ${timeoutMs}ms. Current state: ${this.state}`)), timeoutMs)
    );

    try {
      await Promise.race([this.readyPromise, timeoutPromise]);
    } catch (err) {
      this.logger.error(`[READY] Timeout or error: ${err}`);
      throw err;
    }
  }

  getStatus(): WhatsAppStatus {
    const operational = this.isOperational();
    return {
      state: this.state,
      authenticated: this.authenticated,
      ready: this.ready,
      storesReady: this.storesReady,
      operational,
      qr: this.state === 'QR_REQUIRED' ? this.latestQr ?? undefined : undefined,
      error: this.lastError ?? undefined,
    };
  }

  isReady(): boolean {
    return this.state === 'READY' && this.ready;
  }

  isOperational(): boolean {
    if (!this.client) return false;
    // If authenticated, allow chat retrieval attempt even during LOADING_SCREEN
    // The stores might be accessible even if not fully initialized
    if (this.authenticated) return true;
    return false;
  }

  async resolveChatIdForSending(chatId: string): Promise<string> {
    // Groups and normal @c.us chats don't need resolution
    if (chatId.endsWith('@g.us') || chatId.endsWith('@c.us')) {
      return chatId;
    }

    // @lid chats need to be resolved to phone JID
    if (chatId.endsWith('@lid')) {
      this.logger.log(`[WHATSAPP LID] Input: ${chatId}`);

      // Check cache first
      if (this.lidToPhoneJidCache.has(chatId)) {
        const cachedJid = this.lidToPhoneJidCache.get(chatId)!;
        this.logger.log(`[WHATSAPP LID] Using cached phone JID: ${cachedJid}`);
        return cachedJid;
      }

      // Extract LID number from chatId (e.g., "13447576182793" from "13447576182793@lid")
      const lidNumber = chatId.replace('@lid', '');
      const methodResults: string[] = [];

      // METHOD 1: Use getContactLidAndPhone API
      try {
        this.logger.log(`[WHATSAPP LID] Method 1: getContactLidAndPhone`);
        const results = await this.client.getContactLidAndPhone([lidNumber]);

        if (results && results.length > 0) {
          const { pn } = results[0]; // pn is the phone number
          if (pn) {
            const phoneJid = `${pn}@c.us`;
            this.logger.log(`[WHATSAPP LID] Method 1 result: RESOLVED to ${phoneJid}`);
            this.lidToPhoneJidCache.set(chatId, phoneJid);
            this.logger.log(`[WHATSAPP LID] RESOLVED: ${chatId} → ${phoneJid}`);
            return phoneJid;
          }
        }
        methodResults.push('Method 1: No result or empty pn');
        this.logger.log(`[WHATSAPP LID] Method 1 result: ${methodResults[methodResults.length - 1]}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        methodResults.push(`Method 1 failed: ${errMsg}`);
        this.logger.warn(`[WHATSAPP LID] Method 1 failed: ${errMsg}`);
      }

      // METHOD 2: Try to get contact by ID and extract phone from model
      try {
        this.logger.log(`[WHATSAPP LID] Method 2: getContactById`);
        const contact = await this.client.getContactById(chatId);

        if (contact && contact.id) {
          // Check various phone-related properties on contact model
          const phoneNumber = contact.id?.user || contact.id?._serialized?.split('@')[0] || contact.phoneNumber || null;
          if (phoneNumber && !phoneNumber.includes('@')) {
            const phoneJid = `${phoneNumber}@c.us`;
            this.logger.log(`[WHATSAPP LID] Method 2 result: RESOLVED to ${phoneJid}`);
            this.lidToPhoneJidCache.set(chatId, phoneJid);
            this.logger.log(`[WHATSAPP LID] RESOLVED: ${chatId} → ${phoneJid}`);
            return phoneJid;
          }
        }
        methodResults.push('Method 2: No valid phone found');
        this.logger.log(`[WHATSAPP LID] Method 2 result: ${methodResults[methodResults.length - 1]}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        methodResults.push(`Method 2 failed: ${errMsg}`);
        this.logger.warn(`[WHATSAPP LID] Method 2 failed: ${errMsg}`);
      }

      // METHOD 3: Try accessing the Chat store directly
      try {
        this.logger.log(`[WHATSAPP LID] Method 3: Direct Chat store access`);
        const phoneJid = await this.client.pupPage.evaluate(async (lid: string) => {
          try {
            const WAWebCollections = window.require('WAWebCollections');
            const ChatStore = WAWebCollections?.Chat;

            if (!ChatStore) return null;

            // Try to get models and find the LID chat
            const models = ChatStore.getModelsArray?.();
            if (!Array.isArray(models)) return null;

            for (const chat of models) {
              const chatId = chat?.id?._serialized || chat?.id;
              if (chatId === `${lid}@lid`) {
                // Check for phone mapping in chat model
                if (chat?.contact?.id?.user) {
                  return `${chat.contact.id.user}@c.us`;
                }
                if (chat?.contact?.id?._serialized) {
                  const parts = chat.contact.id._serialized.split('@');
                  if (parts[1] === 'c.us') return chat.contact.id._serialized;
                }
                if (chat?.phoneNumber) {
                  return `${chat.phoneNumber}@c.us`;
                }
              }
            }
            return null;
          } catch {
            return null;
          }
        }, lidNumber);

        if (phoneJid) {
          this.logger.log(`[WHATSAPP LID] Method 3 result: RESOLVED to ${phoneJid}`);
          this.lidToPhoneJidCache.set(chatId, phoneJid);
          this.logger.log(`[WHATSAPP LID] RESOLVED: ${chatId} → ${phoneJid}`);
          return phoneJid;
        }
        methodResults.push('Method 3: Chat store has no phone mapping');
        this.logger.log(`[WHATSAPP LID] Method 3 result: ${methodResults[methodResults.length - 1]}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        methodResults.push(`Method 3 failed: ${errMsg}`);
        this.logger.warn(`[WHATSAPP LID] Method 3 failed: ${errMsg}`);
      }

      // METHOD 4: Try accessing Contact store for phone mapping
      try {
        this.logger.log(`[WHATSAPP LID] Method 4: Direct Contact store access`);
        const phoneJid = await this.client.pupPage.evaluate(async (lid: string) => {
          try {
            const WAWebCollections = window.require('WAWebCollections');
            const ContactStore = WAWebCollections?.Contact;

            if (!ContactStore) return null;

            // Try to find contact with this LID
            const models = ContactStore.getModelsArray?.();
            if (!Array.isArray(models)) return null;

            for (const contact of models) {
              const contactId = contact?.id?._serialized || contact?.id;
              if (contactId?.includes(lid) || contactId === `${lid}@lid`) {
                if (contact?.phoneNumber) {
                  return `${contact.phoneNumber}@c.us`;
                }
                if (contact?.id?.user) {
                  return `${contact.id.user}@c.us`;
                }
              }
            }
            return null;
          } catch {
            return null;
          }
        }, lidNumber);

        if (phoneJid) {
          this.logger.log(`[WHATSAPP LID] Method 4 result: RESOLVED to ${phoneJid}`);
          this.lidToPhoneJidCache.set(chatId, phoneJid);
          this.logger.log(`[WHATSAPP LID] RESOLVED: ${chatId} → ${phoneJid}`);
          return phoneJid;
        }
        methodResults.push('Method 4: Contact store has no mapping');
        this.logger.log(`[WHATSAPP LID] Method 4 result: ${methodResults[methodResults.length - 1]}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        methodResults.push(`Method 4 failed: ${errMsg}`);
        this.logger.warn(`[WHATSAPP LID] Method 4 failed: ${errMsg}`);
      }

      // All methods failed
      this.logger.error(`[WHATSAPP LID] ALL METHODS FAILED for ${chatId}:`);
      methodResults.forEach((msg) => this.logger.error(`[WHATSAPP LID]   ${msg}`));

      throw new Error(`This WhatsApp contact uses a LID and could not be resolved. Open the conversation in WhatsApp Web first and retry. (${chatId})`);
    }

    // Unknown format
    throw new Error(`Unknown chat ID format: ${chatId}`);
  }

  private async areStoresReady(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const storesReady = await this.client.pupPage.evaluate(async () => {
        try {
          const WAWebCollections = window.require('WAWebCollections');
          const ChatStore = WAWebCollections?.Chat;
          const MsgStore = WAWebCollections?.Msg;
          if (!ChatStore || !MsgStore) return false;

          // Check that getModelsArray exists and is callable
          if (typeof ChatStore.getModelsArray !== 'function') return false;

          // Try to actually call getModelsArray to ensure it works
          const chats = ChatStore.getModelsArray();
          if (!Array.isArray(chats)) return false;

          // If no chats, that's OK - just means empty chat list
          // If chats exist, verify the first one has expected structure
          if (chats.length > 0) {
            const firstChat = chats[0];
            if (!firstChat || typeof firstChat !== 'object') return false;
            // Check for at least one expected method/property
            if (typeof firstChat.serialize !== 'function') return false;
          }

          return true;
        } catch (err) {
          return false;
        }
      });
      return storesReady;
    } catch {
      return false;
    }
  }

  async resolveChatId(chatId: string): Promise<string> {
    const id = chatId.trim();

    if (id.endsWith('@g.us')) {
      return id;
    }

    if (id.endsWith('@c.us')) {
      return id;
    }

    if (id.endsWith('@lid')) {
      return await this.resolveChatIdForSending(id);
    }

    // Support raw phone numbers (normalize to @c.us format)
    if (/^\d+$/.test(id)) {
      const normalized = `${id}@c.us`;
      this.logger.log(`[WA SEND] Normalized raw phone to: ${normalized}`);
      return normalized;
    }

    throw new Error(`Unsupported WhatsApp chat ID format: ${id}`);
  }

  // Shared by sendToChat (text) and sendMediaToChat (media) - resolves
  // whatever chat ID shape the frontend hands over (@g.us group, @c.us
  // contact, raw phone digits, or an @lid that needs async resolution) down
  // to the one WhatsApp will actually accept as a sendMessage target.
  private async resolveIncomingChatId(chatId: string): Promise<string> {
    const incomingChatId = chatId.trim();
    this.logger.log(`[WA SEND] Incoming chat ID: ${incomingChatId}`);

    if (incomingChatId.endsWith('@g.us')) {
      this.logger.log(`[WA SEND] Detected chat type: GROUP`);
      return incomingChatId;
    }
    if (incomingChatId.endsWith('@c.us')) {
      this.logger.log(`[WA SEND] Detected chat type: CONTACT`);
      const numberId = await this.client.getNumberId(incomingChatId).catch(() => null);
      if (!numberId) throw new Error(`Phone number is not registered on WhatsApp: ${incomingChatId}`);
      return numberId._serialized;
    }
    if (/^\d+$/.test(incomingChatId)) {
      this.logger.log(`[WA SEND] Normalizing raw phone: ${incomingChatId}`);
      const chatIdWithSuffix = `${incomingChatId}@c.us`;
      const numberId = await this.client.getNumberId(chatIdWithSuffix).catch(() => null);
      if (!numberId) throw new Error(`Phone number is not registered on WhatsApp: ${incomingChatId}`);
      this.logger.log(`[WA SEND] Normalized to: ${numberId._serialized}`);
      return numberId._serialized;
    }
    if (incomingChatId.endsWith('@lid')) {
      this.logger.log(`[WA SEND] Detected chat type: LID, resolving: ${incomingChatId}`);
      try {
        const resolvePromise = this.resolveChatIdForSending(incomingChatId);
        const resolveTimeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`LID resolution timeout after ${this.lidResolutionTimeoutMs}ms`)), this.lidResolutionTimeoutMs)
        );
        const resolved = await Promise.race([resolvePromise, resolveTimeoutPromise]);
        this.logger.log(`[WA SEND] LID resolved to: ${resolved}`);
        return resolved;
      } catch (resolveErr) {
        const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
        this.logger.error(`[WA SEND] LID resolution failed: ${msg}`);
        throw new Error(`Unable to resolve LID. ${msg}`);
      }
    }
    throw new Error(`Unsupported WhatsApp chat ID format: ${incomingChatId}`);
  }

  async sendToChat(chatId: string, message: string) {
    if (!this.isOperational()) {
      throw new Error(`WhatsApp client not operational. State: ${this.state}`);
    }
    if (!chatId || !message?.trim()) {
      throw new Error('chatId and message are required');
    }

    try {
      const resolvedChatId = await this.resolveIncomingChatId(chatId);

      this.logger.log(`[WA SEND] Sending message to: ${resolvedChatId}`);
      const sendPromise = this.client.sendMessage(resolvedChatId, message);
      const sendTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`SendMessage timeout after ${this.sendTimeoutMs}ms`)), this.sendTimeoutMs)
      );

      try {
        const result = await Promise.race([sendPromise, sendTimeoutPromise]);
        this.logger.log(`[WA SEND] Message sent successfully`);
        return result;
      } catch (sendErr) {
        const sendErrorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        this.logger.error(`[WA SEND] Send operation failed: ${sendErrorMsg}`);
        throw new Error(`Failed to send message: ${sendErrorMsg}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WA SEND] Final error: chatId=${chatId}, error=${errorMsg}`);
      throw err;
    }
  }

  // Media never touches disk: the caller (multer, memory storage - see
  // whatsapp.controller.ts) hands over the file as an in-memory Buffer, it's
  // base64-encoded straight into whatsapp-web.js's MessageMedia, and the
  // buffer is discarded once this call returns. Nothing is written under
  // apps/uploads or any other project storage path.
  async sendMediaToChat(chatId: string, buffer: Buffer, filename: string, mimetype: string, caption?: string) {
    if (!this.isOperational()) {
      throw new Error(`WhatsApp client not operational. State: ${this.state}`);
    }
    if (!chatId || !buffer?.length) {
      throw new Error('chatId and a file are required');
    }

    try {
      const resolvedChatId = await this.resolveIncomingChatId(chatId);
      const media = new MessageMedia(mimetype, buffer.toString('base64'), filename);

      this.logger.log(`[WA SEND] Sending media (${mimetype}, ${buffer.length} bytes) to: ${resolvedChatId}`);
      // Use chat.sendMessage instead of client.sendMessage to avoid the
      // "Data passed to getter must include an id property" error that
      // newer WhatsApp Web versions throw when client.sendMessage is used
      // with MessageMedia objects.
      const chat = await this.client.getChatById(resolvedChatId);
      const sendPromise = chat.sendMessage(media, caption ? { caption } : undefined);
      const sendTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`SendMessage timeout after ${this.sendTimeoutMs}ms`)), this.sendTimeoutMs)
      );

      try {
        const result = await Promise.race([sendPromise, sendTimeoutPromise]);
        this.logger.log(`[WA SEND] Media sent successfully`);
        return result;
      } catch (sendErr) {
        const sendErrorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        this.logger.error(`[WA SEND] Media send failed: ${sendErrorMsg}`);
        throw new Error(`Failed to send media: ${sendErrorMsg}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WA SEND] Final error: chatId=${chatId}, error=${errorMsg}`);
      throw err;
    }
  }

  async sendMessage(phone: string, message: string) {
    if (!this.isOperational()) {
      throw new Error(`WhatsApp client not operational. State: ${this.state}. ${this.lastError ? `Error: ${this.lastError}` : ''}`);
    }

    try {
      const chatId = `${phone}@c.us`;
      const numberId = await this.client.getNumberId(chatId).catch(() => null);
      if (!numberId) {
        throw new Error(`Phone number ${phone} is not registered on WhatsApp`);
      }
      await this.client.sendMessage(numberId._serialized, message);
    } catch (err) {
      this.logger.error(`Failed to send message: ${err}`);
      throw err;
    }
  }

  async sendGroupMessage(groupId: string, message: string) {
    if (!this.isOperational()) {
      throw new Error(`WhatsApp client not operational. State: ${this.state}. ${this.lastError ? `Error: ${this.lastError}` : ''}`);
    }

    try {
      const chatId = groupId.endsWith('@g.us') ? groupId : `${groupId}@g.us`;
      await this.client.sendMessage(chatId, message);
    } catch (err) {
      this.logger.error(`Failed to send group message: ${err}`);
      throw err;
    }
  }

  private async waitForStoresReady(timeoutMs = 15000): Promise<void> {
    const startTime = Date.now();
    let lastCheckTime = startTime;

    while (Date.now() - startTime < timeoutMs) {
      if (await this.areStoresReady()) {
        this.logger.log(`[CHATS] Internal stores (WAWebCollections) are ready`);
        this.storesReady = true;
        return;
      }

      const elapsed = Date.now() - startTime;
      if (Date.now() - lastCheckTime > 1000) {
        this.logger.debug(`[CHATS] Waiting for stores to be ready... ${elapsed}ms elapsed`);
        lastCheckTime = Date.now();
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    this.logger.warn(`[CHATS] Stores not fully ready after ${timeoutMs}ms, proceeding anyway`);
  }

  private async normalizeWhatsAppChat(chat: any): Promise<any> {
    if (!chat || !chat.id) return null;

    const chatId = chat.id?._serialized || chat.id || '';
    const isGroup = chatId.endsWith('@g.us') || chat.isGroup === true;
    const isLid = chatId.endsWith('@lid');

    // Use available name properties in order
    const displayName =
      chat.name ||
      chat.subject ||
      chat.formattedTitle ||
      (isGroup ? 'Group Chat' : 'WhatsApp Contact');

    // Try to resolve @lid chats for sending capability
    let canSend = !isLid; // Non-LID chats are sendable
    let phoneJid: string | null = null;

    if (isLid) {
      try {
        phoneJid = await this.resolveChatIdForSending(chatId);
        canSend = true;
      } catch (err) {
        canSend = false;
        this.logger.debug(`[CHATS] LID ${chatId} not resolvable yet`);
      }
    }

    return {
      id: chatId,
      name: displayName,
      isGroup,
      isLid,
      phoneJid,
      canSend,
      unread: chat.unreadCount || 0,
      timestamp: chat.timestamp || null,
      archived: !!chat.archived,
      pinned: !!chat.pinned,
      isReadOnly: !!(chat.groupMetadata?.announce || chat.isReadOnly),
    };
  }

  private async fetchChatsWithDiagnostics(): Promise<any[]> {
    this.logger.log(`[CHATS] Starting chat retrieval`);

    // STEP 1: Try official whatsapp-web.js API first. This call is known to
    // hang on some WhatsApp Web versions (see fetchChatsWithRetry comment
    // below) so it's bounded by a timeout instead of being awaited directly -
    // on timeout we fall through to the direct store-access fallback.
    try {
      this.logger.log(`[CHATS] Attempting official client.getChats() API`);
      const chats = await Promise.race([
        this.client.getChats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getChats() timed out after 6s')), 6000)),
      ]) as any[];

      if (Array.isArray(chats) && chats.length > 0) {
        const normalized = (await Promise.all(chats.map((c: any) => this.normalizeWhatsAppChat(c)))).filter(Boolean);
        this.logger.log(`[CHATS] getChats() success: ${normalized.length} chats`);
        this.logger.log(`[CHATS] Groups: ${normalized.filter((c: any) => c.isGroup).length}, Individual: ${normalized.filter((c: any) => !c.isGroup && !c.isLid).length}, LID: ${normalized.filter((c: any) => c.isLid).length}`);
        return normalized;
      }
    } catch (apiErr) {
      this.logger.warn(`[CHATS] getChats() failed, attempting fallback: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`);
    }

    // STEP 2: Safe fallback - check for existence before accessing. Also
    // timeout-bounded: an unresponsive page would otherwise hang this
    // evaluate() call (and the HTTP request behind it) forever.
    try {
      this.logger.log(`[CHATS] Attempting safe fallback using browser context`);
      const chatsFromFallback = await Promise.race([
        this.client.pupPage.evaluate(async () => {
        try {
          const w = window as any;

          // Safely check for WAWebCollections
          const require = w.require;
          if (typeof require !== 'function') {
            throw new Error('window.require not available');
          }

          let WAWebCollections: any;
          try {
            WAWebCollections = require('WAWebCollections');
          } catch {
            throw new Error('WAWebCollections not found');
          }

          // Safely check for Chat
          if (!WAWebCollections || typeof WAWebCollections !== 'object') {
            throw new Error('WAWebCollections is not an object');
          }

          const ChatStore = WAWebCollections.Chat;
          if (!ChatStore || typeof ChatStore !== 'object') {
            throw new Error('WAWebCollections.Chat not found or invalid');
          }

          // Safely get models array
          if (typeof ChatStore.getModelsArray !== 'function') {
            throw new Error('ChatStore.getModelsArray is not a function');
          }

          const chatModels = ChatStore.getModelsArray();
          if (!Array.isArray(chatModels)) {
            throw new Error(`getModelsArray returned ${typeof chatModels}, expected array`);
          }

          // Map chats safely
          return chatModels.map((chat: any) => {
            if (!chat || !chat.id) return null;
            const chatId = chat.id?._serialized || chat.id || '';
            return {
              id: chatId,
              name: chat.name || chat.subject || chat.formattedTitle || 'WhatsApp Chat',
              isGroup: chatId.endsWith('@g.us') || chat.isGroup === true,
              isLid: chatId.endsWith('@lid'),
              phoneNumber: null,
              unread: chat.unreadCount || 0,
              timestamp: chat.timestamp || null,
              archived: !!chat.archived,
              pinned: !!chat.pinned,
              isReadOnly: !!(chat.groupMetadata?.announce),
            };
          }).filter((c: any) => c && c.id);
        } catch (fallbackErr: any) {
          throw new Error(`Fallback failed: ${fallbackErr?.message || String(fallbackErr)}`);
        }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('store fallback timed out after 10s')), 10000)),
      ]) as any[];

      if (Array.isArray(chatsFromFallback) && chatsFromFallback.length > 0) {
        this.logger.log(`[CHATS] Fallback success: ${chatsFromFallback.length} chats`);
        this.logger.log(`[CHATS] Groups: ${chatsFromFallback.filter((c: any) => c.isGroup).length}, Individual: ${chatsFromFallback.filter((c: any) => !c.isGroup && !c.isLid).length}, LID: ${chatsFromFallback.filter((c: any) => c.isLid).length}`);
        return chatsFromFallback;
      }
    } catch (fallbackErr) {
      this.logger.warn(`[CHATS] Fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
    }

    // STEP 3: Return empty array on complete failure
    this.logger.warn(`[CHATS] Unable to retrieve chats via any method, returning empty array`);
    return [];
  }

  private async fetchChatsWithRetry(): Promise<any[]> {
    // WORKAROUND: Retries don't help. The "r" error is from whatsapp-web.js 1.34.7's
    // getChatModel() calling groupMetadata.update() on current WhatsApp Web version.
    // Use direct store access instead (already implemented in fetchChatsWithDiagnostics).

    this.logger.log(`[CHATS] Preparing to fetch chats from direct store access...`);

    try {
      await this.waitForStoresReady(10000);
      this.logger.log(`[CHATS] Stores ready. Fetching chats directly...`);

      const chats = await this.fetchChatsWithDiagnostics();

      if (!Array.isArray(chats)) {
        throw new Error(`Expected array of chats, got ${typeof chats}`);
      }

      this.logger.log(`[CHATS] Successfully fetched ${chats.length} total chats from store`);
      return chats;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CHATS] Failed to fetch chats: ${errorMsg}`);
      throw err;
    }
  }

  async listGroups(): Promise<{ id: string; name: string }[]> {
    // Verify client exists
    if (!this.client) {
      throw new Error('WhatsApp client not initialized');
    }

    // Verify client is authenticated before attempting to fetch chats
    if (!this.authenticated) {
      const status = this.getStatus();
      throw new Error(
        `WhatsApp client not ready for chat operations. ` +
        `State: ${status.state}, ` +
        `Authenticated: ${status.authenticated}, ` +
        `Ready: ${status.ready}` +
        (status.error ? `. Error: ${status.error}` : '')
      );
    }

    try {
      const chats = await this.fetchChatsWithRetry();

      // Filter for group chats
      const groups = chats.filter((c: any) => c.isGroup === true);
      this.logger.log(`[CHATS] Found ${groups.length} group chats out of ${chats.length} total`);

      return groups
        .filter((c: any) => c.id && (c.name || c.subject)) // Ensure valid group data
        .map((c: any) => {
          const id = c.id?._serialized || c.id;
          const name = c.name || c.subject || 'Unknown Group';
          return { id, name };
        });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CHATS] Failed to fetch groups. ` +
        `Error: ${errorMsg}. ` +
        `Client state: ${this.state}`
      );
      throw new Error(`Failed to fetch groups: ${errorMsg}`);
    }
  }

  async getAllChats(): Promise<{ id: string; name: string; isGroup: boolean; unread: number }[]> {
    if (!this.client || !this.authenticated) {
      throw new Error(`WhatsApp client not ready. State: ${this.state}`);
    }

    try {
      const chats = await this.fetchChatsWithRetry();
      return chats
        .filter((c: any) => c.id && (c.name || c.subject))
        .map((c: any) => {
          const id = c.id?._serialized || c.id;
          const name = c.name || c.subject || 'Unknown';
          const isGroup = id.endsWith('@g.us') || c.isGroup === true;
          return {
            id,
            name,
            isGroup,
            unread: c.unreadCount || 0,
          };
        });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CHATS] Failed to fetch all chats: ${errorMsg}`);
      throw err;
    }
  }

  async getGroupChats(): Promise<{ id: string; name: string; participants?: number }[]> {
    if (!this.client || !this.authenticated) {
      throw new Error(`WhatsApp client not ready. State: ${this.state}`);
    }

    try {
      const chats = await this.fetchChatsWithRetry();
      const groups = chats.filter((c: any) => c.isGroup === true);
      return groups
        .filter((c: any) => c.id && (c.name || c.subject))
        .map((c: any) => {
          const id = c.id?._serialized || c.id;
          const name = c.name || c.subject || 'Unknown Group';
          return {
            id,
            name,
            participants: c.participants?.length || 0,
          };
        });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CHATS] Failed to fetch group chats: ${errorMsg}`);
      throw err;
    }
  }

  async getPrivateChats(): Promise<any[]> {
    if (!this.client || !this.authenticated) {
      throw new Error(`WhatsApp client not ready. State: ${this.state}`);
    }

    try {
      const chats = await this.client.getChats();
      return chats.filter((c: any) => !c.isGroup);
    } catch (err) {
      this.logger.error(`Failed to get private chats: ${err}`);
      throw err;
    }
  }

  async sendDocument(phone: string, buffer: Buffer, filename: string, mimetype: string, caption?: string) {
    if (!this.isReady()) {
      throw new Error(`WhatsApp client not ready. State: ${this.state}`);
    }

    try {
      const chatId = `${phone}@c.us`;
      const numberId = await this.client.getNumberId(chatId).catch(() => null);
      if (!numberId) {
        throw new Error(`Phone number ${phone} is not registered on WhatsApp`);
      }
      const media = new MessageMedia(mimetype, buffer.toString('base64'), filename);
      // Use chat.sendMessage to avoid the "id property" memoization error
      const chat = await this.client.getChatById(numberId._serialized);
      await chat.sendMessage(media, caption ? { caption } : undefined);
    } catch (err) {
      this.logger.error(`Failed to send document: ${err}`);
      throw err;
    }
  }

  async logout() {
    this.logger.log('[WhatsApp] Logout initiated');
    this.setState('DISCONNECTED');

    if (this.client) {
      try {
        // client.logout() can hang if the browser page is unresponsive -
        // never let it block the request indefinitely.
        await Promise.race([
          this.client.logout(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('logout timeout')), 15000)),
        ]);
        this.logger.log('[WhatsApp] Logged out successfully');
      } catch (err) {
        this.logger.warn(`[WhatsApp] Logout call did not complete cleanly (continuing anyway): ${err}`);
      }
    }

    // Regardless of how the logout call went, always tear down and rebuild
    // the client so the user lands on a fresh, scannable QR code.
    this.restartClient(1500);
  }

  async onModuleDestroy() {
    this.logger.log('[WhatsApp] Shutdown: destroying client');
    if (this.client) {
      try {
        await this.client.destroy();
        this.logger.log('[WhatsApp] Client destroyed');
      } catch (err) {
        this.logger.error(`[WhatsApp] Destroy error: ${err}`);
      }
    }
    this.setState('DISCONNECTED');
    this.logger.log('[WhatsApp] Shutdown complete');
  }
}
