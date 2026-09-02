import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guardrails that keep this integration strictly transactional (one
 * operational notification per event) and never usable as a bulk/marketing
 * blaster:
 *  - a single serialized queue (one message in flight at a time)
 *  - a randomized human-like delay between sends
 *  - a per-recipient daily cap
 *  - a service-wide hourly cap
 *  - a bounded queue depth (excess requests are rejected outright, never
 *    silently backlogged forever)
 *
 * Sending unsolicited or high-volume messages through an unofficial client
 * (whatsapp-web.js) risks the number being banned and violates WhatsApp's
 * Terms of Service. This queue is intended only for low-volume, 1:1,
 * user-triggered operational messages (e.g. "you were assigned a work
 * item"). For real bulk/marketing messaging, use the official WhatsApp
 * Business Cloud API with opted-in templates instead.
 */

export class WhatsappRateLimitError extends Error {}

export type WhatsappPayload =
  | { kind: 'text'; text: string }
  | { kind: 'document'; buffer: Buffer; filename: string; mimetype: string; caption?: string }
  | { kind: 'group-text'; groupId: string; text: string }
  | { kind: 'chat'; chatId: string; text: string }
  | { kind: 'chat-document'; chatId: string; buffer: Buffer; filename: string; mimetype: string; caption?: string };

interface QueueJob {
  phone: string;
  payload: WhatsappPayload;
  resolve: () => void;
  reject: (err: Error) => void;
  chatId?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class WhatsappQueue {
  private readonly logger = new Logger(WhatsappQueue.name);

  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxPerRecipientPerDay: number;
  private readonly maxPerHour: number;
  private readonly maxQueueDepth: number;

  private queue: QueueJob[] = [];
  private processing = false;
  private recipientHistory = new Map<string, number[]>();
  private hourlyHistory: number[] = [];

  private sendFn: ((phone: string, payload: WhatsappPayload, chatId?: string) => Promise<void>) | null = null;

  constructor(private config: ConfigService) {
    this.minDelayMs = Number(this.config.get('WHATSAPP_MIN_DELAY_MS') ?? 4000);
    this.maxDelayMs = Number(this.config.get('WHATSAPP_MAX_DELAY_MS') ?? 9000);
    this.maxPerRecipientPerDay = Number(this.config.get('WHATSAPP_MAX_PER_RECIPIENT_PER_DAY') ?? 5);
    this.maxPerHour = Number(this.config.get('WHATSAPP_MAX_PER_HOUR') ?? 30);
    this.maxQueueDepth = Number(this.config.get('WHATSAPP_MAX_QUEUE_DEPTH') ?? 50);
  }

  setSender(fn: (phone: string, payload: WhatsappPayload, chatId?: string) => Promise<void>) {
    this.sendFn = fn;
  }

  private pruneRecipient(phone: string): number[] {
    const now = Date.now();
    const history = (this.recipientHistory.get(phone) ?? []).filter((t) => now - t < DAY_MS);
    this.recipientHistory.set(phone, history);
    return history;
  }

  private pruneHourly(): number[] {
    const now = Date.now();
    this.hourlyHistory = this.hourlyHistory.filter((t) => now - t < HOUR_MS);
    return this.hourlyHistory;
  }

  private checkLimits(phone: string) {
    if (this.queue.length >= this.maxQueueDepth) {
      throw new WhatsappRateLimitError('Queue is full - too many messages pending. Try again later.');
    }
    if (this.pruneRecipient(phone).length >= this.maxPerRecipientPerDay) {
      throw new WhatsappRateLimitError(
        `Daily message limit reached for this recipient (${this.maxPerRecipientPerDay}/day). Refusing to avoid spam.`,
      );
    }
    if (this.pruneHourly().length >= this.maxPerHour) {
      throw new WhatsappRateLimitError(`Service-wide hourly limit reached (${this.maxPerHour}/hour). Try again later.`);
    }
  }

  enqueue(phone: string, payload: WhatsappPayload, chatId?: string): Promise<void> {
    this.checkLimits(phone);
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ phone, payload, resolve, reject, chatId });
      void this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        this.checkLimits(job.phone);
        if (!this.sendFn) throw new Error('WhatsApp client is not initialized yet');
        const payloadType = job.payload.kind;
        const target = job.chatId || job.phone;
        this.logger.debug(`[QUEUE] Processing ${payloadType} message to ${target}`);
        await this.sendFn(job.phone, job.payload, job.chatId);

        const now = Date.now();
        this.pruneRecipient(job.phone).push(now);
        this.pruneHourly().push(now);

        this.logger.log(`[QUEUE] Successfully sent ${payloadType} message to ${target}`);
        job.resolve();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[QUEUE] WhatsApp send failed for ${job.phone} (payload: ${job.payload.kind}): ${errorMsg}`);
        job.reject(err as Error);
      }

      if (this.queue.length > 0) {
        const delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.processing = false;
  }
}
