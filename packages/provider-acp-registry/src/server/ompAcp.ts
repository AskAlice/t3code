import { type OrchestrationV2UserInputQuestion, TrimmedNonEmptyString } from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const isOmpForm = Schema.is(
  Schema.Struct({
    properties: Schema.Record(Schema.String, Schema.Unknown),
    // Every field is optional: a typed answer leaves `q<i>` unset.
    required: Schema.optional(Schema.Tuple([])),
  }),
);
const OmpOptions = Schema.NonEmptyArray(
  Schema.Struct({
    const: Schema.String,
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
  }),
);
const isOmpChoice = Schema.is(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal("string"),
      title: TrimmedNonEmptyString,
      description: Schema.optional(Schema.String),
      oneOf: OmpOptions,
    }),
    Schema.Struct({
      type: Schema.Literal("array"),
      title: TrimmedNonEmptyString,
      description: Schema.optional(Schema.String),
      items: Schema.Struct({ anyOf: OmpOptions }),
    }),
  ]),
);
const isOmpCompanion = (field: unknown) =>
  Predicate.isObject(field) &&
  field.type === "string" &&
  Object.keys(field).every((key) => key === "type" || key === "title");

// oh-my-pi asks each question as an optional `q<i>` choice plus a `q<i>__other`
// free-text field. The client already offers custom answers, so hide the companion
// and send typed text there: oh-my-pi reads `q<i>` only when it names an option.
export const extractOmpElicitationForm: NonNullable<
  AcpAdapterV2Flavor["extractElicitationForm"]
> = (request) => {
  if (request.mode !== "form" || !isOmpForm(request.requestedSchema)) return undefined;
  const { properties } = request.requestedSchema;
  const fieldCount = Object.keys(properties).length;
  const questions: Array<OrchestrationV2UserInputQuestion> = [];
  let matchedFields = 0;
  for (let index = 0; matchedFields < fieldCount; index++) {
    const id = `q${index}`;
    if (!isOmpCompanion(properties[`${id}__other`])) return undefined;
    const field = Object.hasOwn(properties, id) ? properties[id] : undefined;
    matchedFields += field === undefined ? 1 : 2;
    const header = `Question ${index + 1}`;
    if (field === undefined) {
      // A lone free-text question is only named by the form message.
      const message = request.message.trim();
      const question = fieldCount === 1 && message.length > 0 ? message : header;
      questions.push({ id, header, question, options: [] });
      continue;
    }
    if (!isOmpChoice(field)) return undefined;
    const options = (field.type === "array" ? field.items.anyOf : field.oneOf).map((option) => ({
      label: option.title,
      description: option.description?.trim() || option.title,
      value: option.const,
    }));
    questions.push({
      id,
      header: field.description?.trim() || header,
      question: field.title,
      options,
      ...(field.type === "array" ? { multiSelect: true } : {}),
    });
  }
  if (questions.length === 0) return undefined;
  return {
    questions,
    respond: (answers) => {
      const content: Record<string, string | Array<string>> = {};
      for (const question of questions) {
        const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
        const values = (Array.isArray(answer) ? answer : [answer]).filter(Predicate.isString);
        const isOption = (value: string) =>
          question.options.some((option) => option.value === value);
        const picked = values.filter(isOption);
        const [firstPick] = picked;
        // Typed answers and intake's attachment references only survive in the companion.
        const typed = values
          .filter((value) => !isOption(value) && value.trim().length > 0)
          .join("\n\n");
        if (firstPick !== undefined) {
          content[question.id] = question.multiSelect ? picked : firstPick;
        }
        if (typed.length > 0) content[`${question.id}__other`] = typed;
      }
      return { action: "accept", content };
    },
  };
};
