/**
 * @file The local rule "ask the entry, never the id" (PLAN.md §6.6, ADR-0012): shared code reads an entry's hooks and
 * fields, each with a default on the kind's schema, and never compares a registered id, so new content works without
 * editing the code that uses it. No stock rule expresses this.
 *
 * It reports, in `engine/` outside `*.test.ts`:
 * - `===`, `!==`, `==` and `!=` between a string and either an id-shaped string (`'move:slash'`: a kind, a colon, a
 *   name) or an id (`id`, `x.id`, `targetId`, `x.ownerId`);
 * - `switch` on an id, or with an id-shaped `case`;
 * - `[…].includes(x.id)` or `.indexOf(…)` over listed strings, and `x.id.startsWith('…')`, `.endsWith('…')`.
 * Comparing two variables (`entry.id === id`, a registry lookup) is fine, and so is an event or message type
 * (`e.type === 'hit:start'`, `eventType`), whose colon strings are not ids.
 *
 * Invariants: written now, switched on by WP 1.2 with the registry (`SWITCHES.askTheEntry` in eslint.config.js).
 *
 * @example
 * // engine/anim/react.ts: if (move.id === 'move:slash') flinch();
 * // → local/ask-the-entry: Ask the entry, never the id: … give the kind a hook with a default …
 * @see tools/eslint/askTheEntry.test.ts
 */
import type { Rule } from 'eslint';
import type { Node as EsNode } from 'estree';

/** A registered id: a kind, a colon, a name (`move:slash`, `prop:crate`; PLAN.md §6.3). */
export const ID_SHAPE = /^[a-z][A-Za-z0-9]*:[A-Za-z0-9_.-]+$/;

/** An identifier that holds an id: `id`, or a name ending in `Id`. */
const ID_NAME = /^(id|[a-z][A-Za-z0-9]*Id)$/;

/** Any node; ESLint's own types use estree's (installed with ESLint). */
type Node = Rule.Node | EsNode;

/** The string a literal or an expression-free template holds, else undefined. */
function stringOf(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked ?? undefined;
  return undefined;
}

/** The name `node` reads: `name` for an identifier, `x.name` for a member, else undefined. */
function nameOf(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  if (node.type === 'ChainExpression') return nameOf(node.expression);
  return undefined;
}

/** Whether `node` reads an id: `id`, `x.id`, `targetId`, `x.ownerId`. */
const isId = (node: Node | null | undefined) => ID_NAME.test(nameOf(node) ?? '');

/** An event or message type (`e.type`, `eventType`): its colon strings (`'hit:start'`) are not ids. */
const TYPE_NAME = /^(type|event|[a-z][A-Za-z0-9]*(Type|Event))$/;

/** Whether comparing `value` with the string `text` compares an id. */
const comparesId = (value: Node, text: string) =>
  isId(value) || (ID_SHAPE.test(text) && !TYPE_NAME.test(nameOf(value) ?? ''));

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Shared code asks the entry (its hooks and fields), never compares its id (PLAN.md §6.6)' },
    schema: [],
    messages: {
      compare:
        "Ask the entry, never the id: this compares an id with '{{text}}'. Read a field or hook of the entry instead, and give the kind that hook with a default on its schema, so new content works without editing this code (PLAN.md §6.6)",
    },
  },
  create(context) {
    const report = (node: Node, text: string) =>
      context.report({ node: node as Rule.Node, messageId: 'compare', data: { text } });
    return {
      BinaryExpression(node) {
        if (!['===', '!==', '==', '!='].includes(node.operator) || node.left.type === 'PrivateIdentifier') return;
        for (const [value, other] of [
          [node.left, node.right],
          [node.right, node.left],
        ] as const) {
          const text = stringOf(other);
          if (text !== undefined && comparesId(value, text)) return report(node, text);
        }
      },
      SwitchStatement(node) {
        for (const branch of node.cases) {
          const text = stringOf(branch.test);
          if (text !== undefined && comparesId(node.discriminant, text)) report(branch, text);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
        const name = callee.property.name;
        const [argument] = node.arguments;
        if ((name === 'includes' || name === 'indexOf') && callee.object.type === 'ArrayExpression' && argument) {
          const texts = callee.object.elements.map((element) => stringOf(element as Node));
          if (texts.length === 0 || texts.some((text) => text === undefined)) return;
          const compared = (texts as string[]).find((text) => comparesId(argument as Node, text));
          if (compared !== undefined) report(node, compared);
        } else if ((name === 'startsWith' || name === 'endsWith') && isId(callee.object)) {
          const text = stringOf(argument as Node);
          if (text !== undefined) report(node, text);
        }
      },
    };
  },
};

export default rule;
