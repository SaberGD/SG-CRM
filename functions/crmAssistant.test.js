const test = require("node:test");
const assert = require("node:assert/strict");
const { runTool, runAssistant } = require("./crmAssistant");

const NOW = Date.parse("2026-11-06T12:00:00+02:00");
const T0 = new Date(NOW).setHours(0, 0, 0, 0);
const mk = (o) => ({ status: "interested", salesAgentName: "تسنيم", ...o });
const clients = [
  mk({ id: "a", name: "منى أحمد", phone: "01012345678", nextFollowUpDate: T0 - 86400000, serviceName: "جرافيك" }),
  mk({ id: "b", name: "علي حسن", phone: "01199999999", nextFollowUpDate: T0 + 3600000 }),
  mk({ id: "c", name: "سارة", phone: "01233333333" }),
  mk({ id: "d", name: "كريم", status: "booked", isBooked: true, bookedCourseName: "ادفانسد", totalPrice: 3700, paidAmount: 1000, remainingAmount: 2700, salesAgentName: "علياء", accounting: { bookings: { b1: { courseName: "ادفانسد", status: "ACTIVE", total: 3700, paid: 1000, remaining: 2700, nextDueDate: "2026-11-20" } } } }),
];
const data = { clients, followupsFor: async (id) => (id === "a" ? [{ timestamp: 1, agentName: "تسنيم", note: "اتصلت", method: "phone" }, { timestamp: 5, agentName: "تسنيم", note: "رد واتساب" }] : []) };
const sales = { uid: "u1", role: "sales_agent" }; const lead = { uid: "m1", role: "supervisor" };

test("find by name, by phone digits, and the no-follow-up filter", async () => {
  const byName = JSON.parse(await runTool("find_clients", { text: "منى" }, data, sales, NOW));
  assert.equal(byName.total, 1); assert.equal(byName.clients[0].id, "a");
  const byPhone = JSON.parse(await runTool("find_clients", { text: "01199999999" }, data, sales, NOW));
  assert.equal(byPhone.clients[0].id, "b");
  const none = JSON.parse(await runTool("find_clients", { no_next_followup: true }, data, sales, NOW));
  assert.deepEqual(none.clients.map((c) => c.id), ["c"]);
});

test("my_day buckets overdue / today / no date", async () => {
  const d = JSON.parse(await runTool("my_day", {}, data, sales, NOW));
  assert.deepEqual(d.counts, { overdue: 1, today: 1, noNextFollowUp: 1 });
  assert.equal(d.scope, "عملاءك");
});

test("get_client returns accounting bookings and newest follow-up first; unknown id is refused", async () => {
  const g = JSON.parse(await runTool("get_client", { id: "a" }, data, sales, NOW));
  assert.equal(g.recentFollowUps[0].note, "رد واتساب");
  const k = JSON.parse(await runTool("get_client", { id: "d" }, data, sales, NOW));
  assert.equal(k.accountingBookings[0].remaining, 2700);
  assert.match(JSON.parse(await runTool("get_client", { id: "zzz" }, data, sales, NOW)).error, /مش لاقي/);
});

test("agent grouping and agent filter are for leaders only", async () => {
  assert.match(JSON.parse(await runTool("count_clients", { group_by: "agent" }, data, sales, NOW)).error, /للقيادات/);
  const g = JSON.parse(await runTool("count_clients", { group_by: "agent" }, data, lead, NOW));
  assert.equal(g.groups[0].count, 3);
  const f = JSON.parse(await runTool("find_clients", { agent: "علياء" }, data, sales, NOW));
  assert.equal(f.total, 4); // sales cannot filter by agent: the filter is ignored
});

test("assistant loop: tool call, then a plain-text answer; tool results go back to the model", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    const content = calls.length === 1
      ? [{ type: "tool_use", id: "t1", name: "my_day", input: {} }]
      : [{ type: "text", text: "عندك 1 متأخر: [منى أحمد](client:a)" }];
    return { ok: true, json: async () => ({ content, usage: { input_tokens: 50, output_tokens: 20 } }), text: async () => "" };
  };
  const r = await runAssistant({ messages: [{ role: "user", content: "إيه شغلي النهارده؟" }], apiKey: "k", data, user: sales, fetchImpl, now: NOW });
  assert.match(r.reply, /client:a/); assert.equal(r.usage.turns, 2); assert.equal(r.usage.inputTokens, 100);
  assert.equal(calls[1].messages.at(-1).content[0].type, "tool_result");
  assert.equal(calls[0].model, "claude-haiku-5-5");
  await assert.rejects(() => runAssistant({ messages: [{ role: "assistant", content: "x" }], apiKey: "k", data, user: sales, fetchImpl }), /user/);
});
