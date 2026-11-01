# Open Items

*What is still open. Settled questions live in `06-decision-log.md`.*

---

## Fallback: declare devices up front

If introducing devices mid-flow (D17) proves disruptive in real use — testers caught without hardware
ready — the fallback is requiring all devices to be declared on the flow before step 1. The flow
header already lists every device a flow uses, so this is a change of enforcement, not of model.

## Test metadata fields

Tags are a first-class field; the rest of the metadata bag (D5) has no defined fields. Candidates
raised: priority, category, a reference screenshot of the expected result. Add when there is a need.

## Real authentication

Identity is a name picker (D38), behind one `Actor` module. A deployment outside one trusted team
needs OIDC (or a reverse proxy that sets the actor header) before it goes on a shared network.

## Deliberately deferred

**Run-local ad-hoc steps.** A tester appending a step or note to their own run without touching the
template, promotable later. The skipped verdict and flagging a step as wrong (D40) cover the
feedback need for now.

**Multi-tester coordinated flows.** Two people on two devices in real time. Out of scope: it breaks
single-session ownership (D9). Two people running the *same flow independently* is supported (D26).

**Enforced flow dependencies.** Rejected in favour of free-text preconditions (D22).

**Derived time estimates.** Rejected in D31.
