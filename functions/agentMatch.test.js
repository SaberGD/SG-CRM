const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAgentName, normalizeAliasMap, matchAgent } = require("./agentMatch");

// Generic placeholder staff (not real people).
const users = [
  { id: "u1", name: "Sara Ahmed", email: "sara.a@example.invalid" },
  { id: "u2", name: "Sara Mahmoud", email: "sara.m@example.invalid" },
  { id: "u3", name: "منى علي", email: "mona@example.invalid" },
  { id: "u4", name: "Omar", email: "omar@example.invalid" },
  { id: "u5", name: "Old Agent", email: "old@example.invalid", isDeactivated: true },
  { id: "u6", name: "Ali Hassan", email: "ali.h@example.invalid" },
  { id: "u7", name: "Alina Samir", email: "alina@example.invalid" },
];

test("normalisation unifies Arabic spelling and case", () => {
  assert.equal(normalizeAgentName("  مُنى  عليّ "), normalizeAgentName("منى علي"));
  assert.equal(normalizeAgentName("أحمد"), normalizeAgentName("احمد"));
  assert.equal(normalizeAgentName("SARA-Ahmed"), "sara ahmed");
});

test("exact name / e-mail / e-mail local part match first", () => {
  assert.deepEqual(matchAgent(users, "Sara Ahmed"), { id: "u1", name: "Sara Ahmed" });
  assert.deepEqual(matchAgent(users, "منى على"), { id: "u3", name: "منى علي" });
  assert.equal(matchAgent(users, "sara.m@example.invalid").id, "u2");
  assert.equal(matchAgent(users, "omar").id, "u4");
});

test("whole-word prefix match either way, never a substring inside a word", () => {
  assert.equal(matchAgent(users, "منى").id, "u3");
  assert.equal(matchAgent(users, "Omar Khaled").id, "u4");
  assert.equal(matchAgent(users, "Ali").id, "u6", "Ali does not match Alina");
  assert.equal(matchAgent(users, "Ahmed Sara").id, "u1", "same words in another order");
  assert.equal(matchAgent(users, "mar"), null);
});

test("two users matching equally -> nobody (caller uses the default agent)", () => {
  assert.equal(matchAgent(users, "Sara"), null);
});

test("deactivated users and empty names never match", () => {
  assert.equal(matchAgent(users, "Old Agent"), null);
  assert.equal(matchAgent(users, ""), null);
  assert.equal(matchAgent(users, "   "), null);
});

test("aliases map another system's spelling to a uid or a CRM name", () => {
  const aliases = normalizeAliasMap({ aliases: { "S. Ahmed": "u1", "مني": "منى علي", "Gone": "u5", "": "u1", "Bad": 7 } });
  assert.equal(aliases.size, 3);
  assert.equal(matchAgent(users, "s ahmed", aliases).id, "u1");
  assert.equal(matchAgent(users, "مني", aliases).id, "u3");
  assert.equal(matchAgent(users, "Gone", aliases), null, "an alias to a deactivated uid does not match");
  assert.equal(matchAgent(users, "Sara Ahmed", new Map()).id, "u1", "works without any alias doc");
  assert.equal(normalizeAliasMap(null).size, 0);
  assert.equal(normalizeAliasMap({ "Sara A": "u1" }).size, 1, "a bare map is accepted too");
});
