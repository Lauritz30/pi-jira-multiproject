import { test } from "node:test";
import assert from "node:assert/strict";
import { textToAdf, adfToText, toAdfBody } from "../src/adf.ts";

test("textToAdf wraps a single paragraph", () => {
  const doc = textToAdf("Hello world");
  assert.equal(doc.type, "doc");
  assert.equal(doc.version, 1);
  assert.equal(doc.content.length, 1);
  assert.deepEqual(doc.content[0], { type: "paragraph", content: [{ type: "text", text: "Hello world" }] });
});

test("textToAdf splits on blank lines into multiple paragraphs", () => {
  const doc = textToAdf("First paragraph\n\nSecond paragraph");
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0].content[0].text, "First paragraph");
  assert.equal(doc.content[1].content[0].text, "Second paragraph");
});

test("textToAdf handles empty string", () => {
  const doc = textToAdf("");
  assert.equal(doc.content.length, 1);
  assert.deepEqual(doc.content[0], { type: "paragraph", content: [] });
});

test("adfToText flattens a doc back to text", () => {
  const doc = textToAdf("First paragraph\n\nSecond paragraph");
  assert.equal(adfToText(doc), "First paragraph\n\nSecond paragraph");
});

test("adfToText handles null/undefined gracefully", () => {
  assert.equal(adfToText(undefined), "");
  assert.equal(adfToText(null), "");
});

test("toAdfBody wraps plain strings", () => {
  const body = toAdfBody("hello");
  assert.equal(body?.type, "doc");
});

test("toAdfBody passes through existing ADF documents unchanged", () => {
  const doc = { type: "doc", version: 1, content: [] } as const;
  assert.equal(toAdfBody(doc), doc);
});

test("toAdfBody returns undefined for null/undefined input", () => {
  assert.equal(toAdfBody(undefined), undefined);
  assert.equal(toAdfBody(null), undefined);
});

test("toAdfBody rejects unsupported input", () => {
  assert.throws(() => toAdfBody(42), /Expected a plain text string or an ADF document/);
});
