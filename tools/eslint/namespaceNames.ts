/**
 * @file `banned/no-namespace-names` (PLAN.md Appendix B, WP 1.6): a banned three.js name read off a namespace of its
 * entry point, however the namespace is named or the name is spelt. banned.ts bans the names imported or re-exported
 * by name; reading one off a namespace has more spellings than a selector can see, so this rule follows the bindings.
 *
 * A namespace is an `import * as X from '<source>'` (any name `X`), three.js's `TSL` object (`import { TSL } from
 * 'three/webgpu'`, or `X.TSL` off a `three/webgpu` namespace), or, unbound, the name three.js's docs give it (`TSL`,
 * `THREE`). Through it, each of these reads a name: `X.screen`, `X['screen']`, ``X[`screen`]``, the type `X.Clock`,
 * and destructuring, `const { screen } = X` (nested through `TSL` too) or `({ screen } = X)`.
 *
 * Invariants: options are one `{ source, namespace, name, message }` per banned name, so `messagesOf` (family.ts)
 * finds each message; a namespace passed through another variable (`const T = TSL`) is not followed.
 *
 * @example
 * // engine/gfx/a.ts: import * as T from 'three/tsl'; const s = T['screen'];
 * // → banned/no-namespace-names: screen is deprecated in three.js r182: use blendScreen (Appendix B)
 * @see tools/eslint/banned.test.ts
 */
import type { Rule, Scope } from 'eslint';

/** One banned name of an entry point: its source, the namespace name the docs use, the name, and the fix. */
export interface EntryName {
  source: string;
  namespace: string;
  name: string;
  message: string;
}

/** A node, loosely: the rule reads TypeScript nodes (`TSQualifiedName`) that estree's types lack. */
type AnyNode = { type: string; parent?: AnyNode } & Record<string, unknown>;

/** The entry point whose `TSL` member is the `three/tsl` namespace. */
const WEBGPU = 'three/webgpu';
const TSL = 'three/tsl';

/** The name a key or computed property spells: an identifier (unless computed), a string, or a plain template. */
function nameOf(node: AnyNode | undefined, computed: boolean): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Identifier' && !computed) return node.name as string;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return ((node.quasis as AnyNode[])[0].value as { cooked?: string }).cooked;
  }
  return undefined;
}

/** The rule: options are the banned names (`EntryName`), each reported with its message wherever it is read. */
export const namespaceNames: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Banned three.js names read off a namespace, however spelt (PLAN.md Appendix B)' },
    schema: { type: 'array', items: { type: 'object' } },
  },
  create(context) {
    const options = context.options as EntryName[];
    const message = (source: string, name: string) =>
      options.find((option) => option.source === source && option.name === name)?.message;
    const report = (node: AnyNode, source: string, name: string | undefined) => {
      const text = name === undefined ? undefined : message(source, name);
      if (text) context.report({ node: node as unknown as Rule.Node, message: text });
    };
    /** The names a destructuring pattern takes from a namespace of `source`. */
    const destructure = (pattern: AnyNode, source: string): void => {
      for (const property of pattern.properties as AnyNode[]) {
        if (property.type !== 'Property') continue;
        const name = nameOf(property.key as AnyNode, property.computed as boolean);
        const value = property.value as AnyNode;
        if (source === WEBGPU && name === 'TSL' && value.type === 'ObjectPattern') destructure(value, TSL);
        else report(property, source, name);
      }
    };
    /** Checks where an expression that holds a namespace of `source` is used. */
    const use = (expression: AnyNode, source: string): void => {
      const parent = expression.parent;
      if (!parent) return;
      if (parent.type === 'MemberExpression' && parent.object === expression) {
        const name = nameOf(parent.property as AnyNode, parent.computed as boolean);
        if (source === WEBGPU && name === 'TSL') use(parent, TSL);
        else report(parent, source, name);
      } else if (parent.type === 'TSQualifiedName' && parent.left === expression) {
        report(parent, source, nameOf(parent.right as AnyNode, false));
      } else if (parent.type === 'VariableDeclarator' && parent.init === expression) {
        if ((parent.id as AnyNode).type === 'ObjectPattern') destructure(parent.id as AnyNode, source);
      } else if (parent.type === 'AssignmentExpression' && parent.right === expression) {
        if ((parent.left as AnyNode).type === 'ObjectPattern') destructure(parent.left as AnyNode, source);
      }
    };
    const sources = new Set(options.map((option) => option.source));
    return {
      Program(program) {
        const bound = new Set<unknown>();
        for (const statement of program.body) {
          if (statement.type !== 'ImportDeclaration') continue;
          for (const specifier of statement.specifiers) {
            const imported =
              specifier.type === 'ImportSpecifier' ? nameOf(specifier.imported as unknown as AnyNode, false) : '';
            const source =
              specifier.type === 'ImportNamespaceSpecifier'
                ? String(statement.source.value)
                : statement.source.value === WEBGPU && imported === 'TSL'
                  ? TSL
                  : undefined;
            if (!source || !sources.has(source)) continue;
            for (const variable of context.sourceCode.getDeclaredVariables(specifier)) {
              for (const reference of variable.references) {
                bound.add(reference.identifier);
                use(reference.identifier as unknown as AnyNode, source);
              }
            }
          }
        }
        const conventional = new Map(options.map((option) => [option.namespace, option.source]));
        const through: Scope.Reference[] = context.sourceCode.scopeManager?.globalScope?.through ?? [];
        for (const reference of through) {
          const source = conventional.get(reference.identifier.name);
          if (source && !bound.has(reference.identifier)) use(reference.identifier as unknown as AnyNode, source);
        }
      },
    };
  },
};
