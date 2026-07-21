/**
 * Unit tests for the send-push-notification Edge Function's pure logic
 * (supabase/functions/send-push-notification/lib.ts). That file has zero
 * Deno-specific dependencies specifically so it can be imported and tested
 * here like any other shared-service module — index.ts (the actual
 * Deno.serve handler) isn't imported anywhere in this repo's Jest config,
 * see CONVENTIONS.md for why (Deno globals/module specifiers aren't
 * something Jest/babel can resolve).
 */
import {
  buildNotificationContent,
  buildExpoPushMessages,
  batchMessages,
  findDeadTokens,
  EXPO_PUSH_BATCH_SIZE,
  type WebhookPayload,
  type ExpoPushTicket,
} from '../../supabase/functions/send-push-notification/lib';

describe('buildNotificationContent', () => {
  it('builds the messages notification', () => {
    expect(buildNotificationContent('messages', 'Jimi')).toEqual({
      title: 'New message',
      body: 'Jimi sent you a message',
    });
  });

  it('builds the connections (pending) notification', () => {
    expect(buildNotificationContent('connections', 'Jimi')).toEqual({
      title: 'New connection request',
      body: 'Jimi wants to connect',
    });
  });

  it('builds the likes notification', () => {
    expect(buildNotificationContent('likes', 'Jimi')).toEqual({
      title: 'New like',
      body: 'Jimi liked your post',
    });
  });

  it('builds the comments notification', () => {
    expect(buildNotificationContent('comments', 'Jimi')).toEqual({
      title: 'New comment',
      body: 'Jimi commented on your post',
    });
  });
});

describe('buildExpoPushMessages', () => {
  const payload: WebhookPayload = {
    table: 'likes',
    row_id: 'row-1',
    actor_id: 'actor-1',
    recipient_id: 'recipient-1',
  };
  const content = { title: 'New like', body: 'Jimi liked your post' };

  it('builds one Expo message per token, carrying the source table/row in data', () => {
    const messages = buildExpoPushMessages(['tokenA', 'tokenB'], content, payload);
    expect(messages).toEqual([
      { to: 'tokenA', title: content.title, body: content.body, sound: 'default', data: { table: 'likes', row_id: 'row-1' } },
      { to: 'tokenB', title: content.title, body: content.body, sound: 'default', data: { table: 'likes', row_id: 'row-1' } },
    ]);
  });

  it('returns an empty array for no tokens', () => {
    expect(buildExpoPushMessages([], content, payload)).toEqual([]);
  });
});

describe('batchMessages', () => {
  it('splits into chunks of the given size', () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(batchMessages(items, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it('defaults to EXPO_PUSH_BATCH_SIZE (100)', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const batches = batchMessages(items);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(EXPO_PUSH_BATCH_SIZE);
    expect(batches[1]).toHaveLength(EXPO_PUSH_BATCH_SIZE);
    expect(batches[2]).toHaveLength(50);
  });

  it('returns an empty array for no messages', () => {
    expect(batchMessages([])).toEqual([]);
  });
});

describe('findDeadTokens', () => {
  it('flags DeviceNotRegistered tokens for cleanup', () => {
    const tokens = ['tokenA', 'tokenB'];
    const tickets: ExpoPushTicket[] = [
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok', id: 'ticket-1' },
    ];
    expect(findDeadTokens(tokens, tickets)).toEqual(['tokenA']);
  });

  it('does not flag a successful ticket', () => {
    const tokens = ['tokenA'];
    const tickets: ExpoPushTicket[] = [{ status: 'ok', id: 'ticket-1' }];
    expect(findDeadTokens(tokens, tickets)).toEqual([]);
  });

  it('does not flag a non-DeviceNotRegistered error (e.g. a transient MessageTooBig)', () => {
    const tokens = ['tokenA'];
    const tickets: ExpoPushTicket[] = [
      { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
    ];
    expect(findDeadTokens(tokens, tickets)).toEqual([]);
  });

  it('handles multiple dead tokens across a batch, preserving order-correlation', () => {
    const tokens = ['tokenA', 'tokenB', 'tokenC'];
    const tickets: ExpoPushTicket[] = [
      { status: 'ok', id: 'ticket-1' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ];
    expect(findDeadTokens(tokens, tickets)).toEqual(['tokenB', 'tokenC']);
  });
});
