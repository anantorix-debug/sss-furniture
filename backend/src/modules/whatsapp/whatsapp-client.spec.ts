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
