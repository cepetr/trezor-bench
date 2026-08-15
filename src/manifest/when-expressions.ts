/**
 * Parser and evaluator for build-option `when` availability expressions.
 *
 * Grammar (recursive descent):
 *   expr        := predicate | logical
 *   predicate   := ('model' | 'target' | 'component') '(' id ')'
 *   logical     := 'all' '(' expr (',' expr)* ')'
 *                | 'any' '(' expr (',' expr)* ')'
 *                | 'not' '(' expr ')'
 *   id          := [a-zA-Z0-9_-]+
 *
 * The parser is intentionally strict: unknown function names, empty `all`/`any`
 * argument lists, and trailing characters are all reported as parse errors.
 */

import type {
  WhenExpression,
  WhenPredicate,
  WhenAll,
  WhenAny,
  WhenNot,
  BuildContext,
} from "./manifest-types";

// ---------------------------------------------------------------------------
// Public parse result
// ---------------------------------------------------------------------------

export interface WhenParseOk {
  readonly ok: true;
  readonly expr: WhenExpression;
}

export interface WhenParseError {
  readonly ok: false;
  readonly error: string;
}

export type WhenParseResult = WhenParseOk | WhenParseError;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): WhenParseResult {
    this.skipWs();
    const result = this.parseExpr();
    if (!result.ok) {
      return result;
    }
    this.skipWs();
    if (this.pos < this.src.length) {
      return { ok: false, error: `unexpected characters at position ${this.pos}: "${this.src.slice(this.pos)}"` };
    }
    return result;
  }

  private parseExpr(): WhenParseResult {
    this.skipWs();
    // Peek at the name
    const nameStart = this.pos;
    const name = this.readIdent();
    if (!name) {
      return { ok: false, error: `expected expression at position ${this.pos}` };
    }
    this.skipWs();
    if (this.src[this.pos] !== "(") {
      return { ok: false, error: `expected '(' after '${name}' at position ${this.pos}` };
    }
    this.pos++; // consume '('
    this.skipWs();

    switch (name) {
      case "model":
      case "target":
      case "component": {
        const id = this.readIdent();
        if (!id) {
          return { ok: false, error: `expected id inside ${name}(...) at position ${this.pos}` };
        }
        this.skipWs();
        if (this.src[this.pos] !== ")") {
          return { ok: false, error: `expected ')' after id in ${name}(..) at position ${this.pos}` };
        }
        this.pos++; // consume ')'
        const pred: WhenPredicate = { type: name, id };
        return { ok: true, expr: pred };
      }

      case "all":
      case "any": {
        const children: WhenExpression[] = [];
        const childResult = this.parseExpr();
        if (!childResult.ok) {
          return { ok: false, error: `expected at least one expression in ${name}(...): ${childResult.error}` };
        }
        children.push(childResult.expr);
        this.skipWs();
        while (this.src[this.pos] === ",") {
          this.pos++; // consume ','
          this.skipWs();
          const next = this.parseExpr();
          if (!next.ok) {
            return { ok: false, error: `invalid expression in ${name}(...): ${next.error}` };
          }
          children.push(next.expr);
          this.skipWs();
        }
        if (this.src[this.pos] !== ")") {
          return { ok: false, error: `expected ')' to close ${name}(...) at position ${this.pos}` };
        }
        this.pos++; // consume ')'
        if (name === "all") {
          const all: WhenAll = { type: "all", children };
          return { ok: true, expr: all };
        } else {
          const any: WhenAny = { type: "any", children };
          return { ok: true, expr: any };
        }
      }

      case "not": {
        const childResult = this.parseExpr();
        if (!childResult.ok) {
          return { ok: false, error: `invalid expression in not(...): ${childResult.error}` };
        }
        this.skipWs();
        if (this.src[this.pos] !== ")") {
          return { ok: false, error: `expected ')' to close not(...) at position ${this.pos}` };
        }
        this.pos++; // consume ')'
        const not: WhenNot = { type: "not", child: childResult.expr };
        return { ok: true, expr: not };
      }

      default: {
        // Reset position to start of name for better error context
        this.pos = nameStart;
        return { ok: false, error: `unknown function '${name}' at position ${nameStart}` };
      }
    }
  }

  private readIdent(): string {
    const start = this.pos;
    while (this.pos < this.src.length && /[a-zA-Z0-9_-]/.test(this.src[this.pos])) {
      this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) {
      this.pos++;
    }
  }
}

/**
 * Parses a `when` expression string into an AST.
 *
 * Returns a `WhenParseOk` on success, or `WhenParseError` with a description
 * on failure. The result is purely syntactic — id validation against the
 * manifest collections is done separately in `validateWhenIds`.
 */
export function parseWhenExpression(src: string): WhenParseResult {
  return new Parser(src.trim()).parse();
}

// ---------------------------------------------------------------------------
// Id validation
// ---------------------------------------------------------------------------

export interface WhenContext {
  readonly modelIds: ReadonlySet<string>;
  readonly targetIds: ReadonlySet<string>;
  readonly componentIds: ReadonlySet<string>;
}

/**
 * Returns all unknown id references found in `expr` relative to `context`.
 * An empty array means all referenced ids exist in the manifest.
 */
export function findUnknownIds(
  expr: WhenExpression,
  context: WhenContext
): string[] {
  const unknown: string[] = [];
  collectUnknownIds(expr, context, unknown);
  return unknown;
}

function collectUnknownIds(
  expr: WhenExpression,
  context: WhenContext,
  out: string[]
): void {
  switch (expr.type) {
    case "model":
      if (!context.modelIds.has(expr.id)) {
        out.push(`model(${expr.id})`);
      }
      break;
    case "target":
      if (!context.targetIds.has(expr.id)) {
        out.push(`target(${expr.id})`);
      }
      break;
    case "component":
      if (!context.componentIds.has(expr.id)) {
        out.push(`component(${expr.id})`);
      }
      break;
    case "all":
    case "any":
      for (const child of expr.children) {
        collectUnknownIds(child, context, out);
      }
      break;
    case "not":
      collectUnknownIds(expr.child, context, out);
      break;
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates a parsed `when` expression against the active build context.
 * Returns `true` when the option should be visible and contribute to
 * effective build arguments.
 */
export function evaluateWhenExpression(
  expr: WhenExpression,
  ctx: BuildContext
): boolean {
  switch (expr.type) {
    case "model":
      return expr.id === ctx.modelId;
    case "target":
      return expr.id === ctx.targetId;
    case "component":
      return expr.id === ctx.componentId;
    case "all":
      return expr.children.every((c) => evaluateWhenExpression(c, ctx));
    case "any":
      return expr.children.some((c) => evaluateWhenExpression(c, ctx));
    case "not":
      return !evaluateWhenExpression(expr.child, ctx);
  }
}
