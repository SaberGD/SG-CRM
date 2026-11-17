const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { automationKeyOk, AUTOMATION_KEY_SHA256 } = require("./automationKey");

const key = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(key).digest("hex");

test("accepts the key whose hash is stored", () => {
  assert.strictEqual(automationKeyOk(key, "", hash), true);
});

test("rejects a wrong, empty, short, huge or non-string key", () => {
  const other = crypto.randomBytes(32).toString("base64url");
  assert.strictEqual(automationKeyOk(other, "", hash), false);
  assert.strictEqual(automationKeyOk("", "", hash), false);
  assert.strictEqual(automationKeyOk("short", "", hash), false);
  assert.strictEqual(automationKeyOk("x".repeat(500), "", hash), false);
  assert.strictEqual(automationKeyOk(undefined, "", hash), false);
  assert.strictEqual(automationKeyOk(["a"], "", hash), false);
  assert.strictEqual(automationKeyOk(hash, "", hash), false);
});

test("accepts the legacy key only when one is configured", () => {
  const legacy = crypto.randomBytes(32).toString("base64url");
  assert.strictEqual(automationKeyOk(legacy, legacy, hash), true);
  assert.strictEqual(automationKeyOk(legacy, "", hash), false);
  assert.strictEqual(automationKeyOk("", "", hash), false);
});

test("the stored hash is a sha256 hex string", () => {
  assert.match(AUTOMATION_KEY_SHA256, /^[0-9a-f]{64}$/);
});
