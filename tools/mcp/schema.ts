/**
 * @file The MCP bridge's input schemas (PLAN.md §8.11, WP 7.6): the schema language's fields (engine/core/schema.ts),
 * which inspector members declare their arguments in (engine/dev/members.ts), projected onto JSON Schema, the form
 * MCP's tool list carries. engine/core/schema.ts keeps JSON Schema's own vocabulary (`type`, `description`,
 * `default`, `minimum`, `maximum`, `enum`, `items`, `properties`) so this is a projection, not a translation.
 *
 * The rest of the language: `integer`, `number`, `boolean`, `string`, `array` and `object` keep their names; `any` is
 * the empty schema (any JSON value); `unit` joins the description (`… Unit: m.`), where every client shows it to its
 * model; an object with `properties` lists them, its required ones and no others (unknown keys are errors in the
 * schema language too), one without them takes any keys. `function` (a hook) cannot cross MCP: a member that took one
 * would get no tool (`McpSchemaError`). `when` and `view` describe settings, never arguments, and are left out.
 *
 * Invariants: the projection never invents a fact: a key the field lacks is absent from its schema (a member's own
 * default stands when an argument is left out). `argsSchema` keeps the fields' order, which is the call order.
 *
 * @example
 * fieldSchema({ type: 'integer', default: 1, minimum: 0, description: 'How many steps.' });
 * // { type: 'integer', description: 'How many steps.', default: 1, minimum: 0 }
 * const at = { type: 'array', required: true, items: { type: 'number' }, unit: 'm', description: 'Where.' } as const;
 * argsSchema({ at }).properties.at.description; // 'Where. Unit: m.'
 * @see tools/mcp/tools.test.ts
 */
import type { Field, Schema } from '../../engine/core/schema';

/** A JSON Schema, as MCP carries it. */
export type JsonSchema = { [keyword: string]: unknown };

/** A tool's `inputSchema`: a JSON Schema object. */
export interface ObjectSchema extends JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties: boolean;
}

/** Thrown for a field MCP cannot carry: a `function` (a hook). */
export class McpSchemaError extends Error {
  override name = 'McpSchemaError';
}

/** One field as JSON Schema (see the file comment). */
export function fieldSchema(field: Field, path = 'the field'): JsonSchema {
  if (field.type === 'function') {
    throw new McpSchemaError(`${path} is a function (a hook), which no MCP client can pass: take data instead`);
  }
  const out: JsonSchema = field.type === 'any' ? {} : { type: field.type };
  const text = [field.description, field.unit && `Unit: ${field.unit}.`].filter(Boolean).join(' ');
  if (text) out.description = text;
  if (field.default !== undefined) out.default = field.default;
  if (field.minimum !== undefined) out.minimum = field.minimum;
  if (field.maximum !== undefined) out.maximum = field.maximum;
  if (field.enum) out.enum = [...field.enum];
  if (field.items) out.items = fieldSchema(field.items, `${path}[]`);
  if (field.properties) Object.assign(out, argsSchema(field.properties, path));
  return out;
}

/** A schema's fields as one JSON Schema object, in their order; `open` lets keys it does not name through. */
export function argsSchema(fields: Schema, path = 'the arguments', open = false): ObjectSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [key, field] of Object.entries(fields)) properties[key] = fieldSchema(field, `${path}.${key}`);
  const required = Object.keys(fields).filter((key) => fields[key].required);
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: open };
}
