/**
 * Database rows to API shapes.
 *
 * The two are deliberately not the same type. The REST surface is a product that adapters and importers code against, so
 * it must not move because a column was renamed. Timestamps also differ in kind:
 * Drizzle hands back `Date`, and the contract says ISO 8601 string.
 */

import type { LiveProgress } from "@flowdeck/domain";

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
  key: string;
  archived: boolean;
  current: TestVersionRow;
}

export function testDto(row: TestRow) {
  return {
    id: row.id,
    productId: row.productId,
    key: row.key,
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
  postState: string | null;
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
    postState: row.postState,
    deviceLabel: row.deviceLabel,
    marks: row.marks,
  };
}

export interface FlowRow {
  id: string;
  templateId: string;
  key: string;
  name: string;
  precondition: string;
  estimatedMinutes: number | null;
  position: number;
  archived: boolean;
  steps: StepRow[];
}

export function flowDto(row: FlowRow) {
  return {
    id: row.id,
    templateId: row.templateId,
    key: row.key,
    name: row.name,
    precondition: row.precondition,
    estimatedMinutes: row.estimatedMinutes,
    position: row.position,
    archived: row.archived,
    steps: row.steps.map(stepDto),
  };
}

export interface TemplateRow {
  id: string;
  productId: string;
  key: string;
  name: string;
  description: string;
  status: "active" | "archived";
  flows: FlowRow[];
}

export function templateDto(row: TemplateRow) {
  return {
    id: row.id,
    productId: row.productId,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    flows: row.flows.map(flowDto),
  };
}

export function flowRunDto(row: {
  id: string;
  runId: string;
  flowId: string;
  claimedBy: string | null;
  state: "open" | "claimed" | "finished" | "abandoned" | "released";
  startedAt: Date | string;
  finishedAt: Date | string | null;
  progress?: LiveProgress | null;
}) {
  return {
    id: row.id,
    runId: row.runId,
    flowId: row.flowId,
    claimedBy: row.claimedBy,
    state: row.state,
    startedAt: iso(row.startedAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
    progress: row.progress ?? null,
  };
}

export function resultDto(row: {
  id: string;
  flowRunId: string;
  stepId: string;
  testId: string;
  testVersionId: string;
  verdict: "pass" | "fail" | "minor" | "skipped";
  note: string | null;
  blocking: boolean;
  recordedBy: string;
  recordedAt: Date | string;
}) {
  return {
    id: row.id,
    flowRunId: row.flowRunId,
    stepId: row.stepId,
    testId: row.testId,
    testVersionId: row.testVersionId,
    verdict: row.verdict,
    note: row.note,
    blocking: row.blocking,
    recordedBy: row.recordedBy,
    recordedAt: iso(row.recordedAt),
  };
}

export function stepProblemDto(row: {
  id: string;
  flowRunId: string;
  stepId: string;
  note: string;
  workaround: string | null;
  blocking: boolean;
  recordedBy: string;
  recordedAt: Date | string;
}) {
  return {
    id: row.id,
    flowRunId: row.flowRunId,
    stepId: row.stepId,
    note: row.note,
    workaround: row.workaround,
    blocking: row.blocking,
    recordedBy: row.recordedBy,
    recordedAt: iso(row.recordedAt),
  };
}

export function runDto(row: {
  id: string;
  templateId: string;
  date: Date | string;
  startedBy: string;
  closedAt: Date | string | null;
  snapshot: unknown;
  flowRuns: Parameters<typeof flowRunDto>[0][];
  results: Parameters<typeof resultDto>[0][];
  stepProblems: Parameters<typeof stepProblemDto>[0][];
}) {
  return {
    id: row.id,
    templateId: row.templateId,
    date: iso(row.date),
    startedBy: row.startedBy,
    closedAt: row.closedAt ? iso(row.closedAt) : null,
    snapshot: row.snapshot as import("../db/runs.ts").TemplateSnapshot,
    flowRuns: row.flowRuns.map(flowRunDto),
    results: row.results.map(resultDto),
    stepProblems: row.stepProblems.map(stepProblemDto),
  };
}
