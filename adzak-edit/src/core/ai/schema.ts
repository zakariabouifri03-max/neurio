import type { AiToolSchema, AiToolSchemaProperty, ValidationError } from '../types/ai';

/**
 * Minimal JSON-Schema validator.
 *
 * Deliberately hand-rolled and dependency-free: this is the trust boundary
 * between an LLM and the editor, so it must be auditable in one screen and must
 * never depend on a package whose behaviour could change under us.
 *
 * Supported keywords: type, enum, minimum, maximum, items, properties,
 * required, additionalProperties, plus a custom `validate` hook.
 */

export function validateAgainstSchema(value: unknown, schema: AiToolSchema): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: '', code: 'type', message: 'Expected a JSON object.' }];
  }
  const obj = value as Record<string, unknown>;

  for (const key of schema.required ?? []) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
      errors.push({ path: key, code: 'missing', message: `"${key}" is required.` });
    }
  }

  if (schema.additionalProperties !== true) {
    for (const key of Object.keys(obj)) {
      if (!(key in schema.properties)) {
        errors.push({
          path: key,
          code: 'unknown',
          message: `"${key}" is not a recognised argument and was rejected.`,
        });
      }
    }
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) continue;
    errors.push(...validateValue(obj[key], propSchema, key));
  }

  // Cross-field guards only run when every property individually passed,
  // so their messages are never buried under type errors.
  if (errors.length === 0 && schema.validate) {
    const message = schema.validate(obj);
    if (message) errors.push({ path: '', code: 'custom', message });
  }
  return errors;
}

function validateValue(value: unknown, schema: AiToolSchemaProperty, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push({ path, code: 'type', message: `"${path}" must be a string.` });
        return errors;
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path, code: 'type', message: `"${path}" must be a finite number.` });
        return errors;
      }
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push({ path, code: 'type', message: `"${path}" must be a whole number.` });
        return errors;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ path, code: 'type', message: `"${path}" must be true or false.` });
        return errors;
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push({ path, code: 'type', message: `"${path}" must be an array.` });
        return errors;
      }
      if (schema.items) {
        value.forEach((item, i) => errors.push(...validateValue(item, schema.items!, `${path}[${i}]`)));
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({ path, code: 'type', message: `"${path}" must be an object.` });
        return errors;
      }
      if (schema.properties) {
        const obj = value as Record<string, unknown>;
        for (const key of schema.required ?? []) {
          if (obj[key] === undefined) {
            errors.push({ path: `${path}.${key}`, code: 'missing', message: `"${path}.${key}" is required.` });
          }
        }
        for (const [k, child] of Object.entries(schema.properties)) {
          if (obj[k] !== undefined) errors.push(...validateValue(obj[k], child, `${path}.${k}`));
        }
      }
      break;
  }

  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push({
      path,
      code: 'enum',
      message: `"${path}" must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}.`,
    });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, code: 'range', message: `"${path}" must be at least ${schema.minimum}.` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, code: 'range', message: `"${path}" must be at most ${schema.maximum}.` });
    }
  }
  if (schema.validate) {
    const custom = schema.validate(value);
    if (custom) errors.push({ path, code: 'custom', message: custom });
  }
  return errors;
}

/**
 * Coerce the loose shapes LLMs actually emit into the declared types.
 *
 * Models routinely send `"14.5"` for a number, `1` for a boolean, or
 * `"true"` for a flag. Rejecting those outright would make the agent feel
 * broken, so we normalise first and only then validate strictly.
 */
export function coerceToSchema(value: unknown, schema: AiToolSchema): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const input = { ...(value as Record<string, unknown>) };
  const out: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in input)) continue;
    out[key] = coerceValue(input[key], prop);
  }
  // Unknown keys are preserved so the validator can explicitly reject them.
  if (schema.additionalProperties === true) {
    for (const [key, v] of Object.entries(input)) if (!(key in out)) out[key] = v;
  } else {
    for (const key of Object.keys(input)) if (!(key in schema.properties)) out[key] = input[key];
  }
  return out;
}

function coerceValue(value: unknown, prop: AiToolSchemaProperty): unknown {
  if (value === undefined || value === null) return value;
  switch (prop.type) {
    case 'number':
    case 'integer': {
      if (typeof value === 'number') return prop.type === 'integer' ? Math.trunc(value) : value;
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) return prop.type === 'integer' ? Math.trunc(parsed) : parsed;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (['true', 'yes', '1', 'on'].includes(s)) return true;
        if (['false', 'no', '0', 'off'].includes(s)) return false;
      }
      if (typeof value === 'number') return value !== 0;
      return value;
    }
    case 'string':
      return typeof value === 'string' ? value : String(value);
    case 'array':
      if (Array.isArray(value) && prop.items) return value.map((v) => coerceValue(v, prop.items!));
      if (!Array.isArray(value) && prop.items) return [coerceValue(value, prop.items)];
      return value;
    case 'object':
      if (typeof value === 'object' && !Array.isArray(value) && prop.properties) {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [k, child] of Object.entries(prop.properties)) {
          if (obj[k] !== undefined) out[k] = coerceValue(obj[k], child);
        }
        return out;
      }
      return value;
    default:
      return value;
  }
}
