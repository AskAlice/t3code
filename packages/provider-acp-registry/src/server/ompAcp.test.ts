import { assert, it } from "@effect/vitest";
import type * as Schema from "effect/Schema";
import { extractOmpElicitationForm } from "./ompAcp.ts";

const other = { type: "string", title: "Other (type your own)" };
const form = (properties: Record<string, Schema.Json>) =>
  extractOmpElicitationForm({
    mode: "form",
    sessionId: "omp",
    message: "Answer 2 questions",
    requestedSchema: { type: "object", properties },
  });

it("answers oh-my-pi multi-select and free-text questions in the keys it decodes", () => {
  const extracted = form({
    q0: {
      type: "array",
      title: "Which checks?",
      description: "Checks",
      items: { anyOf: ["lint", "test"].map((label) => ({ const: label, title: label })) },
    },
    q0__other: other,
    q1__other: other,
  });
  assert.deepEqual(
    extracted?.questions.map(({ question, header, multiSelect, options }) => ({
      question,
      header,
      multiSelect,
      options: options.map((option) => option.label),
    })),
    [
      { question: "Which checks?", header: "Checks", multiSelect: true, options: ["lint", "test"] },
      { question: "Question 2", header: "Question 2", multiSelect: undefined, options: [] },
    ],
  );
  assert.deepEqual(extracted?.respond({ q0: ["test", "Attached file"], q1: "Ship it" }), {
    action: "accept",
    content: { q0: ["test"], q0__other: "Attached file", q1__other: "Ship it" },
  });
});

it("leaves forms that are not oh-my-pi's to the generic fallback", () => {
  assert.isUndefined(form({ q0__other: other, q2__other: other }));
  assert.isUndefined(form({ q0: { type: "string", enum: ["a"] }, q0__other: other }));
  assert.isUndefined(form({ q0__other: { ...other, enum: ["a"] } }));
});
