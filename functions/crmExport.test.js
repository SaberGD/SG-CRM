const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeDoc, isExportable, pageSize } = require("./crmExport");

test("contact details and free text are removed from clients", () => {
  const d = sanitizeDoc("clients", "c1", { name: "x", phone: "010", phoneKey: "10", notes: "private", status: "booked", paidAmount: 5, aiRecommendation: { a: 1 }, source: "messenger" });
  assert.deepEqual(d, { id: "c1", name: "x", status: "booked", paidAmount: 5, source: "messenger" });
});
test("users export only role/name, never email", () => {
  assert.deepEqual(sanitizeDoc("users", "u1", { name: "a", email: "a@b.c", role: "sales_agent", isDeactivated: false }), { id: "u1", name: "a", role: "sales_agent", isDeactivated: false });
});
test("only whitelisted collections and bounded page sizes", () => {
  assert.equal(isExportable("clients"), true); assert.equal(isExportable("invitations"), false); assert.equal(isExportable("allowed_users"), false);
  assert.equal(pageSize(99999), 1000); assert.equal(pageSize(0), 1000); assert.equal(pageSize(50), 50);
});
