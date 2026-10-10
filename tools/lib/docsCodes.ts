/**
 * @file Reads the error and advice codes a module registers with `defineCodes` (PLAN.md WP 1.2, §6.8): `x docs`
 * collects them into `docs/ERRORS.md` and fails a code without its fix. There is no central table of codes.
 *
 * The form, read statically, so every part is a literal: `defineCodes('<area>', { <AREA>_<NAME>: { template: '…',
 * fix: '…', doc: '…' } })`, with `defineCodes` from engine/core/log.ts (WP 1.2), called by name or as a member
 * (`log.defineCodes`). The area is one lower-case word. Each code is upper-case words joined by `_`, starting with
 * the area (`GFX_NO_WEBGPU` in area `gfx`), exactly as the advice trap reads `[CODE]` at the start of a message.
 * `template` (the message, `{name}` marking a value) and `fix` (what to do, in public-API terms) are required; `doc`
 * (more detail for ERRORS.md) is optional; other keys are left to the log. Values are string literals, or template
 * literals without `${}`. Anything else is reported as a problem, never guessed.
 *
 * @example
 * import ts from 'typescript';
 * const text = "defineCodes('gfx', { GFX_NO_WEBGPU: { template: 'no adapter', fix: 'enable WebGPU' } });";
 * codesOf(ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true), 'engine/gfx/a.ts'); // one code, no problems
 * @see tools/cmd/docs.test.ts
 */
import ts from 'typescript';

/** One code registered with `defineCodes`. */
export interface CodeDoc {
  code: string;
  area: string;
  template?: string;
  fix?: string;
  doc?: string;
  module: string;
  line: number;
  /** What is wrong with it, one sentence each (a missing fix, a value that is not a literal…). */
  problems: string[];
}

/** 1-based line where `node` starts. */
const lineAt = (source: ts.SourceFile, node: ts.Node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** A string literal's value, or undefined when the node is not a literal (template literals without `${}` count). */
function literal(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** The codes registered by the `defineCodes(…)` calls in a parsed module. */
export function codesOf(source: ts.SourceFile, module: string): CodeDoc[] {
  const codes: CodeDoc[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === 'defineCodes') readCall(node);
    }
    ts.forEachChild(node, visit);
  };
  const readCall = (call: ts.CallExpression) => {
    const at = lineAt(source, call);
    const area = literal(call.arguments[0]);
    const table = call.arguments[1];
    if (area === undefined || !table || !ts.isObjectLiteralExpression(table)) {
      const problem =
        "write defineCodes('<area>', { CODE: { template, fix, doc } }) with literals, so x docs can read it";
      codes.push({ code: '?', area: area ?? '?', module, line: at, problems: [problem] });
      return;
    }
    for (const property of table.properties) {
      const line = lineAt(source, property);
      const key = property.name && (ts.isIdentifier(property.name) ? property.name.text : literal(property.name));
      const entry: CodeDoc = { code: key ?? '?', area, module, line, problems: [] };
      codes.push(entry);
      if (!/^[a-z][a-z0-9]*$/.test(area)) entry.problems.push(`its area "${area}" is not one lower-case word`);
      if (!key || !new RegExp(`^${area.toUpperCase()}(_[A-Z0-9]+)+$`).test(key)) {
        entry.problems.push(`its code must be upper-case words joined by _, starting with ${area.toUpperCase()}_`);
      }
      if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
        entry.problems.push('its entry must be an object literal { template, fix, doc }');
        continue;
      }
      for (const field of property.initializer.properties) {
        const fieldName = field.name && ts.isIdentifier(field.name) ? field.name.text : '?';
        const value = ts.isPropertyAssignment(field) ? literal(field.initializer) : undefined;
        if (!['template', 'fix', 'doc'].includes(fieldName)) continue;
        if (value === undefined) entry.problems.push(`its ${fieldName} is not a string literal`);
        else entry[fieldName as 'template' | 'fix' | 'doc'] = value;
      }
      if (!entry.template?.trim()) entry.problems.push('it has no template (the message)');
      if (!entry.fix?.trim()) entry.problems.push('it has no fix: name what to do, in public-API terms');
    }
  };
  visit(source);
  return codes;
}
