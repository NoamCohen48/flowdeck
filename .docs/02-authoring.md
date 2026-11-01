# Authoring

*How tests, templates and flows are written.*

---

## Writing tests

A test is written as an assertion. The author states the thing that must be true and nothing about
how to get there.

Good:
> **Queued messages send on reconnect** — All queued messages send in their original order once
> connectivity returns.

Bad (this is a flow step wearing a test costume):
> **Offline queue** — Turn on airplane mode, send three messages, turn airplane mode off, check they
> send.

The test library is a flat searchable list, filterable by tag and by coverage state. It is not
organized by feature tables the way Confluence was — the grouping that mattered in a document
(finding the right table) is replaced by search and tags.

### Metadata

Only title and expected result are structural today. The metadata bag is where priority, tags,
category, and a reference screenshot of the expected result will go when they are needed. The
storage and UI are built generically so adding a field is a configuration change, not a migration.

### Editing

Editing opens the current version and saves a new one. The UI states this plainly ("Editing creates
version 7") so the author understands the history is preserved, not overwritten. A version history
view lists every prior version with its author and date.

---

## Templates

Creating a template asks for a name and a description of the setup it targets — the setup is the
entire reason multiple templates exist, so it belongs in the description.

The author then writes flows. **At no point are they asked to declare which tests the template
covers.** The coverage panel on the template page reports what the flows currently add up to
("covers 20 of 25 tests") and can list what is missing, but this is a report, not a form.

Templates can be archived. Archived templates stop appearing in the "start a testing day" picker but
continue to count toward coverage.

---

## Flows

### Precondition

Every flow has a free-text precondition describing the state the product must be in before step 1.
"Relay uninstalled from the Pixel. You have valid credentials for the QA workspace."

This is the deliberate lightweight answer to flow dependencies. It solves the real problem — the
tester needs to know the starting state — without enforced ordering.

### Steps

Steps are added as either an **action** or a **check**. The author writes the instruction, and for
checks, the expected result.

Writing style for steps is imperative and specific to the device in hand:
> ▸ *Pixel 8* — Long-press "ping 1" and add a 👍 reaction.
> ◉ *Pixel 8* — Compare the reaction on both screens. **Expected:** same emoji and count on both.

### Devices in a flow

The author sets a device label per step. Labels are free text and reused across steps by name — the
first step to use a new label is automatically the introduction point, and the system renders a
hand-off banner there.

**A step happens on one device (D41).** "Check the iPhone and the second laptop" is two steps: the
tester must always know which screen to look at. The editor flags a step whose text names another
device or says "both screens", and offers to split it. A test that needs both screens is marked on
both steps. A comparison is a check on one device against what the tester saw on the other.

A typed label that differs from a known one only in case or spacing is saved as the known one, so
"pixel  8" does not become a new device with its own colour and banner.

The flow header also lists every device the flow will use, so a tester reading before starting knows
what hardware to collect. This doubles as the fallback position if mid-flow introduction turns out
to be disruptive.

### Marking tests on a step

From any step, the author opens a test picker and attaches one or more tests. The picker shows
coverage state, so an author can prioritize tests nothing covers yet.

The example that drove this design:

- Test X: "go to A, go to B"
- Test Y: "go to A, go to B, go to C, go to D"

These become **one flow**: A → B → C → D. The step for B marks test X. The step for D marks test Y.
Neither test is rewritten, neither is duplicated, and the tester walks the path once.

### Overlap

The same test may be marked in any number of steps, flows and templates. This is expected. "Verify
the header renders" is passed incidentally in five different flows and there is no reason to fight
that.

---

## Authoring as files

Everything above can also be written as files — one per test, one per flow — and pushed as one change
with the `flowdeck` CLI, by a person or an agent (D43). The rules on this page are the CLI's lint and
its guide: a step happens on one device, a step does one thing, a check says what to see.

## The flow editor

The editor is a linear list of steps with the same visual language as the execution view — device
colours, action/check markers, and attached test rows — so authors see what testers will see.

### Editing capabilities

Writing a flow is not a linear act. Authors write several steps, realize something was forgotten,
and need to go back. The editor must support:

- **Insert a step anywhere**, including between two existing steps, not only at the end.
- **Insert between two specific nodes** via an affordance on the boundary between them.
- **Drag and drop steps** to reorder.
- **A summary sidebar** listing every step by title only — a compact map of the flow that stays
  readable when the flow is fifty steps long.
- **Click a step in the sidebar to focus and scroll to it** in the main editor.
- **Drag and drop within the sidebar**, reordering the real flow.

The sidebar exists because a long flow is hard to navigate in a single scrolling column. Titles only,
so the whole flow fits on one screen and reordering is done against a map rather than by dragging
through hundreds of pixels of detail.
