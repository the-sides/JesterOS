export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const NONE = [];
const EMPTY_PROPERTIES = {};
export const text = { type: 'string' };
export const identity = { type: 'string', minLength: 1 };
export const flag = { type: 'boolean' };
export const number = { type: 'number' };
export const offset = { type: 'number', minimum: 0 };
export const choice = (...values) => ({ enum: values });
export const object = (properties = EMPTY_PROPERTIES, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
// Partial matching is for conditionals, not closed request/target objects.
export const match = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required,
});
export const empty = object();
const anyObject = { type: 'object' };
const completion = {
  mode: 'promise', success: 'applied',
  settles: 'Handler state, Svelte DOM flush, requested native focus, and actual retained scroll offsets. Not asynchronous font/media/animation completion.',
};

// Native catalogs use one envelope/schema convention, supplying their own
// supported profile IDs, capabilities, identities and behavior descriptions.
export function defineCommand(profiles, name, capability, target, payload, requires, presentation, data = NONE, rules = NONE, resultTarget = anyObject) {
  const required = ['command'];
  if (target !== empty) required.push('target');
  if (payload.required?.length || payload.anyOf) required.push('payload');
  const requestSchema = {
    $schema: JSON_SCHEMA_DIALECT,
    ...object({ command: { const: name }, requestId: identity, target, payload }, required),
  };
  if (rules.length) requestSchema.allOf = rules;
  return [name, {
    profiles, capability, requestSchema, requires,
    effects: { data, presentation }, completion,
    resultSchema: {
      ...object({ status: { const: 'applied' }, requestId: identity, target: resultTarget }, ['status', 'target']),
      additionalProperties: true,
    },
  }];
}
