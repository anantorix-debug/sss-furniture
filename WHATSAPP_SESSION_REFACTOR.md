# WhatsApp Session Management - Refactor Guide

## Overview

This guide shows how to enhance the current WhatsApp implementation using patterns from the A2 Insurance project while keeping existing features.

**Current Status (SSS):**
- ✅ Queue-based message delivery with rate limiting
- ✅ Document sending (PDFs, images)
- ✅ Group message support
- ✅ LID (Last Interesting Date) resolution with caching
- ✅ Phone number normalization

**To Add (from A2):**
- ✅ Better error handling for transient chromium issues
- ✅ Graceful reconnection with backoff
- ✅ QR code lifecycle management
- ✅ Web-based QR display (not just terminal)
- ✅ Connection status notifications

---

## Architecture Comparison

### Current SSS Implementation

```typescript
// apps/api/src/whatsapp/whatsapp-client.ts
- Client initialization with puppeteer
- QR code display in terminal only
- Ready state tracking
- @lid chat support
- LID cache with resolution timeout
```

**Strengths:**
- Sophisticated LID resolution
- Queue-based delivery (prevents spam)
- Rate limiting per recipient

**Gaps:**
- Transient error suppression is basic
- No WebSocket push notifications
- Reconnection logic is minimal

### A2 Implementation Pattern

```typescript
// modules/notifications/whatsapp-web.service.ts
- OnModuleInit lifecycle management
- Unhandled rejection handling
- Connection state transitions (qr → authenticated → ready → disconnected)
- Graceful reconnection with escalating delays
- Gateway push notifications (WebSocket)
```

**Strengths:**
- Comprehensive error categorization
- QR code notification to frontend
- Better resource cleanup
- Connection lifecycle tracking

---

## Recommended Changes

### 1. Enhance WhatsApp Client Error Handling

**File:** `apps/api/src/whatsapp/whatsapp-client.ts`

```typescript
// Add transient error suppression (from A2)
private attachErrorHandlers() {
  process.on('unhandledRejection', (reason: any) => {
    const msg = reason?.message ?? String(reason);
    
    // Transient errors - log but don't fail
    if (
      msg.includes('EBUSY') ||
      msg.includes('resource busy or locked') ||
      msg.includes('Execution context was destroyed') ||
      msg.includes('Protocol error (Runtime.evaluate)')
    ) {
      this.logger.warn(`[WhatsApp] Transient error: ${msg.split('\n')[0]}`);
      return; // Suppress
    }
    
    // Critical errors - log and attempt recovery
    if (msg.includes('Could not find Chrome')) {
      this.logger.error('Chrome not found - WhatsApp Web disabled');
      return;
    }
  });
}
```

### 2. Add WebSocket Notifications (Optional)

**Create:** `apps/api/src/whatsapp/whatsapp-gateway.ts`

```typescript
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  namespace: 'whatsapp',
  cors: { origin: process.env.CORS_ORIGIN },
})
export class WhatsAppGateway {
  @WebSocketServer()
  server: Server;

  pushNotification(event: string, data: any) {
    this.server.emit(event, data);
  }

  // Events
  onQRCode(qrDataUrl: string) {
    this.pushNotification('qr_generated', { qrDataUrl });
  }

  onReady() {
    this.pushNotification('connected', { status: 'ready' });
  }

  onDisconnected(reason: string) {
    this.pushNotification('disconnected', { reason });
  }

  onAuthFailure(message: string) {
    this.pushNotification('auth_failure', { message });
  }
}
```

### 3. Graceful Reconnection with Backoff

**Update:** `apps/api/src/whatsapp/whatsapp-client.ts`

```typescript
private reconnectDelays = [6000, 8000, 10000, 15000, 30000]; // escalating
private reconnectAttempt = 0;

private scheduleReconnect(delayMs?: number) {
  if (this.reconnectTimer) return;
  
  if (!delayMs) {
    // Escalating backoff
    delayMs = this.reconnectDelays[
      Math.min(this.reconnectAttempt++, this.reconnectDelays.length - 1)
    ];
  }

  this.logger.log(`[WhatsApp] Reconnecting in ${delayMs}ms...`);
  
  this.reconnectTimer = setTimeout(async () => {
    this.reconnectTimer = null;
    try {
      await this.client.destroy().catch(() => {});
    } catch { /* ignore */ }
    await this.initClient();
  }, delayMs);
}

private resetReconnectBackoff() {
  this.reconnectAttempt = 0; // Reset on successful connection
}
```

### 4. QR Code Lifecycle

**Keep current implementation but enhance:**

```typescript
private qrNotifyCount = 0;
private maxQRNotifications = 2; // Prevent spam

onQrEvent(qr: string) {
  this.latestQr = qr;
  
  // Terminal display (always)
  qrcode.generate(qr, { small: true });
  
  // Web notification (first 2 times only)
  if (this.qrNotifyCount < this.maxQRNotifications) {
    this.qrNotifyCount++;
    
    // Emit via WebSocket if gateway available
    this.gateway?.onQRCode(await QRCode.toDataURL(qr));
  }
}

onReady() {
  this.ready = true;
  this.qrNotifyCount = 0;      // Reset for next session
  this.resetReconnectBackoff(); // Reset reconnection backoff
  this.gateway?.onReady();
}
```

### 5. Connection State Machine

**Create:** `apps/api/src/whatsapp/whatsapp-state.ts`

```typescript
export enum WhatsAppConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  INITIALIZING = 'INITIALIZING',
  QR_REQUIRED = 'QR_REQUIRED',
  AUTHENTICATING = 'AUTHENTICATING',
  AUTHENTICATED = 'AUTHENTICATED',
  READY = 'READY',
  LOADING_SCREEN = 'LOADING_SCREEN',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

export interface WhatsAppStatus {
  state: WhatsAppConnectionState;
  authenticated: boolean;
  ready: boolean;
  storesReady: boolean;
  qr?: string;
  error?: string;
  reconnectAttempt?: number;
}

// Use in controller
@Get('status')
getStatus(): WhatsAppStatus {
  return {
    state: this.client.getState(),
    authenticated: this.client.isAuthenticated(),
    ready: this.client.isReady(),
    storesReady: this.client.isStoresReady(),
    qr: this.client.getQRCode(),
  };
}
```

---

## Implementation Priority

### Phase 1 (Essential)
- ✅ Add transient error suppression
- ✅ Improve reconnection logic with backoff
- ✅ Add connection status endpoint

### Phase 2 (Nice to have)
- Add WebSocket notifications
- Add QR code to web interface
- Enhance logging and monitoring

### Phase 3 (Future)
- Session persistence improvements
- Multi-account support
- Advanced analytics

---

## Testing the Enhanced Implementation

```bash
# 1. Start API with new error handling
npm run dev:api

# 2. Check WhatsApp status
curl http://localhost:4000/api/whatsapp/status

# 3. Test message sending
curl -X POST http://localhost:4000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","message":"Test"}'

# 4. Monitor for transient errors
# Watch terminal output for "[WhatsApp] Transient error" logs
# Connection should auto-recover without full restart
```

---

## Comparison Matrix

| Feature | SSS Current | A2 Pattern | Recommended |
|---------|------------|-----------|-------------|
| Queue-based delivery | ✅ | ❌ | Keep SSS |
| Rate limiting | ✅ | ❌ | Keep SSS |
| LID resolution | ✅ | ❌ | Keep SSS |
| Error suppression | ⚠️ Basic | ✅ Advanced | Add A2 approach |
| Reconnection | ⚠️ Simple | ✅ Escalating | Add backoff |
| QR notifications | ⚠️ Terminal | ✅ WebSocket | Add optional |
| Connection status | ⚠️ Basic | ✅ Full lifecycle | Enhance |
| Logging | ✅ Good | ✅ Good | Improve |

---

## Migration Path

1. **No breaking changes** - Keep queue, rate limiting, LID resolution
2. **Additive improvements** - Better error handling and reconnection
3. **Optional enhancements** - WebSocket notifications, web-based QR
4. **Gradual rollout** - Test in development first

---

## References

- [A2 Insurance WhatsApp Web Service](../A2/backend/src/modules/notifications/whatsapp-web.service.ts)
- [WhatsApp Web.js Docs](https://docs.wwebjs.dev/)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)
- [Graceful Shutdown Patterns](https://nodejs.org/en/docs/guides/nodejs-event-emitter/)
