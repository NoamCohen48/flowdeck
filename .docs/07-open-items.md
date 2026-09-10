# Open Items

*Everything left. The design questions are settled — see `06-decision-log.md` for D24–D31, which
closed permissions, run resumption, claiming, integration, import, notifications and estimates.*

---

## 1. Flow editor — structural editing

The demo's authoring view renders a flow correctly but only demonstrates reading. These are agreed
requirements, understood to be small changes, not yet built.

### Insert anywhere

Writing a flow is not linear. An author writes several steps, remembers something forgotten, and
needs to go back. Appending to the end is not enough.

- Insert a step at any position.
- An insert affordance on the boundary **between two adjacent steps**, so the author places the new
  step where they are already looking.

### Drag and drop

Reordering steps by dragging in the main editor.

### Summary sidebar

A sidebar listing every step by title only — a compact map that stays readable when a flow runs to
fifty steps and the main column no longer fits on screen.

- **Click a step in the sidebar to focus and scroll to it** in the main editor.
- **Drag and drop within the sidebar**, reordering the real flow.

Reordering a long flow by dragging through hundreds of pixels of step detail is unpleasant. Dragging
against a compact map is not.

### Implementation note: reordering and device hand-offs

A device hand-off banner is computed as "the first step using this device label". Reordering can move
a step across that boundary, so the banner must be recomputed after **every** reorder and insert.

Moving a step above the point where its device is introduced should move the banner up with it, not
leave the step orphaned above its own introduction. Worth settling before the drag-and-drop is
written, since it is a derived-state bug that is easy to ship and hard to notice.

---

## 2. Fallback: declare devices up front

If introducing devices mid-flow proves disruptive in real use — testers caught without hardware
ready — the fallback is requiring all devices to be declared on the flow before step 1.

The flow header already lists every device a flow uses, so this is a change of enforcement rather
than a change of model.

---

## 3. Test metadata fields

The metadata bag is generic; no fields are defined yet. Candidates raised: priority, tags, category,
a reference screenshot of the expected result. To be added when there is a concrete need.

---

## 4. Optional later, deliberately deferred

**`externalId` on tests.** Would make import idempotent and re-runnable (D29). Deferred; addable
later as an optional field without breaking existing callers. Add it if wipe-and-reimport during
migration becomes painful.

**Run-local ad-hoc steps.** A tester appending a step or note to their own run without touching the
template, promotable later by the template owner. Real machinery; the skipped verdict covers the
feedback need for now.

**Multi-tester coordinated flows.** Two people on two devices in real time. Out of scope — it breaks
single-session ownership and requires live multiplayer. Note this is distinct from D26: two people
running the *same flow independently* is supported and encouraged.

**Enforced flow dependencies.** Rejected in favour of free-text preconditions, which do not
serialize the team.

**Derived time estimates.** Rejected in D31. Revisit only if hand-typed estimates prove misleading
enough to matter.
