const mockFrom = jest.fn();
jest.mock('../../src/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

const mockUploadStoryMedia = jest.fn();
jest.mock('../../src/lib/mediaUpload', () => ({
  uploadStoryMedia: (...args: unknown[]) => mockUploadStoryMedia(...args),
}));

import { listActiveStoryGroups, postStory } from '../../src/lib/stories';

// Same minimal postgrest-js query-builder stand-in as connections.test.ts:
// every chain method returns itself, and the object is thenable so
// `await supabase.from(...).select(...).gt(...).order(...)` resolves to
// `result` regardless of how many methods were chained first.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    order: jest.fn(() => builder),
    returns: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listActiveStoryGroups', () => {
  it('groups active stories by author, preserving each author\'s first-seen (oldest-story-first) order', async () => {
    const rowA1 = {
      id: 's1',
      profile_id: 'a',
      media_url: 'https://cdn/a1.jpg',
      media_type: 'image',
      created_at: '2026-07-23T00:00:00Z',
      expires_at: '2026-07-24T00:00:00Z',
      profiles: { id: 'a', username: 'alice', display_name: 'Alice', avatar_url: null },
    };
    const rowB1 = {
      id: 's2',
      profile_id: 'b',
      media_url: 'https://cdn/b1.mp4',
      media_type: 'video',
      created_at: '2026-07-23T01:00:00Z',
      expires_at: '2026-07-24T01:00:00Z',
      profiles: { id: 'b', username: 'bob', display_name: null, avatar_url: null },
    };
    const rowA2 = {
      id: 's3',
      profile_id: 'a',
      media_url: 'https://cdn/a2.jpg',
      media_type: 'image',
      created_at: '2026-07-23T02:00:00Z',
      expires_at: '2026-07-24T02:00:00Z',
      profiles: { id: 'a', username: 'alice', display_name: 'Alice', avatar_url: null },
    };
    mockFrom.mockReturnValue(makeBuilder({ data: [rowA1, rowB1, rowA2], error: null }));

    const groups = await listActiveStoryGroups();

    expect(groups).toHaveLength(2);
    expect(groups[0].profile.id).toBe('a');
    expect(groups[0].stories.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(groups[1].profile.id).toBe('b');
    expect(groups[1].stories.map((s) => s.id)).toEqual(['s2']);
  });

  it('filters by expires_at > now at query time, not just relying on RLS', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    const before = Date.now();
    await listActiveStoryGroups();

    expect(builder.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
    const passedTimestamp = builder.gt.mock.calls[0][1];
    expect(new Date(passedTimestamp).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns an empty array when there are no active stories', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: null }));
    await expect(listActiveStoryGroups()).resolves.toEqual([]);
  });

  it('propagates a query error', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: new Error('network down') }));
    await expect(listActiveStoryGroups()).rejects.toThrow('network down');
  });
});

describe('postStory', () => {
  it('uploads the media then inserts a row under the given profile id', async () => {
    mockUploadStoryMedia.mockResolvedValue({ url: 'https://cdn/u1/stories/x.jpg' });
    const builder = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await postStory('u1', { uri: 'file://photo.jpg', type: 'image' });

    expect(mockUploadStoryMedia).toHaveBeenCalledWith('u1', { uri: 'file://photo.jpg', type: 'image' });
    expect(builder.insert).toHaveBeenCalledWith({
      profile_id: 'u1',
      media_url: 'https://cdn/u1/stories/x.jpg',
      media_type: 'image',
    });
  });

  it('propagates an insert error (e.g. the media_type CHECK constraint rejecting audio)', async () => {
    mockUploadStoryMedia.mockResolvedValue({ url: 'https://cdn/u1/stories/x.m4a' });
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: new Error('violates check constraint') }));

    await expect(postStory('u1', { uri: 'file://x.m4a', type: 'audio' })).rejects.toThrow(/check constraint/);
  });
});
