const text = (maxLength = 1200) => ({ type: 'string', maxLength });
const list = (items, maxItems = 12) => ({ type: 'array', items, maxItems });
const optional = schema => ({ ...schema, optional: true });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties).filter(name => !properties[name].optional), additionalProperties: false });
const choice = values => ({ type: 'string', enum: values });
export const mappingSchema = object({
  x: text(200), metric: text(200), aggregate: choice(['sum', 'average', 'count', 'distinct', 'min', 'max', 'median', 'p25', 'p75']),
  filter: text(200), value: text(300), from: text(100), to: text(100), unit: text(40),
  timeBucket: choice(['none', 'month', 'year']),
  rate: optional(object({ successValue: text(300), eligibleValues: { ...list(text(300), 16), minItems: 1 } })),
  conditions: list(object({ field: text(200), operator: choice(['eq', 'gte', 'lte']), value: text(300) }), 6),
});
export const planSchema = object({
  goal: text(), scene: text(), grain: text(),
  fieldRoles: list(object({ field: text(200), meaning: text(400), role: choice(['time', 'metric', 'dimension', 'id', 'unknown']) }), 30),
  assumptions: list(text(500)), questions: list(text(500), 6),
  hypotheses: optional(list(object({ id: text(40), statement: text(500), testTaskIds: { ...list(text(40), 6), minItems: 1 } }), 4)),
  tasks: list(object({ id: text(40), title: text(200), rationale: text(600), chart: choice(['line', 'bar', 'scatter']), mapping: optional(mappingSchema), scatter: optional(object({ x: text(200), y: text(200), filter: text(200), value: text(300) })) }), 6),
  limitations: list(text(600)),
});
// Prior completed turns sent by the client for conversational continuity. They
// are context, never evidence: the server only forwards bounded text, and the
// planner prompt forbids citing their numbers as new results.
export const historySchema = list(object({
  question: text(800), goal: text(400), tasks: list(text(160), 6),
  scopeLabel: optional(text(200)),
  facts: list(object({ label: text(120), text: text(240) }), 3),
}), 4);
const insightItem = object({
  statement: text(500),
  evidenceIds: { ...list(text(60), 4), minItems: 1 },
  referenceIds: optional({ ...list(text(20), 4) }),
});
export const reviewSchema = object({
  answerability: choice(['partial', 'descriptive_only', 'insufficient']),
  findings: list(object({
    statement: text(600),
    evidenceIds: { ...list(text(60), 8), minItems: 1 },
    interpretation: choice(['observation', 'hypothesis']),
    referenceIds: optional({ ...list(text(20), 6) }),
  }), 8),
  insight: optional(object({
    possibleMeanings: list(insightItem, 4),
    possibleUses: list(insightItem, 4),
  })),
  limitations: { ...list(text(600)), minItems: 1 }, nextQuestions: list(text(500), 5),
});
export function validate(value, schema, path = 'output') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(path + ' 必须是对象');
    for (const name of schema.required) if (!Object.hasOwn(value, name)) throw new Error(path + '.' + name + ' 缺失');
    for (const [name, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, name)) throw new Error(path + ' 包含未知字段 ' + name);
      validate(item, schema.properties[name], path + '.' + name);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems || value.length < (schema.minItems ?? 0)) throw new Error(path + ' 列表长度错误');
    value.forEach((v, i) => validate(v, schema.items, path + '[' + i + ']'));
  } else if (typeof value !== schema.type || value.length > schema.maxLength || (schema.enum && !schema.enum.includes(value))) throw new Error(path + ' 值无效');
  return value;
}

export const inspectionSchema = object({
  summary: text(800), scene: text(600), grain: text(600),
  fields: list(object({ field: text(200), meaning: text(400), role: choice(['time', 'metric', 'dimension', 'id', 'unknown']) }), 30),
  risks: list(object({ title: text(120), detail: text(600), fields: list(text(200), 12) }), 8),
  directions: list(object({ title: text(120), question: text(500), requiredContext: text(600) }), 4),
  questions: list(text(500), 6), limitations: { ...list(text(600)), minItems: 1 },
});
export const documentSchema = object({
  columns: { ...list(text(200), 40), minItems: 2 },
  rows: { ...list(list(text(1500), 40), 300), minItems: 1 },
  warnings: list(text(600), 10),
});
