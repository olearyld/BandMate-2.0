const mockFrom = jest.fn();
jest.mock('../../src/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import {
  getConnectionStatus,
  sendRequest,
  acceptRequest,
  cancelOrDeclineOrRemove,
  listIncomingRequests,
  listSentRequests,
  listAcceptedConnections,
} from '../../src/lib/connections';

/**
 * A minimal stand-in for postgrest-js's query builder: every chain method
 * returns itself, and the object is thenable (like the real builder) so
 * `await supabase.from(...).select(...).eq(...)` resolves to `result`
 * regardless of how many methods were chained first.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: jest.fn(() => builder),
    or: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    returns: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const VIEWER = 'viewer-id';
const PROFILE = 'profile-id';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getConnectionStatus', () => {
  it("returns 'none' with no connectionId when no row exists", async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: null }));
    await expect(getConnectionStatus(VIEWER, PROFILE)).resolves.toEqual({
      status: 'none',
      connectionId: null,
    });
  });

  it("returns 'accepted' with the connection id when status is accepted", async () => {
    mockFrom.mockReturnValue(
      makeBuilder({
        data: { id: 'conn-1', requester_id: VIEWER, recipient_id: PROFILE, status: 'accepted' },
        error: null,
      })
    );
    await expect(getConnectionStatus(VIEWER, PROFILE)).resolves.toEqual({
      status: 'accepted',
      connectionId: 'conn-1',
    });
  });

  it("returns 'pending_sent' when the viewer is the requester of a pending row", async () => {
    mockFrom.mockReturnValue(
      makeBuilder({
        data: { id: 'conn-1', requester_id: VIEWER, recipient_id: PROFILE, status: 'pending' },
        error: null,
      })
    );
    await expect(getConnectionStatus(VIEWER, PROFILE)).resolves.toEqual({
      status: 'pending_sent',
      connectionId: 'conn-1',
    });
  });

  it("returns 'pending_received' when the viewer is the recipient of a pending row", async () => {
    mockFrom.mockReturnValue(
      makeBuilder({
        data: { id: 'conn-1', requester_id: PROFILE, recipient_id: VIEWER, status: 'pending' },
        error: null,
      })
    );
    await expect(getConnectionStatus(VIEWER, PROFILE)).resolves.toEqual({
      status: 'pending_received',
      connectionId: 'conn-1',
    });
  });

  it("treats a legacy 'declined' row as 'none' (declined is a dead status going forward)", async () => {
    mockFrom.mockReturnValue(
      makeBuilder({
        data: { id: 'conn-1', requester_id: VIEWER, recipient_id: PROFILE, status: 'declined' },
        error: null,
      })
    );
    await expect(getConnectionStatus(VIEWER, PROFILE)).resolves.toEqual({
      status: 'none',
      connectionId: null,
    });
  });

  it('throws on a query error', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: new Error('boom') }));
    await expect(getConnectionStatus(VIEWER, PROFILE)).rejects.toThrow('boom');
  });
});

describe('sendRequest', () => {
  it('inserts with requester_id = viewerId and status pending', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await sendRequest(VIEWER, PROFILE);
    expect(builder.insert).toHaveBeenCalledWith({
      requester_id: VIEWER,
      recipient_id: PROFILE,
      status: 'pending',
    });
  });

  it('maps a unique-violation (23505) to a friendly error', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: { code: '23505', message: 'duplicate' } }));
    await expect(sendRequest(VIEWER, PROFILE)).rejects.toThrow(/already a connection/i);
  });

  it('rethrows other errors as-is', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: { code: '23514', message: 'check violation' } }));
    await expect(sendRequest(VIEWER, PROFILE)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('acceptRequest / cancelOrDeclineOrRemove', () => {
  it('acceptRequest updates status to accepted for the given id', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await acceptRequest('conn-1');
    expect(builder.update).toHaveBeenCalledWith({ status: 'accepted' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'conn-1');
  });

  it('cancelOrDeclineOrRemove deletes the given id', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await cancelOrDeclineOrRemove('conn-1');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'conn-1');
  });

  it('propagates errors from either', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: new Error('nope') }));
    await expect(acceptRequest('conn-1')).rejects.toThrow('nope');
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: new Error('nope') }));
    await expect(cancelOrDeclineOrRemove('conn-1')).rejects.toThrow('nope');
  });
});

const PROFILE_SUMMARY = { id: 'p1', username: 'p1_user', display_name: 'P One', avatar_url: null };

describe('list* functions map rows to { id, otherProfile }', () => {
  it('listIncomingRequests maps the joined requester profile', async () => {
    mockFrom.mockReturnValue(
      makeBuilder({ data: [{ id: 'conn-1', requester: PROFILE_SUMMARY }], error: null })
    );
    await expect(listIncomingRequests(VIEWER)).resolves.toEqual([
      { id: 'conn-1', otherProfile: PROFILE_SUMMARY },
    ]);
  });

  it('listSentRequests maps the joined recipient profile', async () => {
    mockFrom.mockReturnValue(
      makeBuilder({ data: [{ id: 'conn-1', recipient: PROFILE_SUMMARY }], error: null })
    );
    await expect(listSentRequests(VIEWER)).resolves.toEqual([
      { id: 'conn-1', otherProfile: PROFILE_SUMMARY },
    ]);
  });

  it('listAcceptedConnections picks whichever side is not the viewer', async () => {
    const other = PROFILE_SUMMARY;
    const me = { id: VIEWER, username: 'me', display_name: 'Me', avatar_url: null };
    mockFrom.mockReturnValue(
      makeBuilder({
        data: [
          {
            id: 'conn-1',
            requester_id: VIEWER,
            recipient_id: other.id,
            requester: me,
            recipient: other,
          },
          {
            id: 'conn-2',
            requester_id: other.id,
            recipient_id: VIEWER,
            requester: other,
            recipient: me,
          },
        ],
        error: null,
      })
    );
    await expect(listAcceptedConnections(VIEWER)).resolves.toEqual([
      { id: 'conn-1', otherProfile: other },
      { id: 'conn-2', otherProfile: other },
    ]);
  });

  it('returns an empty array when data is null', async () => {
    mockFrom.mockReturnValue(makeBuilder({ data: null, error: null }));
    await expect(listIncomingRequests(VIEWER)).resolves.toEqual([]);
  });
});
