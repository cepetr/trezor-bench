import * as assert from "assert";
import {
  parseWhenExpression,
  evaluateWhenExpression,
  findUnknownIds,
  WhenContext,
} from "../../../manifest/when-expressions";
import { WhenExpression, BuildContext } from "../../../manifest/manifest-types";

suite("parseWhenExpression", () => {
  // ---------------------------------------------------------------------------
  // Predicates
  // ---------------------------------------------------------------------------

  test("parses model(id) predicate", () => {
    const result = parseWhenExpression("model(T2T1)");
    assert.ok(result.ok);
    assert.deepStrictEqual(result.expr, { type: "model", id: "T2T1" });
  });

  test("parses target(id) predicate", () => {
    const result = parseWhenExpression("target(hw)");
    assert.ok(result.ok);
    assert.deepStrictEqual(result.expr, { type: "target", id: "hw" });
  });

  test("parses component(id) predicate", () => {
    const result = parseWhenExpression("component(core)");
    assert.ok(result.ok);
    assert.deepStrictEqual(result.expr, { type: "component", id: "core" });
  });

  test("accepts ids with underscores and hyphens", () => {
    const result = parseWhenExpression("model(my_model-v2)");
    assert.ok(result.ok);
    assert.deepStrictEqual(result.expr, { type: "model", id: "my_model-v2" });
  });

  test("trims leading/trailing whitespace", () => {
    const result = parseWhenExpression("  model(T2T1)  ");
    assert.ok(result.ok);
    assert.deepStrictEqual(result.expr, { type: "model", id: "T2T1" });
  });

  // ---------------------------------------------------------------------------
  // Logical operators
  // ---------------------------------------------------------------------------

  test("parses all() with two children", () => {
    const result = parseWhenExpression("all(model(T2T1), target(hw))");
    assert.ok(result.ok);
    const expr = result.expr as Extract<WhenExpression, { type: "all" }>;
    assert.strictEqual(expr.type, "all");
    assert.strictEqual(expr.children.length, 2);
    assert.deepStrictEqual(expr.children[0], { type: "model", id: "T2T1" });
    assert.deepStrictEqual(expr.children[1], { type: "target", id: "hw" });
  });

  test("parses any() with two children", () => {
    const result = parseWhenExpression("any(model(T2T1), model(T3W1))");
    assert.ok(result.ok);
    const expr = result.expr as Extract<WhenExpression, { type: "any" }>;
    assert.strictEqual(expr.type, "any");
    assert.strictEqual(expr.children.length, 2);
  });

  test("parses not() with one child", () => {
    const result = parseWhenExpression("not(model(T2T1))");
    assert.ok(result.ok);
    const expr = result.expr as Extract<WhenExpression, { type: "not" }>;
    assert.strictEqual(expr.type, "not");
    assert.deepStrictEqual(expr.child, { type: "model", id: "T2T1" });
  });

  test("parses nested logical expressions", () => {
    const result = parseWhenExpression("all(model(T2T1), any(target(hw), target(emu)))");
    assert.ok(result.ok);
    const expr = result.expr as Extract<WhenExpression, { type: "all" }>;
    assert.strictEqual(expr.type, "all");
    assert.strictEqual(expr.children.length, 2);
    const anyChild = expr.children[1] as Extract<WhenExpression, { type: "any" }>;
    assert.strictEqual(anyChild.type, "any");
    assert.strictEqual(anyChild.children.length, 2);
  });

  test("parses all() with three children", () => {
    const result = parseWhenExpression("all(model(T2T1), target(hw), component(core))");
    assert.ok(result.ok);
    const expr = result.expr as Extract<WhenExpression, { type: "all" }>;
    assert.strictEqual(expr.children.length, 3);
  });

  // ---------------------------------------------------------------------------
  // Parse errors
  // ---------------------------------------------------------------------------

  test("returns error for unknown function name", () => {
    const result = parseWhenExpression("unknown(T2T1)");
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("unknown function"));
  });

  test("returns error for all() with no children", () => {
    const result = parseWhenExpression("all()");
    assert.ok(!result.ok);
  });

  test("returns error for empty string", () => {
    const result = parseWhenExpression("");
    assert.ok(!result.ok);
  });

  test("returns error for missing closing paren in predicate", () => {
    const result = parseWhenExpression("model(T2T1");
    assert.ok(!result.ok);
  });

  test("returns error for trailing characters", () => {
    const result = parseWhenExpression("model(T2T1) extra");
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("unexpected character"));
  });

  test("returns error when predicate id is missing", () => {
    const result = parseWhenExpression("model()");
    assert.ok(!result.ok);
  });
});

suite("evaluateWhenExpression", () => {
  const ctx: BuildContext = {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "core",
  };

  test("model predicate returns true for matching model", () => {
    const expr: WhenExpression = { type: "model", id: "T2T1" };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });

  test("model predicate returns false for non-matching model", () => {
    const expr: WhenExpression = { type: "model", id: "T3W1" };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), false);
  });

  test("target predicate returns true for matching target", () => {
    const expr: WhenExpression = { type: "target", id: "hw" };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });

  test("component predicate returns true for matching component", () => {
    const expr: WhenExpression = { type: "component", id: "core" };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });

  test("all() returns true when all children are true", () => {
    const expr: WhenExpression = {
      type: "all",
      children: [
        { type: "model", id: "T2T1" },
        { type: "target", id: "hw" },
      ],
    };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });

  test("all() returns false when any child is false", () => {
    const expr: WhenExpression = {
      type: "all",
      children: [
        { type: "model", id: "T2T1" },
        { type: "target", id: "emu" }, // mismatches
      ],
    };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), false);
  });

  test("any() returns true when at least one child is true", () => {
    const expr: WhenExpression = {
      type: "any",
      children: [
        { type: "model", id: "T3W1" }, // false
        { type: "target", id: "hw" },  // true
      ],
    };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });

  test("any() returns false when all children are false", () => {
    const expr: WhenExpression = {
      type: "any",
      children: [
        { type: "model", id: "T3W1" },
        { type: "target", id: "emu" },
      ],
    };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), false);
  });

  test("not() negates the child result", () => {
    const expr: WhenExpression = { type: "not", child: { type: "model", id: "T3W1" } };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });

  test("not() returns false when child is true", () => {
    const expr: WhenExpression = { type: "not", child: { type: "model", id: "T2T1" } };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), false);
  });

  test("nested expression evaluates correctly", () => {
    // all(model(T2T1), any(target(hw), target(emu))) → true
    const expr: WhenExpression = {
      type: "all",
      children: [
        { type: "model", id: "T2T1" },
        {
          type: "any",
          children: [
            { type: "target", id: "hw" },
            { type: "target", id: "emu" },
          ],
        },
      ],
    };
    assert.strictEqual(evaluateWhenExpression(expr, ctx), true);
  });
});

suite("findUnknownIds", () => {
  const ctx: WhenContext = {
    modelIds: new Set(["T2T1", "T3W1"]),
    targetIds: new Set(["hw", "emu"]),
    componentIds: new Set(["core", "prodtest"]),
  };

  test("returns empty array for valid predicate", () => {
    const expr: WhenExpression = { type: "model", id: "T2T1" };
    assert.deepStrictEqual(findUnknownIds(expr, ctx), []);
  });

  test("returns unknown id for invalid model predicate", () => {
    const expr: WhenExpression = { type: "model", id: "UNKNOWN" };
    const result = findUnknownIds(expr, ctx);
    assert.ok(result.includes("model(UNKNOWN)"));
  });

  test("returns unknown id for invalid target predicate", () => {
    const expr: WhenExpression = { type: "target", id: "DOES_NOT_EXIST" };
    const result = findUnknownIds(expr, ctx);
    assert.ok(result.includes("target(DOES_NOT_EXIST)"));
  });

  test("collects all unknown ids in a complex expression", () => {
    const expr: WhenExpression = {
      type: "all",
      children: [
        { type: "model", id: "UNKNOWN_MODEL" },
        { type: "target", id: "hw" }, // valid
        { type: "component", id: "UNKNOWN_COMPONENT" },
      ],
    };
    const result = findUnknownIds(expr, ctx);
    assert.strictEqual(result.length, 2);
    assert.ok(result.includes("model(UNKNOWN_MODEL)"));
    assert.ok(result.includes("component(UNKNOWN_COMPONENT)"));
  });

  test("returns empty array when all nested ids are valid", () => {
    const expr: WhenExpression = {
      type: "any",
      children: [
        { type: "model", id: "T2T1" },
        { type: "target", id: "emu" },
      ],
    };
    assert.deepStrictEqual(findUnknownIds(expr, ctx), []);
  });
});
