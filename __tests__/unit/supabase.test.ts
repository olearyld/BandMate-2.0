const mockCreateClient = jest.fn((..._args: unknown[]) => ({ mocked: true }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { __marker: 'AsyncStorage' },
}));

describe('supabase client', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockCreateClient.mockClear();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://test-project.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('creates the client with the URL and anon key from env', () => {
    require('../../src/lib/supabase');

    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://test-project.supabase.co',
      'test-anon-key',
      expect.anything()
    );
  });

  it('persists sessions via AsyncStorage with auto-refresh on, and detectSessionInUrl off', () => {
    require('../../src/lib/supabase');

    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const [, , options] = mockCreateClient.mock.calls[0] as [unknown, unknown, { auth: unknown }];

    expect(options.auth).toEqual(
      expect.objectContaining({
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      })
    );
  });
});
