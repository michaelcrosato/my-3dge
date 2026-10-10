/**
 * @file Reads the registry kinds a module declares with `defineKind` (PLAN.md §6.6, WP 1.2): `x docs` gives each kind
 * its row in `docs/INDEX.md` (kind, description, declaring module) and fails a declaration it cannot read, so the
 * index of kinds is never written by hand.
 *
 * The form, read statically as tools/lib/docsCodes.ts reads `defineCodes`: `defineKind('<kind>', { description:
 * '…', fields, … })`, from engine/core/registry.ts, called by name or as a member (`registry.defineKind`). The kind
 * and the description are string literals (or template literals without `${}`), the declaration an object literal.
 * A call whose kind is not a literal is not a declaration (the registry's own forwarding functions) and is skipped;
 * a literal kind with a declaration or description that is not a literal is reported as a problem, never guessed.
 *
 * @example
 * import ts from 'typescript';
 * const text = "defineKind('prop', { description: 'A movable object.', fields: {} });";
 * kindsOf(ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true), 'engine/world/a.ts')[0].kind; // 'prop'
 * @see tools/cmd/docs.test.ts
 */
import ts from 'typescript';

/** One kind declared with `defineKind`. */
export interface KindDoc {
  kind: string;
  description?: string;
  module: string;
  line: number;
  /** What keeps `x docs` from reading it, one sentence each. */
  problems: string[];
}

/** A string literal's value, or undefined when the node is not a literal (template literals without `${}` count). */
function literal(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** The kinds declared by the `defineKind(…)` calls in a parsed module. */
export function kindsOf(source: ts.SourceFile, module: string): KindDoc[] {
  const kinds: KindDoc[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      const kind = literal(node.arguments[0]);
      if (name === 'defineKind' && kind !== undefined) kinds.push(read(node, kind));
    }
    ts.forEachChild(node, visit);
  };
  const read = (call: ts.CallExpression, kind: string): KindDoc => {
    const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
    const entry: KindDoc = { kind, module, line, problems: [] };
    const spec = call.arguments[1];
    const form = `write defineKind('${kind}', { description: '…', fields, … }) with literals, so x docs can list the kind`;
    if (!spec || !ts.isObjectLiteralExpression(spec)) {
      entry.problems.push(form);
      return entry;
    }
    const property = spec.properties.find(
      (item) => item.name && ts.isIdentifier(item.name) && item.name.text === 'description',
    );
    const description = property && ts.isPropertyAssignment(property) ? literal(property.initializer) : undefined;
    if (description?.trim()) entry.description = description;
    else entry.problems.push(`its description is not a string literal: ${form}`);
    return entry;
  };
  visit(source);
  return kinds;
}
