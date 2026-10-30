import { describe, expect, it } from "vite-plus/test";

import { splitOpenUiMarkdown } from "./fences.ts";

describe("splitOpenUiMarkdown", () => {
  it("splits closed openui fences and leaves everything else as markdown", () => {
    const program = 'root = Stack([Stat("Open", "7")])';
    expect(splitOpenUiMarkdown(`Intro\n\n\`\`\`openui\n${program}\n\`\`\`\nAfter`)).toEqual([
      { kind: "markdown", markdown: "Intro\n\n", sourceOffset: 0 },
      { kind: "openui", source: program, sourceOffset: 7 },
      { kind: "markdown", markdown: "After", sourceOffset: 7 + 10 + program.length + 5 },
    ]);
    expect(splitOpenUiMarkdown(`~~~~ openui\n${program}\n~~~\n~~~~`)).toMatchObject([
      { kind: "openui", source: `${program}\n~~~` },
    ]);

    for (const markdown of [
      `\`\`\`openui\n${program}`, // still streaming
      `\`\`\`\`md\n\`\`\`openui\n${program}\n\`\`\`\n\`\`\`\``, // an example inside another fence
      `\`\`\`ts\nconst openui = 1;\n\`\`\``,
      `    \`\`\`openui\n    ${program}\n    \`\`\``, // indented code, not a fence
    ]) {
      expect(splitOpenUiMarkdown(markdown)).toEqual([
        { kind: "markdown", markdown, sourceOffset: 0 },
      ]);
    }
  });
});
