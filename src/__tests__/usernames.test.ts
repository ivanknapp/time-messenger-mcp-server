import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveUsernames, clearUsernameCache } from '../tools/usernames.js';
import { resolveAuthors } from '../tools/messages.js';
import type { TimeClient } from '../client/time-client.js';
import type { Post, User } from '../types/time-api.js';

function createClient(getUsersByIds: ReturnType<typeof vi.fn>): TimeClient {
  return { getUsersByIds } as unknown as TimeClient;
}

const user = (id: string, username: string): User => ({ id, username } as User);

describe('resolveUsernames', () => {
  beforeEach(() => {
    clearUsernameCache();
  });

  it('resolves every id in a single batch request', async () => {
    const getUsersByIds = vi
      .fn()
      .mockResolvedValue([user('u1', 'alice'), user('u2', 'bob')]);

    const names = await resolveUsernames(createClient(getUsersByIds), ['u1', 'u2', 'u1']);

    expect(getUsersByIds).toHaveBeenCalledTimes(1);
    expect(getUsersByIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(names.get('u1')).toBe('alice');
    expect(names.get('u2')).toBe('bob');
  });

  it('falls back to nickname, then to the raw id', async () => {
    const getUsersByIds = vi.fn().mockResolvedValue([
      { id: 'u1', username: '', nickname: 'Nick' } as User,
      { id: 'u2', username: '', nickname: '' } as User,
    ]);

    const names = await resolveUsernames(createClient(getUsersByIds), ['u1', 'u2']);

    expect(names.get('u1')).toBe('Nick');
    expect(names.get('u2')).toBe('u2');
  });

  it('does not re-request ids that are already cached', async () => {
    const getUsersByIds = vi.fn().mockResolvedValue([user('u1', 'alice')]);
    const client = createClient(getUsersByIds);

    await resolveUsernames(client, ['u1']);
    const names = await resolveUsernames(client, ['u1']);

    expect(getUsersByIds).toHaveBeenCalledTimes(1);
    expect(names.get('u1')).toBe('alice');
  });

  it('caches ids the server did not return — a deleted profile is not asked about twice', async () => {
    const getUsersByIds = vi.fn().mockResolvedValue([user('u1', 'alice')]);
    const client = createClient(getUsersByIds);

    const first = await resolveUsernames(client, ['u1', 'gone']);
    const second = await resolveUsernames(client, ['gone']);

    expect(first.get('gone')).toBe('gone');
    expect(second.get('gone')).toBe('gone');
    expect(getUsersByIds).toHaveBeenCalledTimes(1);
  });

  it('leaves the batch uncached when the request fails, so the next call retries', async () => {
    const getUsersByIds = vi
      .fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce([user('u1', 'alice')]);
    const client = createClient(getUsersByIds);

    const afterFailure = await resolveUsernames(client, ['u1']);
    const afterRetry = await resolveUsernames(client, ['u1']);

    expect(afterFailure.get('u1')).toBe('u1');
    expect(afterRetry.get('u1')).toBe('alice');
    expect(getUsersByIds).toHaveBeenCalledTimes(2);
  });

  it('splits large author lists into batches of 100', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    const getUsersByIds = vi
      .fn()
      .mockImplementation(async (batch: string[]) => batch.map((id) => user(id, `name-${id}`)));

    const names = await resolveUsernames(createClient(getUsersByIds), ids);

    expect(getUsersByIds).toHaveBeenCalledTimes(2);
    expect(getUsersByIds.mock.calls[0][0]).toHaveLength(100);
    expect(getUsersByIds.mock.calls[1][0]).toHaveLength(50);
    expect(names.get('u149')).toBe('name-u149');
  });

  it('ignores empty ids', async () => {
    const getUsersByIds = vi.fn().mockResolvedValue([]);

    await resolveUsernames(createClient(getUsersByIds), ['', '']);

    expect(getUsersByIds).not.toHaveBeenCalled();
  });
});

describe('resolveAuthors', () => {
  beforeEach(() => {
    clearUsernameCache();
  });

  it('resolves post authors through the shared cache', async () => {
    const getUsersByIds = vi.fn().mockResolvedValue([user('u1', 'alice')]);
    const posts = [
      { id: 'p1', user_id: 'u1' } as Post,
      { id: 'p2', user_id: 'u1' } as Post,
    ];

    const authors = await resolveAuthors(createClient(getUsersByIds), posts);

    expect(getUsersByIds).toHaveBeenCalledWith(['u1']);
    expect(authors.get('u1')).toBe('alice');
  });
});
