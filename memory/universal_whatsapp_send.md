---
name: universal-whatsapp-send
description: Universal WhatsApp chat resolver and message sender supporting @g.us, @c.us, @lid, and raw phone numbers
metadata:
  type: project
---

## Universal WhatsApp Chat Sending Implementation

**File**: `apps/api/src/whatsapp/whatsapp-client.ts`

### Resolver Method: `resolveChatId(chatId: string): Promise<string>`

Handles 4 chat ID formats:

1. **@g.us** (groups)
   - Returned as-is (already valid WhatsApp JID)
   - No conversion needed
   - Example: `919442380888-1616507753@g.us`

2. **@c.us** (individuals)
   - Returned as-is (already valid WhatsApp JID)
   - No conversion needed
   - Example: `919876543210@c.us`

3. **@lid** (LinkedIn IDs)
   - Requires resolution via `resolveChatIdForSending()`
   - Falls back to 4 methods: getContactLidAndPhone(), getContactById(), Chat store, Contact store
   - Returns resolved `@c.us` format
   - Example input: `13447576182793@lid` → output: `919876543210@c.us`
   - Uses 10-second timeout

4. **Raw phone numbers**
   - Normalized to `@c.us` format
   - Detects: numeric-only strings
   - Example: `919876543210` → `919876543210@c.us`

### Send Method: `sendToChat(chatId: string, message: string)`

Flow:
1. Validate client is operational
2. Call `resolveChatId()` with 10s timeout
3. Send via `client.sendMessage(resolvedChatId, message)` with 15s timeout
4. Return result only after WhatsApp confirms send

### Logging Prefix: `[WA SEND]`

Progress logs:
- `[WA SEND] Incoming chat ID: {id}`
- `[WA SEND] Detected chat type: GROUP|CONTACT|LID`
- `[WA SEND] Resolving LID: {id}` (LID only)
- `[WA SEND] LID resolved to: {resolved_id}` (LID only)
- `[WA SEND] Normalizing raw phone: {id}` (raw phone only)
- `[WA SEND] Sending message to: {resolved_id}`
- `[WA SEND] Message sent successfully`

Error logs:
- `[WA SEND] Chat ID resolution failed: {error}`
- `[WA SEND] Send operation failed: {error}`
- `[WA SEND] Final error: chatId={id}, error={error}`

### Architecture

```
                    incoming chatId
                         |
          +--------------+--------------+
          |              |              |
        @g.us           @c.us          @lid       raw phone
          |              |              |           |
       DIRECT          DIRECT        RESOLVE      NORMALIZE
          |              |              |           |
          └──────────────┴──────────────┴───────────┘
                         |
                  client.sendMessage()
                         |
                      WhatsApp
```

### Timeouts

- **LID resolution**: 10 seconds (via Promise.race)
- **Message send**: 15 seconds (via Promise.race)
- **Total max response time**: ~25 seconds

### Frontend Integration

POST `/api/whatsapp/send/:chatId`

Request:
```json
{
  "message": "Hello"
}
```

Response (sent=true):
```json
{
  "sent": true
}
```

Response (sent=false):
```json
{
  "sent": false,
  "reason": "lid_resolution_failed|send_failed",
  "error": "Unable to resolve LID... or Failed to send message...",
  "chatId": "..."
}
```

### No Frontend Disable

Send button remains enabled for all chat types:
- Individual contacts (@c.us)
- Groups (@g.us)
- LinkedIn contacts (@lid)

Single unified "Send Message" UI works for all formats.
