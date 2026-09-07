/** A single ADF text node. */
export interface AdfText {
  type: "text";
  text: string;
}

/** A single ADF paragraph node. */
export interface AdfParagraph {
  type: "paragraph";
  content: AdfText[];
}

/** A minimal ADF document (doc -> paragraphs). */
export interface AdfDoc {
  type: "doc";
  version: 1;
  content: AdfParagraph[];
}

/** Recursive node shape used by adfToText. */
interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Wrap plain text as a minimal Atlassian Document Format (ADF) paragraph doc. */
export function textToAdf(text: string): AdfDoc {
  return {
    type: "doc",
    version: 1,
    content: String(text ?? "")
      .split(/\n{2,}/)
      .map((paragraph) => ({
        type: "paragraph",
        content: paragraph ? [{ type: "text", text: paragraph }] : [],
      })),
  };
}

/** Best-effort flatten of an ADF doc back to plain text, for display purposes only (lossy). */
export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  const record = node as AdfNode;
  if (typeof record.text === "string") return record.text;

  const children = Array.isArray(record.content) ? record.content : [];
  const rendered = children.map(adfToText);

  if (record.type === "paragraph") return rendered.join("");
  if (record.type === "doc") return rendered.join("\n\n");
  return rendered.join("");
}

/** Accept either plain text or a pre-built ADF object, normalizing to ADF for the API. */
export function toAdfBody(value: unknown): AdfDoc | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return textToAdf(value);
  if (typeof value === "object" && (value as AdfDoc).type === "doc") return value as AdfDoc;
  throw new Error("Expected a plain text string or an ADF document object.");
}
