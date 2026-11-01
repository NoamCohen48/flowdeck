/**
 * The day's problems, from the issue feed: every failure with its note,
 * screenshots and whether it blocked; every skipped test — the to-do list for
 * maintaining the suite. "Copy as ticket" is the one-bug-by-hand path.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../lib/api.ts";

export type Issue = Schemas["Issue"];
export type IssueFeed = Schemas["IssueFeed"];
export type StepProblemIssue = Schemas["StepProblemIssue"];

/** `version` changes whenever live results do, so the REST feed refetches behind the stream. */
export function useIssues(runId: string, version: number) {
  return useQuery({
    queryKey: ["issues", runId, version],
    queryFn: () => unwrap(api.GET("/runs/{runId}/issues", { params: { path: { runId } } })),
    placeholderData: (prev) => prev,
  });
}

const LABEL: Record<Issue["type"], string> = { failure: "Failed", minor: "Minor", invalid_test: "Test is wrong", pass: "Passed" };
const CLASS: Record<Issue["type"], string> = { failure: "fail", minor: "minor", invalid_test: "skip", pass: "pass" };

export function ticketText(feed: IssueFeed, i: Issue) {
  const lines = [
    `${LABEL[i.type]}: ${i.test.title}`,
    ``,
    `Expected: ${i.test.expected}`,
    `Where: ${feed.run.template} → ${i.context.flow}, step ${i.context.stepNumber} on ${i.context.device}`,
    `Step: ${i.context.stepText}`,
    i.note ? `` : null,
    i.note ? `What happened: ${i.note}` : null,
    i.type === "failure" ? `Blocked the rest of the flow: ${i.blocking ? "yes" : "no"}` : null,
    ``,
    `Recorded by ${i.recordedBy} on ${new Date(i.recordedAt).toLocaleString()} (${feed.run.product}, test version ${i.test.version})`,
    ...i.attachments.map((a) => `${window.location.origin}${a}`),
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function IssueCard({ feed, issue, productId, runId }: { feed: IssueFeed; issue: Issue; productId: string; runId?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(ticketText(feed, issue));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="panel pad">
      <div className="row-split">
        <div style={{ flex: 1, minWidth: 220 }}>
          <span className={`pill ${CLASS[issue.type]}`}><span className="dot" />{LABEL[issue.type]}</span>
          <h3 style={{ margin: "8px 0 2px" }} dir="auto">{issue.test.title}</h3>
          <p className="meta" style={{ margin: 0 }} dir="auto">
            {runId ? null : <>{feed.run.template} → </>}{issue.context.flow}, step {issue.context.stepNumber} on {issue.context.device} · {issue.recordedBy}
            {issue.type === "failure" ? (issue.blocking ? " · blocked the rest of the flow" : " · not blocking") : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy as ticket"}</button>
          <Link className="btn sm" to="/products/$productId/tests" params={{ productId }} search={{ test: issue.test.id }}>
            {issue.type === "invalid_test" ? "Rewrite" : "Open test"}
          </Link>
        </div>
      </div>
      {issue.note ? <div className={`note${issue.type === "minor" ? " min" : issue.type === "invalid_test" ? " skp" : ""}`} style={{ marginLeft: 0 }} dir="auto">{issue.note}</div> : null}
      {issue.attachments.length ? (
        <div className="flex gap-2 flex-wrap mt-2">
          {issue.attachments.map((a) => (
            <a key={a} href={a} target="_blank" rel="noreferrer"><img src={a} alt="Screenshot" style={{ height: 96, borderRadius: 4, border: "1px solid var(--line)" }} /></a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A step a tester flagged as wrong. Not a bug: the to-do for whoever
 * maintains the flow, so the card leads to the editor rather than the library.
 */
export function StepProblemCard({ feed, problem, productId, templateId }: { feed: IssueFeed; problem: StepProblemIssue; productId: string; templateId: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const lines = [
      `Step is wrong: ${feed.run.template} → ${problem.context.flow}, step ${problem.context.stepNumber} on ${problem.context.device}`,
      `Step: ${problem.context.stepText}`,
      ``,
      `What is wrong: ${problem.note}`,
      problem.blocking ? `Could not get past it — the rest of the flow was blocked.` : `Got past it: ${problem.workaround}`,
      ``,
      `Reported by ${problem.recordedBy} on ${new Date(problem.recordedAt).toLocaleString()} (${feed.run.product})`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="panel pad">
      <div className="row-split">
        <div style={{ flex: 1, minWidth: 220 }}>
          <span className="pill skip"><span className="dot" />Step is wrong</span>
          <h3 style={{ margin: "8px 0 2px" }} dir="auto">{problem.context.flow}, step {problem.context.stepNumber}</h3>
          <p className="meta" style={{ margin: 0 }} dir="auto">
            {problem.context.stepText} · on {problem.context.device} · {problem.recordedBy}
            {problem.blocking ? " · blocked the rest of the flow" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy as ticket"}</button>
          <Link className="btn sm" to="/products/$productId/templates/$templateId/flows/$flowId" params={{ productId, templateId, flowId: problem.context.flowId }} hash={`step-${problem.context.stepId}`}>
            Fix the step
          </Link>
        </div>
      </div>
      <div className="note skp" style={{ marginLeft: 0 }} dir="auto">
        {problem.note}
        {problem.workaround ? <><br /><b>Got past it:</b> {problem.workaround}</> : null}
      </div>
    </div>
  );
}
