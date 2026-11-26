// @vitest-environment jsdom
import { test, expect, vi } from 'vitest';

vi.mock('./idb.js', () => ({ LocalDb: class {
  async all() { return []; }
  async getMeta() { return null; }
  async put() {}
  async setMeta() {}
} }));
vi.mock('./api.js', () => ({ api: vi.fn(), uploadFile: vi.fn() }));
vi.mock('./compress.js', () => ({ prepareForUpload: vi.fn() }));

test('a rejected deletion stays pending and cannot be replaced by the next pull', async () => {
  const { api } = await import('./api.js');
  const { store } = await import('./store.svelte.js');
  const pull = { user_id: 'test-owner', notes: [], events: [], cursor: 1, more: false };
  api.mockResolvedValue(pull);
  await store.open('test-owner');
  await vi.waitFor(() => expect(store.syncing).toBe(false));
  const note = store.create('notes', { title: 'Pending deletion' });
  api.mockImplementation(async (_path, options) => options?.method === 'POST'
    ? { saved: {}, rejected: [{ id: note.id, error: 'invalid field' }] }
    : { ...pull, notes: [{ ...note, deleted_at: null }] });
  store.remove('notes', note.id);
  await vi.waitFor(() => expect(store.syncing).toBe(false));
  expect(store.isPending('notes', note.id)).toBe(true);
  expect(store.find('notes', note.id).deleted_at).toBeTruthy();
  expect(store.error).toContain('invalid field');
  await store.sync(true);
  expect(store.find('notes', note.id).deleted_at).toBeTruthy();
  expect(store.error).toContain('invalid field');
  // A rejection of an older edit must not acknowledge a newer deletion.
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  api.mockImplementationOnce(() => response);
  const syncing = store.sync();
  store.update('notes', note.id, { body: 'newer local edit' });
  store.remove('notes', note.id);
  api.mockImplementation(async (_path, options) => options?.method === 'POST'
    ? { saved: { notes: options.body.notes }, rejected: [] }
    : { ...pull, notes: [] });
  release({ saved: {}, rejected: [{ id: note.id, error: 'old rejection' }] });
  await syncing;
  await vi.waitFor(() => expect(store.syncing).toBe(false));
  expect(store.find('notes', note.id).deleted_at).toBeTruthy();
  expect(store.find('notes', note.id).body).toBe('newer local edit');
  expect(store.isPending('notes', note.id)).toBe(false);
  store.close();
});
