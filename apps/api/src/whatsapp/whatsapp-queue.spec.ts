import { WhatsappQueue, WhatsappRateLimitError, WhatsappPayload } from './whatsapp-queue';

function configStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    WHATSAPP_MIN_DELAY_MS: 0,
    WHATSAPP_MAX_DELAY_MS: 0,
    WHATSAPP_MAX_PER_RECIPIENT_PER_DAY: 2,
    WHATSAPP_MAX_PER_HOUR: 3,
    WHATSAPP_MAX_QUEUE_DEPTH: 2,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as any;
}

function text(t: string): WhatsappPayload {
  return { kind: 'text', text: t };
}

describe('WhatsappQueue', () => {
  it('sends a single message through the configured sender', async () => {
    const sendFn = jest.fn().mockResolvedValue(undefined);
    const queue = new WhatsappQueue(configStub());
    queue.setSender(sendFn);

    await queue.enqueue('919876543210', text('hello'));

    expect(sendFn).toHaveBeenCalledWith('919876543210', text('hello'));
  });

  it('processes queued messages one at a time, in order', async () => {
    const order: string[] = [];
    const sendFn = jest.fn().mockImplementation(async (phone: string) => {
      order.push(phone);
    });
    const queue = new WhatsappQueue(configStub({ WHATSAPP_MAX_PER_RECIPIENT_PER_DAY: 10, WHATSAPP_MAX_PER_HOUR: 10, WHATSAPP_MAX_QUEUE_DEPTH: 10 }));
    queue.setSender(sendFn);

    await Promise.all([queue.enqueue('a', text('1')), queue.enqueue('b', text('2')), queue.enqueue('c', text('3'))]);

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('rejects a recipient once the daily per-recipient cap is hit (anti-spam)', async () => {
    const sendFn = jest.fn().mockResolvedValue(undefined);
    const queue = new WhatsappQueue(configStub({ WHATSAPP_MAX_PER_RECIPIENT_PER_DAY: 2 }));
    queue.setSender(sendFn);

    await queue.enqueue('919876543210', text('one'));
    await queue.enqueue('919876543210', text('two'));

    expect(() => queue.enqueue('919876543210', text('three'))).toThrow(WhatsappRateLimitError);
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it('does not let the per-recipient cap block a different recipient', async () => {
    const sendFn = jest.fn().mockResolvedValue(undefined);
    const queue = new WhatsappQueue(configStub({ WHATSAPP_MAX_PER_RECIPIENT_PER_DAY: 1, WHATSAPP_MAX_PER_HOUR: 10 }));
    queue.setSender(sendFn);

    await queue.enqueue('recipient-a', text('hi'));
    await expect(queue.enqueue('recipient-b', text('hi'))).resolves.toBeUndefined();
  });

  it('rejects sends once the service-wide hourly cap is hit', async () => {
    const sendFn = jest.fn().mockResolvedValue(undefined);
    const queue = new WhatsappQueue(configStub({ WHATSAPP_MAX_PER_RECIPIENT_PER_DAY: 10, WHATSAPP_MAX_PER_HOUR: 2, WHATSAPP_MAX_QUEUE_DEPTH: 10 }));
    queue.setSender(sendFn);

    await queue.enqueue('a', text('1'));
    await queue.enqueue('b', text('2'));

    expect(() => queue.enqueue('c', text('3'))).toThrow(WhatsappRateLimitError);
  });

  it('rejects new enqueues once the queue depth cap is reached', async () => {
    let releaseFirst: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sendFn = jest
      .fn()
      .mockImplementationOnce(() => blocker)
      .mockResolvedValue(undefined);

    const queue = new WhatsappQueue(configStub({ WHATSAPP_MAX_QUEUE_DEPTH: 1, WHATSAPP_MAX_PER_RECIPIENT_PER_DAY: 10, WHATSAPP_MAX_PER_HOUR: 10 }));
    queue.setSender(sendFn);

    const first = queue.enqueue('a', text('1')); // shifted out immediately for processing, queue array back to depth 0
    const second = queue.enqueue('b', text('2')); // sits in the queue array at depth 1 (the configured max)

    expect(() => queue.enqueue('c', text('3'))).toThrow(WhatsappRateLimitError);

    releaseFirst();
    await first;
    await second;
  });

  it('has no bulk-send method on its public API (single phone/message only)', () => {
    const queue = new WhatsappQueue(configStub());
    expect((queue as any).enqueueMany).toBeUndefined();
    expect((queue as any).broadcast).toBeUndefined();
    expect(queue.enqueue.length).toBe(2); // (phone, payload) — no array/list parameter
  });
});
