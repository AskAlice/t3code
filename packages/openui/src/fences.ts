export type OpenUiMarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string; readonly sourceOffset: number }
  | { readonly kind: "openui"; readonly source: string; readonly sourceOffset: number };

const OPEN_FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*openui(?:[ \t][^\n]*)?$/;

/**
 * Splits closed top-level ```openui fences out of markdown, for renderers that cannot route
 * code blocks by language. An unclosed fence (still streaming) stays markdown.
 */
export function splitOpenUiMarkdown(markdown: string): ReadonlyArray<OpenUiMarkdownSegment> {
  if (!markdown.includes("openui")) return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  const segments: OpenUiMarkdownSegment[] = [];
  const lines = markdown.split("\n");
  let cursor = 0;
  let offset = 0;
  let open: { readonly start: number; readonly bodyStart: number; readonly fence: string } | null =
    null;
  let outerFence: string | null = null;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    const text = line.replace(/\r$/, "");
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (open !== null) {
      if (
        fence !== undefined &&
        fence[0] === open.fence[0] &&
        fence.length >= open.fence.length &&
        text.trim() === fence
      ) {
        if (open.start > cursor) {
          segments.push({
            kind: "markdown",
            markdown: markdown.slice(cursor, open.start),
            sourceOffset: cursor,
          });
        }
        segments.push({
          kind: "openui",
          source: markdown.slice(open.bodyStart, Math.max(open.bodyStart, offset - 1)),
          sourceOffset: open.start,
        });
        cursor = Math.min(markdown.length, lineEnd + 1);
        open = null;
      }
    } else if (outerFence !== null) {
      if (
        fence !== undefined &&
        fence[0] === outerFence[0] &&
        fence.length >= outerFence.length &&
        text.trim() === fence
      )
        outerFence = null;
    } else {
      const opening = OPEN_FENCE.exec(text);
      if (opening) open = { start: offset, bodyStart: lineEnd + 1, fence: opening[2]! };
      else if (fence) outerFence = fence;
    }
    offset = lineEnd + 1;
  }
  if (segments.length === 0) return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  if (cursor < markdown.length) {
    segments.push({ kind: "markdown", markdown: markdown.slice(cursor), sourceOffset: cursor });
  }
  return segments;
}
