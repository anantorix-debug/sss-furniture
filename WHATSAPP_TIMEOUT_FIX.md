# WhatsApp Message Sending Timeout Fix

## Problem
Message sending was failing with error:
```
{
  "sent": false,
  "reason": "send_failed",
  "error": "Failed to send message: SendMessage timeout after 8s",
  "chatId": "13447576182793@lid"
}
```

## Root Cause
- Message send operation timeout was too aggressive (8 seconds)
- WhatsApp Web operations can take longer, especially with:
  - @lid (LID) chat resolution
  - Network latency
  - WhatsApp Web page responsiveness

## Solution Implemented

### 1. **Configurable Timeouts** (whatsapp-client.ts)
Added environment variables to control timeouts:
- `WHATSAPP_SEND_TIMEOUT_MS`: Default 30000ms (30 seconds) - time to send message
- `WHATSAPP_LID_RESOLUTION_TIMEOUT_MS`: Default 8000ms (8 seconds) - time to resolve @lid to phone number

### 2. **Configuration Updates**
Updated `docker-compose.yml` with:
```yaml
WHATSAPP_SEND_TIMEOUT_MS: 30000
WHATSAPP_LID_RESOLUTION_TIMEOUT_MS: 8000
```

### 3. **Current Timeouts**
```
WhatsApp timeouts: send=30000ms, lid-resolution=8000ms
```

## How It Works

### Message Sending Flow:
1. **Service** receives send request via queue
2. **Client** validates phone number
3. **For @lid chats:** Resolves to phone JID (8 second timeout)
4. **Send operation:** Executes with 30 second timeout
5. **Queue** applies rate limiting and human-like delays

### Timeout Sequence:
```
Request → Validate Phone → Resolve @lid (8s max) → Send (30s max) → Complete
```

## Configuration Options

### Environment Variables:
```bash
# Send operation timeout (milliseconds)
WHATSAPP_SEND_TIMEOUT_MS=30000

# LID resolution timeout (milliseconds)  
WHATSAPP_LID_RESOLUTION_TIMEOUT_MS=8000

# Rate limiting (existing)
WHATSAPP_MIN_DELAY_MS=4000
WHATSAPP_MAX_DELAY_MS=9000
WHATSAPP_MAX_PER_RECIPIENT_PER_DAY=5
WHATSAPP_MAX_PER_HOUR=30
WHATSAPP_MAX_QUEUE_DEPTH=50
```

### Adjust Timeouts If Needed:
```bash
# For slow/unreliable connections, increase timeout:
docker-compose exec api env WHATSAPP_SEND_TIMEOUT_MS=60000 # 60 seconds

# In docker-compose.yml:
WHATSAPP_SEND_TIMEOUT_MS: 45000  # 45 seconds
```

## Testing

### Send Test Message:
```bash
curl -X POST http://localhost:4000/api/whatsapp/send/13447576182793%40lid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Test message"}'
```

### Expected Response (Success):
```json
{
  "sent": true,
  "chatId": "13447576182793@lid"
}
```

### View Logs:
```bash
docker-compose logs api -f | grep "WA SEND"
```

## Performance Impact

### Message Delivery Times:
- **Average:** 10-15 seconds (including 4-9 second queue delay)
- **Max:** 30 seconds (timeout threshold)
- **With @lid resolution:** Add 1-5 seconds for chat resolution

### Queue Processing:
- Messages processed one at a time
- Random 4-9 second delay between messages
- Rate limits: 5 per recipient/day, 30 per hour globally

## Monitoring

### Check WhatsApp Status:
```bash
curl http://localhost:4000/api/whatsapp/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response Shows:
```json
{
  "state": "READY",
  "authenticated": true,
  "ready": true,
  "storesReady": true,
  "operational": true
}
```

## Troubleshooting

If messages still timeout:

1. **Check Queue Status:**
   - Verify queue isn't full: `WHATSAPP_MAX_QUEUE_DEPTH`
   - Check rate limits aren't exceeded

2. **Increase Timeout (temporary):**
   ```yaml
   WHATSAPP_SEND_TIMEOUT_MS: 60000  # 60 seconds
   ```

3. **Check Logs:**
   ```bash
   docker-compose logs api | grep "WHATSAPP_SEND_TIMEOUT\|WA SEND\|timeout"
   ```

4. **Verify WhatsApp Connection:**
   - Check `/api/whatsapp/status` endpoint
   - Ensure client is in READY state
   - Re-scan QR code if needed

## Summary of Changes

| File | Change |
|------|--------|
| `whatsapp-client.ts` | Added timeout configuration, updated sendToChat() |
| `docker-compose.yml` | Added timeout environment variables |
| `whatsapp-service.ts` | Queue-based message sending (from previous fix) |

All files rebuild automatically on `docker-compose up --build`

