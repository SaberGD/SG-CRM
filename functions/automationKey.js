// Checks the automation key that n8n sends in the "x-automation-secret" header.
// The key itself lives only in the n8n credential. This repo is public, so the code keeps
// just the SHA-256 of the key: a random 256-bit key cannot be recovered from its hash.
// To rotate: make a new random key (32+ random bytes), put it in the n8n credential, put its
// SHA-256 here, then deploy.
const crypto = require("crypto");

const AUTOMATION_KEY_SHA256 = "98d57cf4cb6fca518ba223b844e8e54e4a903d2ec0b315b0a79ed8ca3b26b8ee";

const sha256 = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest();
const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

/** True when `provided` is the automation key. */
function automationKeyOk(provided, expectedSha256 = AUTOMATION_KEY_SHA256) {
  if (typeof provided !== "string" || provided.length < 20 || provided.length > 200) return false;
  return sameBytes(sha256(provided), Buffer.from(expectedSha256, "hex"));
}

module.exports = { automationKeyOk, AUTOMATION_KEY_SHA256 };
