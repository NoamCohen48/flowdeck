/**
 * Database rows to API shapes.
 *
 * The two are deliberately not the same type. `.docs/08-api-and-integration.md`
 * makes the REST surface a product that adapters and importers code against, so
 * it must not move because a column was renamed. Timestamps also differ in kind:
 * Drizzle hands back `Date`, and the contract says ISO 8601 string.
 */

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export interface TestVersionRow {
  id: string;
  testId: string;
  version: number;
  title: string;
  expectedResult: string;
  metadata: unknown;
  createdAt: Date | string;
  createdBy: string;
}

export function testVersionDto(row: TestVersionRow) {
  return {
    id: row.id,
    testId: row.testId,
    version: row.version,
    title: row.title,
    expectedResult: row.expectedResult,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
  };
}

export interface TestRow {
  id: string;
  productId: string;
  archived: boolean;
  current: TestVersionRow;
}

export function testDto(row: TestRow) {
  return {
    id: row.id,
    productId: row.productId,
    archived: row.archived,
    current: testVersionDto(row.current),
  };
}

export interface StepRow {
  id: string;
  position: number;
  kind: "action" | "assertion";
  text: string;
  expectedResult: string | null;
  deviceLabel: string;
  marks: string[];
}

export function stepDto(row: StepRow) {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    text: row.text,
    expectedResult: row.expectedResult,
    deviceLabel: row.deviceLabel,
    marks: row.marks,
  };
}

export interface FlowRow {
  id: string;
  templateId: string;
  name: string;
  precondition: string;
  estimatedMinutes: number | null;
  position: number;
  steps: StepRow[];
}

export function flowDto(row: FlowRow) {
  return {
    id: row.id,
    templateId: row.templateId,
    name: row.name,
    precondition: row.precondition,
    estimatedMinutes: row.estimatedMinutes,
    position: row.position,
    steps: row.steps.map(stepDto),
  };
}

export interface TemplateRow {
  id: string;
  productId: string;
  name: string;
  description: string;
  status: "active" | "archived";
  flows: FlowRow[];
}

export function templateDto(row: TemplateRow) {
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    description: row.description,
    status: row.status,
    flows: row.flows.map(flowDto),
  };
}
