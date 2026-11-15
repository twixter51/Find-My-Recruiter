const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { paidSearch, hasUnlimitedCredits } = require("../backend/dist/credits");
const { requireUser, sameOrigin, credentials, setSession } = require("../backend/dist/auth");

// These tests exercise the backend boundary without real credentials or API spend.
test("only the configured owner bypasses credit storage", async () => {
  const owner = "e2c5177d-a77e-431c-b53a-3fd0b414cac9";
  assert.equal(hasUnlimitedCredits(owner), true);
  assert.equal(hasUnlimitedCredits(randomUUID()), false);
  assert.equal(hasUnlimitedCredits(""), false);
  const original = global.fetch;
  global.fetch = async () => { throw new Error("Credit storage must not be called"); };

  try {
    const result = await paidSearch(owner, randomUUID(), ["recruiters"], async () => ({ results: [] }));
    assert.deepEqual(result, { results: [], unlimited: true });
    await assert.rejects(paidSearch(owner, randomUUID(), [], async () => {
      throw new Error("Search failed");
    }), /Search failed/);
  } finally {
    global.fetch = original;
  }
});

test("credentials and request origins are validated", () => {
  assert.throws(() => credentials({ email: "bad", password: "12345678" }));
  assert.throws(() => credentials({ email: "a@example.com", password: "short" }));
  assert.equal(credentials({ email: " a@example.com ", password: "longpassword" }).email, "a@example.com");
  process.env.APP_ORIGIN = "https://app.example";
  assert.throws(() => sameOrigin({ method: "POST", headers: { origin: "https://evil.example" } }, {}, () => {}));
  let next = false;
  sameOrigin({ method: "POST", headers: { origin: "https://app.example" } }, {}, () => { next = true; });
  assert.equal(next, true);
});

test("missing or unconfirmed sessions cannot authorize a search", async () => {
  await assert.rejects(requireUser({ headers: {} }, { locals: {} }, () => {}), /Sign up/);
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable";
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "user", email_confirmed_at: null }) });
  try {
    await assert.rejects(requireUser({ headers: { cookie: "fmr_session=token" } }, { locals: {} }, () => {}), /Confirm/);
  } finally {
    global.fetch = original;
  }
});

test("production cookie is HttpOnly, Secure, and SameSite", () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let options;
  setSession({ cookie: (_name, _value, settings) => { options = settings; } }, "token", 3600);
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "strict");
  if (old === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = old;
  }
});

test("credits gate provider calls, replay completed results, and refund failures once", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const original = global.fetch;
  let balance = 2;
  let providerCalls = 0;
  const ledger = new Map();
  global.fetch = async (url, options) => {
    const args = JSON.parse(options.body);
    const key = args.p_user + args.p_request;
    let data;
    if (String(url).endsWith("claim_search")) {
      const existing = ledger.get(key);
      if (existing) {
        data = { ...existing, credits: balance };
      } else if (!balance) {
        data = { state: "empty", credits: 0 };
      } else {
        balance -= 1;
        ledger.set(key, { state: "pending" });
        data = { state: "claimed", credits: balance };
      }
    } else {
      const row = ledger.get(key);
      if (row.state === "pending") {
        if (!args.p_success) {
          balance += 1;
          row.state = "failed";
        } else {
          row.state = "complete";
        }
        row.result = args.p_result;
      }
      data = balance;
    }
    return { ok: true, json: async () => data };
  };
  try {
    const provider = async () => { providerCalls += 1; return { recruiters: [] }; };
    const id = randomUUID();
    const results = await Promise.allSettled([
      paidSearch("user", id, ["query"], provider),
      paidSearch("user", id, ["query"], provider),
    ]);
    assert.equal(providerCalls, 1);
    assert.ok(results.some(result => result.status === "fulfilled"));
    assert.equal((await paidSearch("user", id, ["query"], provider)).credits, 1);
    assert.equal(providerCalls, 1);
    await assert.rejects(paidSearch("user", randomUUID(), [], async () => { throw new Error("Provider failed"); }));
    assert.equal(balance, 1);
    await paidSearch("user", randomUUID(), [], provider);
    await assert.rejects(paidSearch("user", randomUUID(), [], provider), /No search credits/);
    assert.equal(providerCalls, 2);
    assert.equal(balance, 0);
    await assert.rejects(paidSearch("user", "invalid", [], provider), /request ID/);
  } finally {
    global.fetch = original;
  }
});

test("cannot spend when the credit database fails", async () => {
  const original = global.fetch;
  let called = false;
  global.fetch = async () => ({ ok: false });
  try {
    await assert.rejects(paidSearch("user", randomUUID(), [], async () => { called = true; }), /credits/);
    assert.equal(called, false);
  } finally {
    global.fetch = original;
  }
});
