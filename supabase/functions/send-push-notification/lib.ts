// Pure logic for the send-push-notification Edge Function — deliberately has
// zero Deno-specific dependencies (no Deno.serve, no Deno.env) so it can be
// imported and unit-tested from the repo's existing Jest setup, the same way
// every other shared-service module in src/lib/ is tested. index.ts is the
// thin Deno.serve wrapper that supplies env/network/DB access around this.

export type WebhookTable = 'messages' | 'connections' | 'likes' | 'comments';

export interface WebhookPayload {
  table: WebhookTable;
  row_id: string;
  actor_id: string;
  recipient_id: string;
}

export interface NotificationContent {
  title: string;
  body: string;
}

/** Builds the notification title/body for a given source table + actor display name. */
export function buildNotificationContent(table: WebhookTable, actorName: string): NotificationContent {
  switch (table) {
    case 'messages':
      return { title: 'New message', body: `${actorName} sent you a message` };
    case 'connections':
      return { title: 'New connection request', body: `${actorName} wants to connect` };
    case 'likes':
      return { title: 'New like', body: `${actorName} liked your post` };
    case 'comments':
      return { title: 'New comment', body: `${actorName} commented on your post` };
  }
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: { table: WebhookTable; row_id: string };
}

export function buildExpoPushMessages(
  tokens: string[],
  content: NotificationContent,
  payload: WebhookPayload
): ExpoPushMessage[] {
  return tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    sound: 'default',
    data: { table: payload.table, row_id: payload.row_id },
  }));
}

/** Expo's documented batch limit per push API request. */
export const EXPO_PUSH_BATCH_SIZE = 100;

export function batchMessages<T>(messages: T[], size: number = EXPO_PUSH_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < messages.length; i += size) {
    batches.push(messages.slice(i, i + size));
  }
  return batches;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Expo returns one ticket per message, in the same order as the request —
 * zips tickets back to their originating token and returns the ones that
 * came back DeviceNotRegistered (or any other "this token is dead" error),
 * so the caller can delete exactly those push_tokens rows and not let dead
 * tokens accumulate silently.
 */
export function findDeadTokens(tokens: string[], tickets: ExpoPushTicket[]): string[] {
  const dead: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const token = tokens[i];
    if (!token) continue;
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      dead.push(token);
    }
  }
  return dead;
}
