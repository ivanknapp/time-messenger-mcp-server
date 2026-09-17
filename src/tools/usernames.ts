import type { TimeClient } from '../client/time-client.js';

/**
 * user_id → username, shared by every formatter that prints an author.
 *
 * Cached for the process lifetime because usernames rarely change and an
 * uncached 200-message page would resolve the same authors over and over.
 * Only *answered* lookups land here: a profile the server refuses to return
 * (network error, 5xx, timeout) stays uncached so the next listing retries it,
 * otherwise a single blip would pin an author to a raw id until restart.
 */
const usernameCache = new Map<string, string>();

// POST /users/ids takes the whole batch at once; chunked anyway so a channel
// with hundreds of distinct authors cannot build an unbounded request body.
const BATCH_SIZE = 100;

/**
 * Maps every id to a username, falling back to the raw id when the profile is
 * unavailable — a missing author must never break a message listing.
 */
export async function resolveUsernames(
  client: TimeClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const unknownIds = uniqueIds.filter((id) => !usernameCache.has(id));

  for (let i = 0; i < unknownIds.length; i += BATCH_SIZE) {
    const batch = unknownIds.slice(i, i + BATCH_SIZE);

    try {
      const users = await client.getUsersByIds(batch);

      for (const user of users) {
        usernameCache.set(user.id, user.username || user.nickname || user.id);
      }

      // Ids the server answered about but did not return are deleted or
      // unreadable profiles — the batch equivalent of a 404. Cache them
      // negatively: asking again would return nothing either.
      for (const id of batch) {
        if (!usernameCache.has(id)) {
          usernameCache.set(id, id);
        }
      }
    } catch {
      // Transport error or 5xx: the profiles may well exist, so leave the
      // batch uncached and let the next call try again.
    }
  }

  return new Map(uniqueIds.map((id) => [id, usernameCache.get(id) ?? id]));
}

/** Test seam: the cache lives for the whole process, tests need a clean one. */
export function clearUsernameCache(): void {
  usernameCache.clear();
}
