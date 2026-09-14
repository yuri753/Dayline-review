import test from "node:test";
import assert from "node:assert/strict";
import {feedbackUrl as buildFeedbackUrl, getOrCreateClientAccessLink, getOrCreateClientAccessKey} from "../src/commission-preview/client-access-link.js";

const config = {url: "https://project.supabase.co", key: "anon-key", feedbackBaseUrl: "https://review.example/"};
const feedbackUrl = key => buildFeedbackUrl(key, config.feedbackBaseUrl);

test('published site URL receives the capability as a query parameter', () => {
  assert.equal(buildFeedbackUrl('a b', 'https://review.example/revisao/?theme=dark'), 'https://review.example/revisao/?theme=dark&key=a+b');
  assert.throws(() => buildFeedbackUrl('key', ''), /Cole o endereço/);
});

test('video access remains available before the review site is published', async () => {
  const result = await getOrCreateClientAccessKey('commission', {config: {...config, feedbackBaseUrl: ''}, keyStore: store('existing-key'), fetchImpl: async () => response([{chave:'existing-key'}])});
  assert.deepEqual(result, {key:'existing-key', created:false});
});
function response(body, status = 200) {return {ok: status >= 200 && status < 300, status, json: async () => body};}
function store(initial = null) {
  let value = initial;
  return {get: () => value, set: (_url, _id, key) => {value = key;}};
}

test("reuses the existing commission key without inserting", async () => {
  const calls = [];
  const result = await getOrCreateClientAccessLink("commission-1", {config, keyStore: store("existing-uuid"), fetchImpl: async (...args) => {calls.push(args); return response([{chave: "existing-uuid"}]);}});
  assert.deepEqual(result, {key: "existing-uuid", url: feedbackUrl("existing-uuid"), created: false});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].headers["x-preview-key"], "existing-uuid");
});

test("creates one UUID and returns the feedback URL", async () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {configurable: true, value: {randomUUID: () => "generated-uuid"}});
  const calls = [];
  const keyStore = store();
  const result = await getOrCreateClientAccessLink("commission-2", {config, keyStore, fetchImpl: async (...args) => {calls.push(args); return calls.length === 1 ? response([]) : response(null, 201);}});
  assert.deepEqual(result, {key: "generated-uuid", url: feedbackUrl("generated-uuid"), created: true});
  assert.deepEqual(JSON.parse(calls[1][1].body), {chave: "generated-uuid", id_comissao: "commission-2"});
  assert.equal(keyStore.get(), "generated-uuid");
  assert.ok(calls.every(([, options]) => options.headers["x-preview-key"] === "generated-uuid"));
  Object.defineProperty(globalThis, "crypto", {configurable: true, value: originalCrypto});
});

test("an existing commission without its original capability cannot be claimed", async () => {
  const keyStore = store("different-key");
  const calls = [];
  await assert.rejects(getOrCreateClientAccessLink("commission-1", {config, keyStore, fetchImpl: async (...args) => {
    calls.push(args);
    return calls.length === 2 ? response(null, 409) : response([]);
  }}), /Recupere a chave original/);
  assert.equal(keyStore.get(), "different-key");
  assert.ok(calls.every(([, options]) => options.headers["x-preview-key"] === "different-key"));
});

test("network retries keep the same capability persisted before insertion", async () => {
  const keyStore = store();
  const keys = [];
  const options = {config, keyStore, fetchImpl: async (_url, options) => {
    keys.push(options.headers["x-preview-key"]);
    if (keys.length === 1) throw new Error("offline");
    return response([{chave: keyStore.get()}]);
  }};
  await assert.rejects(getOrCreateClientAccessLink("commission-1", options), /offline/);
  const saved = keyStore.get();
  const result = await getOrCreateClientAccessLink("commission-1", options);
  assert.equal(result.key, saved);
  assert.deepEqual(keys, [saved, saved]);
});
