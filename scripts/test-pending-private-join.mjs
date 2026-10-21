import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/lib/pendingPrivateJoin.ts'], bundle: true,
  write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const flow = module.exports;
const store = new Map();
let onBack;
globalThis.window = { location: { origin: 'https://lms.example.test' }, addEventListener: (_, callback) => { onBack = callback; } };
globalThis.sessionStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: key => store.delete(key),
};
const key = 'fcc_pending_private_join_v1';
const path = '/private/join?code=FCCLMS&utm_content=whiteboard#invite';

assert.equal(flow.authorizePrivateJoin(undefined, path, 'player'), null, 'login alone cannot create intent');
flow.cancelPrivateJoin(undefined);
let id = flow.rememberPrivateJoin(path);
assert.ok(id);
flow.retainPrivateJoin(id, path); // StrictMode may retain twice.
flow.retainPrivateJoin(id, path);
assert.equal(flow.authorizePrivateJoin(id, path, 'player'), id);
flow.cancelPrivateJoin(id); // Successful login unmount must preserve the authorized handoff.
assert.equal(flow.consumePrivateJoin(id, path), 'player');
assert.equal(flow.consumePrivateJoin(id, path), null, 'claim must be one-use even if the request fails');

id = flow.rememberPrivateJoin(path);
flow.authorizePrivateJoin(id, path, 'player');
assert.equal(flow.consumePrivateJoin(id, path, 'OTHER'), null, 'loaded preview must match the intent code');

id = flow.rememberPrivateJoin(path);
assert.equal(flow.consumePrivateJoin(id, path), null, 'return before profile completion is not authorized');
assert.equal(flow.authorizePrivateJoin(id, path, 'player'), null);

id = flow.rememberPrivateJoin(path);
flow.cancelPrivateJoin(id);
assert.equal(flow.authorizePrivateJoin(id, path, 'player'), null, 'cancelled login cannot resume');

id = flow.rememberPrivateJoin(path);
onBack();
assert.equal(flow.authorizePrivateJoin(id, path, 'player'), null, 'Back before login mounts cancels the intent');

for (const otherPath of ['/private/join?code=OTHER', '/private/join?code=FCCLMS&utm_content=original', '/make-pick']) {
  id = flow.rememberPrivateJoin(path);
  assert.equal(flow.authorizePrivateJoin(id, otherPath, 'player'), null, 'must match the full invitation and attribution');
  assert.equal(store.has(key), false);
}
id = flow.rememberPrivateJoin(path);
flow.retainPrivateJoin(undefined, path);
assert.equal(flow.authorizePrivateJoin(id, path, 'player'), null, 'a copied login URL lacks the history nonce');

id = flow.rememberPrivateJoin(path);
const stale = JSON.parse(store.get(key));
store.set(key, JSON.stringify({ ...stale, createdAt: Date.now() - 16 * 60 * 1000 }));
assert.equal(flow.authorizePrivateJoin(id, path, 'player'), null, 'intent expires after 15 minutes');
store.set(key, '{bad json');
assert.equal(flow.consumePrivateJoin('anything', path), null);

for (const unsafe of ['https://evil.test/private/join?code=FCCLMS', '//evil.test/private/join?code=FCCLMS',
  '/\\evil.test/private/join?code=FCCLMS', '/login', '/private/join?code=FCCLMS&code=OTHER']) {
  assert.equal(flow.rememberPrivateJoin(unsafe), null);
}
sessionStorage.setItem = () => { throw new Error('Blocked storage'); };
assert.equal(flow.rememberPrivateJoin(path), null);
assert.equal(flow.consumePrivateJoin(undefined, path), null);
console.log('PASS: explicit intent, profile authorization, one-use claim, cancellation, expiry, exact URL binding, history nonce and storage failure.');
