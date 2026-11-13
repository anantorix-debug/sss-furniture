import { WhatsappClientWrapper, WhatsappLookupTimeoutError } from './whatsapp-client';

function build(getNumberId: jest.Mock, lookupTimeoutMs = 20) {
  const values: Record<string, unknown> = { WHATSAPP_LOOKUP_TIMEOUT_MS: lookupTimeoutMs };
  const wrapper = new WhatsappClientWrapper({ get: (key: string) => values[key] } as any) as any;
  wrapper.client = { getNumberId };
  const restart = jest.spyOn(wrapper, 'restartClient').mockResolvedValue(undefined);
  return { wrapper, restart };
}

const hang = () => new Promise(() => undefined);

describe('WhatsappClientWrapper number lookup', () => {
  it('returns the id WhatsApp gives for a registered number', async () => {
    const { wrapper, restart } = build(jest.fn().mockResolvedValue({ _serialized: '919080617824@c.us' }));
    await expect(wrapper.resolveIncomingChatId('919080617824@c.us')).resolves.toBe('919080617824@c.us');
    expect(restart).not.toHaveBeenCalled();
  });

  it('says "not registered" only when WhatsApp really answers no', async () => {
    const { wrapper, restart } = build(jest.fn().mockResolvedValue(null));
    await expect(wrapper.resolveIncomingChatId('919080617824@c.us')).rejects.toThrow(/not registered/);
    expect(restart).not.toHaveBeenCalled();
  });

  it('reports a hung lookup as a timeout, not "not registered", and reconnects', async () => {
    const { wrapper, restart } = build(jest.fn().mockImplementation(hang));
    const err = await wrapper.resolveIncomingChatId('919080617824@c.us').catch((e: Error) => e);
    expect(err).toBeInstanceOf(WhatsappLookupTimeoutError);
    expect(err.message).not.toMatch(/not registered/);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('does not keep reconnecting on repeated timeouts', async () => {
    const { wrapper, restart } = build(jest.fn().mockImplementation(hang));
    await wrapper.resolveIncomingChatId('919080617824@c.us').catch(() => undefined);
    await wrapper.resolveIncomingChatId('919842856602@c.us').catch(() => undefined);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('does not report a browser error as "not registered"', async () => {
    const { wrapper } = build(jest.fn().mockRejectedValue(new Error('Protocol error: Target closed')));
    await expect(wrapper.resolveIncomingChatId('919080617824@c.us')).rejects.toThrow(/Target closed/);
  });

  it('adds the 91 country code to a bare 10-digit number', async () => {
    const getNumberId = jest.fn().mockResolvedValue({ _serialized: '919080617824@c.us' });
    const { wrapper } = build(getNumberId);
    await wrapper.resolveIncomingChatId('9080617824');
    expect(getNumberId).toHaveBeenCalledWith('919080617824@c.us');
  });

  it('leaves a number that already has its country code alone', async () => {
    const getNumberId = jest.fn().mockResolvedValue({ _serialized: '919080617824@c.us' });
    const { wrapper } = build(getNumberId);
    await wrapper.resolveIncomingChatId('919080617824');
    expect(getNumberId).toHaveBeenCalledWith('919080617824@c.us');
  });
});

describe('WhatsappClientWrapper auto-heal', () => {
  const SELF = '919000000000@c.us';

  function healthy(getNumberId: jest.Mock) {
    const { wrapper, restart } = build(getNumberId);
    wrapper.client.info = { wid: { _serialized: SELF } };
    wrapper.state = 'READY';
    wrapper.ready = true;
    return { wrapper, restart };
  }

  it('leaves a healthy client alone and clears the restart count', async () => {
    const getNumberId = jest.fn().mockResolvedValue({ _serialized: SELF });
    const { wrapper, restart } = healthy(getNumberId);
    wrapper.consecutiveRestarts = 3;
    await wrapper.runHealthCheck();
    expect(getNumberId).toHaveBeenCalledWith(SELF);
    expect(restart).not.toHaveBeenCalled();
    expect(wrapper.consecutiveRestarts).toBe(0);
  });

  it('treats a "no" answer as healthy, because WhatsApp did respond', async () => {
    const { wrapper, restart } = healthy(jest.fn().mockResolvedValue(null));
    await wrapper.runHealthCheck();
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts after two hung checks in a row, not after one', async () => {
    const { wrapper, restart } = healthy(jest.fn().mockImplementation(hang));
    await wrapper.runHealthCheck();
    expect(restart).not.toHaveBeenCalled();
    await wrapper.runHealthCheck();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('forgets one failed check once a later check passes', async () => {
    const getNumberId = jest.fn().mockImplementationOnce(hang).mockResolvedValue({ _serialized: SELF });
    const { wrapper, restart } = healthy(getNumberId);
    await wrapper.runHealthCheck();
    await wrapper.runHealthCheck();
    expect(wrapper.healthFailures).toBe(0);
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts straight away on a stale page', async () => {
    const { wrapper, restart } = healthy(jest.fn().mockRejectedValue(new Error("Attempted to use detached Frame 'X'.")));
    await wrapper.runHealthCheck();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('does not check while WhatsApp is waiting for a QR scan or reconnecting', async () => {
    const getNumberId = jest.fn();
    const { wrapper } = healthy(getNumberId);
    wrapper.state = 'QR_REQUIRED';
    wrapper.ready = false;
    await wrapper.runHealthCheck();
    expect(getNumberId).not.toHaveBeenCalled();
  });

  it('waits longer after each restart in a row, up to 5 minutes', () => {
    const { wrapper } = healthy(jest.fn());
    const delays = [0, 1, 2, 3, 10].map((n) => {
      wrapper.consecutiveRestarts = n;
      return wrapper.nextRestartDelay(3000);
    });
    expect(delays).toEqual([3000, 6000, 12000, 24000, 300000]);
  });

  it('Restart WhatsApp skips the wait between automatic tries', async () => {
    jest.useFakeTimers();
    try {
      const wrapper = new WhatsappClientWrapper({ get: () => undefined } as any) as any;
      wrapper.consecutiveRestarts = 10; // waiting 5 minutes
      const start = jest.spyOn(wrapper, 'startClient').mockImplementation(() => undefined);
      const done = wrapper.restartClient();
      await jest.advanceTimersByTimeAsync(1000);
      expect(start).not.toHaveBeenCalled();
      expect(wrapper.getStatus().retryAt).toBeDefined();
      expect(wrapper.restartNow()).toEqual({ restarting: true });
      await done;
      expect(start).toHaveBeenCalledTimes(1);
      expect(wrapper.consecutiveRestarts).toBe(0);
      expect(wrapper.getStatus().retryAt).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('Restart WhatsApp starts a new client when none is pending', () => {
    const wrapper = new WhatsappClientWrapper({ get: () => undefined } as any) as any;
    const restart = jest.spyOn(wrapper, 'restartClient').mockResolvedValue(undefined);
    wrapper.consecutiveRestarts = 7;
    wrapper.lastError = 'boom';
    expect(wrapper.restartNow()).toEqual({ restarting: true });
    expect(restart).toHaveBeenCalledWith(1000);
    expect(wrapper.consecutiveRestarts).toBe(0);
    expect(wrapper.lastError).toBeNull();
  });

  it('Restart WhatsApp does nothing when WhatsApp is switched off', () => {
    const wrapper = new WhatsappClientWrapper({ get: (k: string) => (k === 'WHATSAPP_ENABLED' ? 'false' : undefined) } as any) as any;
    const restart = jest.spyOn(wrapper, 'restartClient').mockResolvedValue(undefined);
    expect(wrapper.restartNow()).toEqual({ restarting: false });
    expect(restart).not.toHaveBeenCalled();
  });

  it('force-kills Chrome when closing it hangs, then starts a new client', async () => {
    jest.useFakeTimers();
    try {
      const wrapper = new WhatsappClientWrapper({ get: () => undefined } as any) as any;
      const kill = jest.fn();
      wrapper.client = {
        pupBrowser: { process: () => ({ exitCode: null, kill }) },
        removeAllListeners: jest.fn(),
        destroy: hang,
      };
      const start = jest.spyOn(wrapper, 'startClient').mockImplementation(() => undefined);
      const done = wrapper.restartClient();
      await jest.advanceTimersByTimeAsync(5000);
      expect(kill).toHaveBeenCalledWith('SIGKILL');
      await jest.advanceTimersByTimeAsync(3000);
      await done;
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
