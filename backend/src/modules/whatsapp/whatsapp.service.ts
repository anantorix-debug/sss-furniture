import { Injectable, Logger, OnModuleInit, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { WhatsappClientWrapper } from './whatsapp-client';
import { WhatsappQueue, WhatsappRateLimitError } from './whatsapp-queue';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerType } from '@prisma/client';

export interface WhatsappDocument {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  caption?: string;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`; // default to India country code
  if (digits.length > 10 && digits.length <= 15) return digits;
  return null;
}

export interface WorkAssignmentMessage {
  carpenterName: string;
  phone?: string | null;
  groupId?: string | null;
  productName: string;
  modelNo?: string | null;
  category?: string | null;
  size?: string | null;
  quantity: number;
  price: number;
  extra?: number;
  total: number;
  workDate: Date;
}

export interface WhatsappSendResult {
  sent: boolean;
  reason?: string;
  // Additive, backward-compatible: present only when a team group is
  // configured for the recipient's worker type and a group send was
  // attempted alongside the 1:1 message.
  group?: { sent: boolean; reason?: string };
}

export interface PurchaseOrderMessage {
  supplierName: string;
  phone: string;
  poNumber: string;
  orderDate: Date;
  expectedDate?: Date | null;
  items: { materialName: string; quantity: number; unit: string; unitPrice: number }[];
  totalValue: number;
  notes?: string | null;
}

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly client: WhatsappClientWrapper,
    private readonly queue: WhatsappQueue,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.client.init();
    this.queue.setSender(async (recipient, payload, chatId) => {
      if (payload.kind === 'text') return this.client.sendMessage(recipient, payload.text);
      if (payload.kind === 'document') {
        return this.client.sendDocument(recipient, payload.buffer, payload.filename, payload.mimetype, payload.caption);
      }
      if (payload.kind === 'chat') {
        return this.client.sendToChat(chatId || payload.chatId, payload.text);
      }
      return this.client.sendGroupMessage(payload.groupId, payload.text);
    });
  }

  private buildWorkAssignmentText(msg: WorkAssignmentMessage): string {
    const dateStr = msg.workDate.toLocaleDateString('en-IN');
    const lines = [
      `*New Work Assigned - SSS Company*`,
      ``,
      `Carpenter: ${msg.carpenterName}`,
      `Date: ${dateStr}`,
      `Product: ${msg.productName}`,
      msg.modelNo ? `Model No: ${msg.modelNo}` : null,
      msg.category ? `Category: ${msg.category}` : null,
      msg.size ? `Size: ${msg.size}` : null,
      `Quantity: ${msg.quantity}`,
      `Price: ₹${msg.price}`,
      msg.extra ? `Extra: ₹${msg.extra}` : null,
      `*Total: ₹${msg.total}*`,
      ``,
      `Please confirm receipt of this work order.`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  async sendWorkAssignment(msg: WorkAssignmentMessage): Promise<WhatsappSendResult> {
    const text = this.buildWorkAssignmentText(msg);
    const individual = msg.phone ? await this.send(msg.phone, text) : { sent: false, reason: 'no_phone' };
    const group = msg.groupId ? await this.sendToGroup(msg.groupId, text) : undefined;
    return { ...individual, group };
  }

  private buildPurchaseOrderText(msg: PurchaseOrderMessage): string {
    const dateStr = msg.orderDate.toLocaleDateString('en-IN');
    const lines = [
      `*Purchase Order - SSS Company*`,
      ``,
      `PO Number: ${msg.poNumber}`,
      `Supplier: ${msg.supplierName}`,
      `Order Date: ${dateStr}`,
      msg.expectedDate ? `Expected By: ${msg.expectedDate.toLocaleDateString('en-IN')}` : null,
      ``,
      `Items:`,
      ...msg.items.map((i) => `- ${i.materialName}: ${i.quantity} ${i.unit} x ₹${i.unitPrice}`),
      ``,
      `*Total: ₹${msg.totalValue}*`,
      msg.notes ? `Notes: ${msg.notes}` : null,
      ``,
      `This order has been approved. Please confirm and dispatch.`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  async sendPurchaseOrder(msg: PurchaseOrderMessage): Promise<WhatsappSendResult> {
    return this.send(msg.phone, this.buildPurchaseOrderText(msg));
  }

  async send(rawPhone: string, message: string): Promise<WhatsappSendResult> {
    return this.dispatch(rawPhone, { kind: 'text', text: message });
  }

  async sendDocument(rawPhone: string, doc: WhatsappDocument): Promise<WhatsappSendResult> {
    return this.dispatch(rawPhone, { kind: 'document', ...doc });
  }

  async sendToGroup(groupId: string, message: string): Promise<WhatsappSendResult> {
    try {
      await this.queue.enqueue(groupId, { kind: 'group-text', groupId, text: message });
      return { sent: true };
    } catch (err) {
      if (err instanceof WhatsappRateLimitError) {
        this.logger.warn(`WhatsApp group send throttled for ${groupId}: ${err.message}`);
        return { sent: false, reason: 'rate_limited' };
      }
      this.logger.error(`Failed to send WhatsApp group message: ${(err as Error).message}`);
      return { sent: false, reason: 'send_failed' };
    }
  }

  // --- Team group settings (per worker type) --------------------------------

  async listChats() {
    const status = this.client.getStatus();
    this.logger.log(
      `[WHATSAPP CHATS] state=${status.state} authenticated=${status.authenticated} ` +
      `ready=${status.ready} storesReady=${status.storesReady} operational=${status.operational}`
    );

    if (!status.operational) {
      this.logger.warn(
        `Cannot list chats - WhatsApp not operational. ` +
        `State: ${status.state}, Authenticated: ${status.authenticated}, Operational: ${status.operational}`
      );
      throw new ServiceUnavailableException(
        `WhatsApp client not ready for operations. Current state: ${status.state}. ` +
        (status.error ? `Error: ${status.error}` : 'Please scan QR code and wait for authentication.')
      );
    }

    try {
      const chats = await this.client.getAllChats();
      // Sort by timestamp (newest first)
      return chats.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to list chats: ${errorMsg}`);
      throw new ServiceUnavailableException(`Failed to fetch WhatsApp chats: ${errorMsg}`);
    }
  }

  async listLiveGroups() {
    const status = this.client.getStatus();

    if (!status.operational) {
      this.logger.warn(
        `Cannot list groups - WhatsApp not operational. ` +
        `State: ${status.state}, Authenticated: ${status.authenticated}`
      );
      throw new ServiceUnavailableException(
        `WhatsApp client not ready for operations. Current state: ${status.state}. ` +
        (status.error ? `Error: ${status.error}` : 'Please scan QR code and wait for authentication.')
      );
    }

    try {
      return await this.client.listGroups();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to list groups: ${errorMsg}`);
      throw new ServiceUnavailableException(`Failed to fetch WhatsApp groups: ${errorMsg}`);
    }
  }

  getGroupSettings() {
    return this.prisma.whatsappGroupSetting.findMany({ orderBy: { workerType: 'asc' } });
  }

  setGroupSetting(workerType: WorkerType, groupId: string, groupName: string | undefined, userId: string) {
    return this.prisma.whatsappGroupSetting.upsert({
      where: { workerType },
      create: { workerType, groupId, groupName, updatedById: userId },
      update: { groupId, groupName, updatedById: userId },
    });
  }

  async removeGroupSetting(workerType: WorkerType) {
    await this.prisma.whatsappGroupSetting.deleteMany({ where: { workerType } });
    return { success: true };
  }

  async getGroupIdForWorkerType(workerType: WorkerType): Promise<string | null> {
    const setting = await this.prisma.whatsappGroupSetting.findUnique({ where: { workerType } });
    return setting?.groupId ?? null;
  }

  private async dispatch(rawPhone: string, payload: Parameters<WhatsappQueue['enqueue']>[1]): Promise<WhatsappSendResult> {
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      this.logger.warn(`Cannot send WhatsApp message: invalid phone "${rawPhone}"`);
      return { sent: false, reason: 'invalid_phone' };
    }

    try {
      await this.queue.enqueue(phone, payload);
      return { sent: true };
    } catch (err) {
      if (err instanceof WhatsappRateLimitError) {
        this.logger.warn(`WhatsApp send throttled for ${phone}: ${err.message}`);
        return { sent: false, reason: 'rate_limited' };
      }
      this.logger.error(`Failed to send WhatsApp message: ${(err as Error).message}`);
      return { sent: false, reason: 'send_failed' };
    }
  }

  async logout(): Promise<{ success: boolean }> {
    try {
      await this.client.logout();
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to logout WhatsApp client: ${errorMsg}`);
      throw new ServiceUnavailableException(`Failed to logout: ${errorMsg}`);
    }
  }

  async sendMessage(chatId: string, message: string): Promise<{ sent: boolean; reason?: string; error?: string; chatId?: string }> {
    const status = this.client.getStatus();
    if (!status.operational) {
      return { sent: false, reason: 'whatsapp_not_ready', chatId };
    }

    if (!chatId || !message?.trim()) {
      throw new BadRequestException('chatId and message are required');
    }

    try {
      // Validate chat ID format and extract a phone key for rate limiting
      let rateLimitKey = chatId;
      if (chatId.endsWith('@c.us')) {
        rateLimitKey = chatId.replace('@c.us', '');
      } else if (chatId.endsWith('@lid')) {
        rateLimitKey = chatId;
      } else if (chatId.endsWith('@g.us')) {
        rateLimitKey = chatId;
      } else if (/^\d+$/.test(chatId)) {
        rateLimitKey = chatId;
      }

      // Use the queue system to respect rate limiting and serialization
      await this.queue.enqueue(rateLimitKey, { kind: 'chat', chatId, text: message }, chatId);
      return { sent: true, chatId };
    } catch (err) {
      if (err instanceof WhatsappRateLimitError) {
        this.logger.warn(`WhatsApp send rate-limited for ${chatId}: ${err.message}`);
        return { sent: false, reason: 'rate_limited', error: err.message, chatId };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WHATSAPP SEND FAILED] chatId=${chatId}, error=${errorMsg}`);
      return { sent: false, reason: 'send_failed', error: errorMsg, chatId };
    }
  }

  getStatus() {
    const clientStatus = this.client.getStatus();
    this.logger.log(
      `[WHATSAPP STATUS] state=${clientStatus.state} authenticated=${clientStatus.authenticated} ` +
      `ready=${clientStatus.ready} storesReady=${clientStatus.storesReady} operational=${clientStatus.operational}`
    );
    return {
      ...clientStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
