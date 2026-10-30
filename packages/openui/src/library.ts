import {
  action,
  createLibrary,
  createParser,
  defineComponent,
  markReactive,
  type ValidationError,
} from "@openuidev/lang-core";
import { z } from "zod/v4";

const reactive = <T extends z.ZodType>(schema: T) => {
  markReactive(schema);
  return schema;
};

const tone = z.enum(["neutral", "info", "success", "warning", "danger", "accent"]).optional();
const node = z.any();
const nodes = z.array(node);

/** Schemas only, so the server can parse and validate without React. The runtime adds renderers. */
export const OPENUI_COMPONENT_SPECS = [
  {
    name: "Stack",
    description: "Lays out children. direction: column (default), row, or grid (auto-fit columns).",
    props: z.object({
      children: nodes,
      direction: z.enum(["column", "row", "grid"]).optional(),
      gap: z.enum(["s", "m", "l"]).optional(),
    }),
  },
  {
    name: "Card",
    description: "A surface with an optional title.",
    props: z.object({ title: z.string().nullable(), children: nodes }),
  },
  {
    name: "Heading",
    description: "Section heading, level 1 to 3.",
    props: z.object({ text: z.string(), level: z.number().optional() }),
  },
  {
    name: "Text",
    description: 'A paragraph. Values may be built with expressions such as "Total: " + $n.',
    props: z.object({ text: node, tone: z.enum(["default", "muted", "strong"]).optional() }),
  },
  {
    name: "Code",
    description: "Monospace code block.",
    props: z.object({ code: z.string(), language: z.string().optional() }),
  },
  {
    name: "Stat",
    description: "A metric tile: label, value, optional detail and tone.",
    props: z.object({ label: z.string(), value: node, detail: z.string().optional(), tone }),
  },
  {
    name: "Badge",
    description: "Short status label.",
    props: z.object({ label: node, tone }),
  },
  {
    name: "Table",
    description:
      "headers is a list of column names; rows is a list of rows, each a list of cells (text, numbers, or components).",
    props: z.object({ headers: z.array(z.string()), rows: z.array(nodes) }),
  },
  {
    name: "List",
    description: "Bulleted or numbered list of text or components.",
    props: z.object({ items: nodes, ordered: z.boolean().optional() }),
  },
  {
    name: "Callout",
    description: "Highlighted note.",
    props: z.object({ text: node, tone, title: z.string().optional() }),
  },
  {
    name: "Progress",
    description: "Progress bar; value out of max (default 100).",
    props: z.object({ label: z.string(), value: z.number(), max: z.number().optional(), tone }),
  },
  {
    name: "Link",
    description: "An http(s) link.",
    props: z.object({ label: z.string(), url: z.string() }),
  },
  {
    name: "Image",
    description: "An image from an http(s) or data: URL.",
    props: z.object({ src: z.string(), alt: z.string().optional() }),
  },
  {
    name: "Divider",
    description: "Horizontal rule.",
    props: z.object({}),
  },
  {
    name: "BarChart",
    description: "Bar chart. labels and values have the same length.",
    props: z.object({
      labels: z.array(z.string()),
      values: z.array(z.number()),
      title: z.string().optional(),
    }),
  },
  {
    name: "LineChart",
    description: "Line chart of one or more series. series is a list of Series.",
    props: z.object({
      labels: z.array(z.string()),
      series: nodes,
      title: z.string().optional(),
    }),
  },
  {
    name: "Series",
    description: "One named series of numbers for LineChart.",
    props: z.object({ name: z.string(), values: z.array(z.number()) }),
  },
  {
    name: "Details",
    description: "Collapsible section.",
    props: z.object({ summary: z.string(), children: nodes, open: z.boolean().optional() }),
  },
  {
    name: "Tabs",
    description: "Tabbed panels. items is a list of Tab.",
    props: z.object({ items: nodes }),
  },
  {
    name: "Tab",
    description: "One tab for Tabs.",
    props: z.object({ label: z.string(), children: nodes }),
  },
  {
    name: "Button",
    description:
      'Runs an Action, such as Action([@Set($n, $n + 1)]) or Action([@OpenUrl("https://…")]).',
    props: z.object({
      label: z.string(),
      action: action().optional(),
      variant: z.enum(["primary", "secondary", "ghost", "danger"]).optional(),
    }),
  },
  {
    name: "Input",
    description: "Text field bound to a $variable.",
    props: z.object({
      name: z.string(),
      placeholder: z.string().optional(),
      value: reactive(z.string().optional()),
    }),
  },
  {
    name: "Select",
    description: "Dropdown of options bound to a $variable.",
    props: z.object({
      name: z.string(),
      options: z.array(z.string()),
      value: reactive(z.string().optional()),
    }),
  },
  {
    name: "Checkbox",
    description: "Checkbox bound to a boolean $variable.",
    props: z.object({
      name: z.string(),
      label: z.string(),
      value: reactive(z.boolean().optional()),
    }),
  },
  {
    name: "Slider",
    description: "Range slider bound to a number $variable.",
    props: z.object({
      name: z.string(),
      min: z.number(),
      max: z.number(),
      step: z.number().optional(),
      value: reactive(z.number().optional()),
    }),
  },
] as const;

export const OPENUI_ROOT = "Stack";

export type OpenUiComponentName = (typeof OPENUI_COMPONENT_SPECS)[number]["name"];

const library = createLibrary({
  components: OPENUI_COMPONENT_SPECS.map((spec) => defineComponent({ ...spec, component: null })),
  root: OPENUI_ROOT,
});

const parser = createParser(library.toJSONSchema(), OPENUI_ROOT);

/** A compact language reference for tool descriptions; signatures come from the rendered schemas. */
export const OPENUI_GUIDE = [
  "OpenUI Lang: one `name = Expression` per line, starting with `root = Stack([...])`. Arguments are positional; omit trailing optional ones.",
  'Values: "strings", numbers, true/false, null, [arrays], {objects}, and names defined on other lines (before or after use).',
  "`$name = default` declares state that Input, Select, Checkbox and Slider bind to. Expressions: + - * / % == != > < >= <= && || ! a ? b : c, a.b, a[0].",
  'Built-ins: @Count @Sum @Avg @Min @Max @Round @Abs @Floor @Ceil @First @Last @Sort(rows, "field", "desc") @Filter(rows, "field", "==", v) @Each(rows, "r", Comp(r.field)).',
  "Button actions: @Set($v, value), @Reset($v), @OpenUrl(url), @ToAssistant(text) (puts text in the reader's composer), or Action([...steps]).",
  `Components: ${Object.values(library.toSpec().components)
    .map((component) => component.signature)
    .join("; ")}.`,
].join(" ");

/** Errors stop a render; warnings (such as no `root`) still render. */
export function validateOpenUi(source: string): {
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
} {
  const result = parser.parse(source);
  const describe = (error: ValidationError) =>
    error.statementId ? `${error.statementId}: ${error.message}` : error.message;
  const errors = result.meta.errors.filter((error) => error.severity !== "warning").map(describe);
  const warnings = result.meta.errors.filter((error) => error.severity === "warning").map(describe);
  if (result.root === null && result.rootExpression === undefined && errors.length === 0) {
    errors.push("Nothing to render. Start with `root = Stack([...])`.");
  }
  if (result.meta.unresolved.length > 0) {
    errors.push(`Undefined references: ${result.meta.unresolved.join(", ")}.`);
  }
  if (result.queryStatements.length > 0 || result.mutationStatements.length > 0) {
    errors.push("Query() and Mutation() are not available here; inline the data instead.");
  }
  return { errors, warnings };
}
