const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reserveUsage, reserveProviderCall, accountLimit } = require("../backend/dist/usage-limits");

test("usage guards reject exhausted limits and database outages", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => false });
    await assert.rejects(reserveUsage("test", 1, 60), (error) => error.status === 429);
    global.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(reserveProviderCall(), (error) => error.status === 503);
  } finally {
    global.fetch = original;
  }
});

test("account and provider limits use server-owned buckets", async () => {
  const original = global.fetch;
  const oldLimit = process.env.SERPER_DAILY_REQUEST_LIMIT;
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => true };
  };
  try {
    let passed = false;
    await accountLimit({}, { locals: { user: { id: "verified-user" } } }, () => { passed = true; });
    assert.equal(passed, true);
    assert.deepEqual(calls[0], { p_bucket: "account:verified-user", p_limit: 20, p_seconds: 60 });
    process.env.SERPER_DAILY_REQUEST_LIMIT = "50";
    await reserveProviderCall();
    assert.deepEqual(calls[1], { p_bucket: "serper:daily", p_limit: 50, p_seconds: 86400 });
    process.env.SERPER_DAILY_REQUEST_LIMIT = "invalid";
    await assert.rejects(reserveProviderCall(), (error) => error.status === 503);
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = original;
    if (oldLimit === undefined) {
      delete process.env.SERPER_DAILY_REQUEST_LIMIT;
    } else {
      process.env.SERPER_DAILY_REQUEST_LIMIT = oldLimit;
    }
  }
});
