import { withRetries } from '../utils/withRetries';

describe('withRetries', () => {
  it('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetries(fn, { attempts: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and eventually succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    await expect(withRetries(fn, { attempts: 3, delayMs: 0, label: 'test' })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always'));
    await expect(withRetries(fn, { attempts: 2, delayMs: 0 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
