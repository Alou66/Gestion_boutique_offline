// tests/searchable-select.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// src/components/searchable-select.ts
function normalizeSearchText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
function filterSelectOptions(options, query) {
  const normalized = normalizeSearchText(query);
  if (normalized === "") {
    return options;
  }
  return options.filter((option) => {
    const haystack = `${normalizeSearchText(option.label)} ${normalizeSearchText(
      option.hint ?? ""
    )}`;
    return haystack.includes(normalized);
  });
}

// tests/searchable-select.test.ts
function buildOption(overrides = {}) {
  return {
    value: "1",
    label: "SUCRE 1 KG",
    ...overrides
  };
}
describe("recherche du champ \xE0 choix", () => {
  it("normalise la casse, les accents et les espaces", () => {
    assert.equal(normalizeSearchText("  \xC9COUTEURS  "), "ecouteurs");
    assert.equal(normalizeSearchText("Lait concentr\xE9"), "lait concentre");
    assert.equal(normalizeSearchText("\xC0\xC9\xCE\xD5\xDC"), "aeiou");
    assert.equal(normalizeSearchText(""), "");
  });
  it("retourne toutes les options sans recherche", () => {
    const options = [buildOption(), buildOption({ value: "2", label: "HUILE" })];
    assert.deepEqual(filterSelectOptions(options, ""), options);
    assert.deepEqual(filterSelectOptions(options, "   "), options);
  });
  it("cherche sans tenir compte de la casse", () => {
    const options = [buildOption()];
    assert.deepEqual(filterSelectOptions(options, "sucre"), options);
    assert.deepEqual(filterSelectOptions(options, "SUCRE"), options);
    assert.deepEqual(filterSelectOptions(options, "SuCre 1"), options);
    assert.deepEqual(filterSelectOptions(options, "KG"), options);
  });
  it("cherche dans l\u2019indice, pas seulement le libell\xE9", () => {
    const options = [
      buildOption({ hint: "BOISSONS \u2014 771234567" }),
      buildOption({ value: "2", label: "RIZ", hint: "EPICERIE" })
    ];
    assert.deepEqual(filterSelectOptions(options, "boissons"), [options[0]]);
    assert.deepEqual(filterSelectOptions(options, "77123"), [options[0]]);
    assert.deepEqual(filterSelectOptions(options, "epicerie"), [options[1]]);
  });
  it("ignore les accents de part et d\u2019autre", () => {
    const options = [buildOption({ label: "LAIT CONCENTR\xC9" })];
    assert.deepEqual(filterSelectOptions(options, "concentre"), options);
    assert.deepEqual(filterSelectOptions(options, "CONCENTR\xC9"), options);
  });
  it("\xE9carte les options qui ne correspondent pas", () => {
    const options = [buildOption(), buildOption({ value: "2", label: "HUILE" })];
    assert.deepEqual(filterSelectOptions(options, "sel"), []);
    assert.deepEqual(filterSelectOptions(options, "sucre huile"), []);
  });
  it("garde l\u2019ordre et les options sans indice", () => {
    const options = [
      buildOption(),
      buildOption({ value: "2", label: "SUCRE 2 KG" }),
      buildOption({ value: "3", label: "HUILE", hint: void 0 })
    ];
    assert.deepEqual(filterSelectOptions(options, "sucre"), [
      options[0],
      options[1]
    ]);
  });
});
