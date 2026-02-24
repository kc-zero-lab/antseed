import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaticTokenProvider, OAuthTokenProvider, createTokenProvider } from './token-providers.js';

describe('StaticTokenProvider', () => {
  it('returns the static token', async () => {
    const provider = new StaticTokenProvider('sk-test-key');
    const token = await provider.getToken();
    expect(token).toBe('sk-test-key');
  });

  it('returns the same token on multiple calls', async () => {
    const provider = new StaticTokenProvider('sk-test-key');
    expect(await provider.getToken()).toBe('sk-test-key');
    expect(await provider.getToken()).toBe('sk-test-key');
  });

  it('getState returns token state', () => {
    const provider = new StaticTokenProvider('sk-test-key');
    expect(provider.getState()).toEqual({ accessToken: 'sk-test-key' });
  });

  it('stop is a no-op', () => {
    const provider = new StaticTokenProvider('sk-test-key');
    expect(() => provider.stop()).not.toThrow();
  });
});

describe('OAuthTokenProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns access token when not expired', async () => {
    const provider = new OAuthTokenProvider({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    });

    const token = await provider.getToken();
    expect(token).toBe('access-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes token when expired', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      }),
      { status: 200 },
    ));

    const provider = new OAuthTokenProvider({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000, // already expired
    });

    const token = await provider.getToken();
    expect(token).toBe('access-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when within 5 minute buffer', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        access_token: 'access-refreshed',
        expires_in: 3600,
      }),
      { status: 200 },
    ));

    const provider = new OAuthTokenProvider({
      accessToken: 'access-old',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now (within 5 min buffer)
    });

    const token = await provider.getToken();
    expect(token).toBe('access-refreshed');
  });

  it('deduplicates concurrent refresh calls', async () => {
    let resolveRefresh!: (value: Response) => void;
    const refreshPromise = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    fetchMock.mockReturnValueOnce(refreshPromise);

    const provider = new OAuthTokenProvider({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000,
    });

    // Start two concurrent getToken calls
    const p1 = provider.getToken();
    const p2 = provider.getToken();

    resolveRefresh(new Response(
      JSON.stringify({ access_token: 'access-new', expires_in: 3600 }),
      { status: 200 },
    ));

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe('access-new');
    expect(t2).toBe('access-new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on refresh failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const provider = new OAuthTokenProvider({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000,
    });

    await expect(provider.getToken()).rejects.toThrow('OAuth refresh failed (401)');
  });

  it('getState returns current state', () => {
    const provider = new OAuthTokenProvider({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1234567890,
    });

    const state = provider.getState();
    expect(state).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1234567890,
    });
  });

  it('updates refresh token when provided in response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      }),
      { status: 200 },
    ));

    const provider = new OAuthTokenProvider({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() - 1000,
    });

    await provider.getToken();
    const state = provider.getState();
    expect(state.refreshToken).toBe('refresh-2');
  });
});

describe('createTokenProvider', () => {
  it('creates StaticTokenProvider for apikey type', () => {
    const provider = createTokenProvider({ authType: 'apikey', authValue: 'sk-key' });
    expect(provider).toBeInstanceOf(StaticTokenProvider);
  });

  it('defaults to StaticTokenProvider when authType is omitted', () => {
    const provider = createTokenProvider({ authValue: 'sk-key' });
    expect(provider).toBeInstanceOf(StaticTokenProvider);
  });

  it('creates OAuthTokenProvider for oauth type with refresh token', () => {
    const provider = createTokenProvider({
      authType: 'oauth',
      authValue: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600_000,
    });
    expect(provider).toBeInstanceOf(OAuthTokenProvider);
  });

  it('creates StaticTokenProvider for oauth type without refresh token', () => {
    const provider = createTokenProvider({
      authType: 'oauth',
      authValue: 'access-1',
    });
    expect(provider).toBeInstanceOf(StaticTokenProvider);
  });
});
