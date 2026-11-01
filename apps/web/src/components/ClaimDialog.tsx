/**
 * Claiming a flow, from the board or from the runner.
 *
 * Nothing navigates until the server has said yes. A claim is advisory,
 * so the server never refuses — but when someone else already holds the flow
 * it answers 409 with their names instead of claiming, and this asks before
 * trying again with `confirm`. Two people can run the same flow; they cannot
 * do it by accident.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { api, ApiError, unwrap } from "../lib/api.ts";

/** Who holds the flow, and — from their live progress — how far in and how recently. */
interface Holder { name: string; since: string; step: number | null; steps: number | null; seen: string | null }
interface Conflict { flowId: string; flowName: string; holders: Holder[]; then: (flowRunId: string) => void }

export function useClaim(runId: string, opts: { onDismiss?: () => void } = {}) {
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Claim `flowId`; `then` runs with the new flow run's id once the server has
   * agreed. If someone else is on it, the dialog opens instead and `then` runs
   * only if the tester chooses to go ahead anyway.
   */
  async function claim(flow: { id: string; name: string; steps?: readonly unknown[] }, then: (flowRunId: string) => void, confirm = false) {
    setBusy(true);
    try {
      const res = await unwrap(
        api.POST("/runs/{runId}/flows/{flowId}/claim", {
          params: { path: { runId, flowId: flow.id }, query: { confirm: confirm ? "true" : "false" } },
        }),
      );
      setConflict(null);
      then(res.flowRun.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { alsoRunning: { claimedBy: string | null; startedAt: string; progress: { step: number; updatedAt: string } | null }[] };
        setConflict({
          flowId: flow.id,
          flowName: flow.name,
          holders: body.alsoRunning.map((f) => ({
            name: f.claimedBy ?? "someone",
            since: f.startedAt,
            step: f.progress ? f.progress.step + 1 : null,
            steps: flow.steps?.length ?? null,
            seen: f.progress?.updatedAt ?? null,
          })),
          then,
        });
      } else throw e;
    } finally {
      setBusy(false);
    }
  }

  const dialog: ReactNode = (
    <ClaimDialog
      conflict={conflict}
      busy={busy}
      onConfirm={() => conflict && void claim({ id: conflict.flowId, name: conflict.flowName }, conflict.then, true)}
      onCancel={() => { setConflict(null); opts.onDismiss?.(); }}
    />
  );

  return { claim, busy, dialog };
}

function ClaimDialog({ conflict, busy, onConfirm, onCancel }: {
  conflict: Conflict | null; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const holders = conflict?.holders ?? [];
  const names = holders.map((h) => h.name);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "Someone";
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <Dialog.Root open={conflict !== null} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog claimdlg">
          <div className="holders" aria-hidden>
            {holders.map((h) => <span key={h.name} className="avatar">{h.name.trim().charAt(0).toUpperCase()}</span>)}
          </div>
          <Dialog.Title asChild>
            <h3>{who} {names.length > 1 ? "are" : "is"} already on this flow</h3>
          </Dialog.Title>
          <Dialog.Description asChild>
            <p className="meta" dir="auto">
              <span dir="auto">{conflict?.flowName}</span>
              {holders.length === 1 ? ` · since ${time(holders[0]!.since)}` : ""}
            </p>
          </Dialog.Description>
          {/* Where each of them is, and when they last did anything: a claim left by
              someone who walked away reads very differently from one in full swing. */}
          <ul className="holderlist">
            {holders.map((h) => (
              <li key={h.name}>
                <b dir="auto">{h.name}</b>{" "}
                {h.step !== null
                  ? `is on step ${h.step}${h.steps ? ` of ${h.steps}` : ""} · last active ${time(h.seen!)}`
                  : "has not recorded anything yet"}
              </li>
            ))}
          </ul>
          <p>
            Do you want to run it as well? Both sets of results are kept, and if either of you
            hits a bug the day reports it.
          </p>
          <div className="actions">
            <button className="btn" onClick={onCancel} disabled={busy}>Leave it to {names.length > 1 ? "them" : who}</button>
            <button className="btn primary" onClick={onConfirm} disabled={busy} autoFocus>Run it as well</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
