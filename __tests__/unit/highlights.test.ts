const mockRpc = jest.fn();
jest.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { saveHighlights } from '../../src/lib/highlights';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('saveHighlights', () => {
  it('calls reorder_profile_highlights with the ordered post ids', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await saveHighlights(['post-1', 'post-2']);
    expect(mockRpc).toHaveBeenCalledWith('reorder_profile_highlights', {
      p_post_ids: ['post-1', 'post-2'],
    });
  });

  it('throws on an RPC error (e.g. the cap trigger rejecting > 6 ids)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('Highlight cap of 6 reached for this profile') });
    await expect(saveHighlights(new Array(7).fill('x'))).rejects.toThrow(/cap of 6/);
  });
});
