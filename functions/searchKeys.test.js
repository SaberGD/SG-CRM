const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const load = () => import(path.join(__dirname, "searchKeys.mjs"));

test("any word start of the name, Arabic variants unified", async () => {
  const { buildSearchKeys, searchTerm, matchesSearch } = await load();
  const keys = buildSearchKeys("أسماء حسن الحوفى", "+201012345678");
  for (const k of ["اس", "اسما", "اسماء", "حس", "حسن", "الحوفي", "5678", "1012345678"]) assert.ok(keys.includes(k), k);
  assert.equal(searchTerm("إسماء"), "اسماء");
  assert.equal(searchTerm("حسن الحوفي"), "الحوفي");
  assert.equal(searchTerm("0101 234 5678"), "1012345678");
  assert.equal(searchTerm("5678"), "5678");
  assert.equal(matchesSearch({ name: "أسماء حسن الحوفى" }, "اسماء الحوف"), true);
  assert.equal(matchesSearch({ name: "أسماء حسن" }, "منى"), false);
  assert.equal(matchesSearch({ name: "x", phone: "01012345678" }, "345678"), true);
});

test("keys stay bounded for long names and ignore 1-letter words", async () => {
  const { buildSearchKeys } = await load();
  const keys = buildSearchKeys("عبدالرحمنعبدالعزيزالمحمدي و ا", "");
  assert.ok(keys.length <= 14);
  assert.ok(!keys.includes("و"));
});

test("decorative letters outside the basic plane are never split", async () => {
  const { buildSearchKeys, searchTerm } = await load();
  const keys = buildSearchKeys("\u{1D4E2}\u{1D4EA}\u{1D4FB}\u{1D4EA} علي", "");
  for (const k of keys) assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(k), "lone surrogate in " + k);
  assert.ok(keys.includes("عل"));
  assert.equal([...searchTerm("\u{1D4E2}\u{1D4EA}")].length, 2);
});
