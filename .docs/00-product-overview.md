# Flowdeck — Product Overview

*Working name for a system that manages manual testing as human flows rather than isolated test cases.*

---

## The problem we are solving

Manual testing today runs roughly once a month, sometimes every few weeks, with about seven people
taking the product and actually using it. The test suite is a large Confluence document: many tables,
one per feature, each table with four columns — title, reproduction steps, actions to perform, and
the expected result with a pass/fail marker.

The document works as a record of *what should be true*. It works badly as a script for *what a
person should do for the next four hours*. Two structural problems:

**1. The tester is forced to bounce around the product.**
Because each test is written as a self-contained unit, consecutive tests repeat the same navigation.
One test says "open page A, click a button, verify". The next says "open page A, click a different
button, verify". Executed literally, the tester walks to page A, walks away, and walks back. Across
a few hundred tests that is a large fraction of the testing day spent on navigation that verifies
nothing.

Someone on the team already noticed this and started rewriting sections as a continuous path —
open A, press button A, press button B, then go to C. That rewrite is the seed of this product.

**2. Multi-device steps are ambiguous.**
Parts of the suite involve more than one device. In a flat table there is nowhere natural to say
*which* device an instruction applies to, so it ends up in prose, or implied, or omitted. A tester
with two handsets in front of them reads "press the button" and has to guess. This is the single
most confusing part of the current suite, and fixing it is a primary goal rather than a nice-to-have.

## What we are building

A system for authoring and executing **testing flows**: long, continuous, human-shaped paths through
a product, where individual assertions are attached to the steps that happen to verify them.

The central idea is a separation that the Confluence document does not make:

> **A test says what must be true. A flow says what a human does.**
> They are different objects with different lifecycles, joined by a many-to-many mark.

From that separation everything else follows. A test can be verified by a step in one flow today and
a different flow next month without being rewritten. A flow can be reordered for efficiency without
any test changing. And the system can answer the question the Confluence document cannot:

> *Is every test in the library actually reachable by somebody on a testing day?*

## The core guarantee

The system is not just a place to write long checklists. Its job is to guarantee coverage.

Every test in a product's library is either marked by at least one step in at least one flow, or it
is flagged. A test covered by nothing is shown as an error state, because it will never be checked
by anyone — it exists in the library and silently does nothing.

Flagging is a warning, not a block. It is acceptable to have an uncovered test; it is not acceptable
to be unaware of it.

## What a testing day looks like

1. A coordinator picks a **template** — a named collection of flows built for a particular setup.
2. Starting it creates a **run**: a live testing day with results attached.
3. Each of the seven testers **claims a flow**. That flow is theirs from start to finish.
4. The tester works down one long list. Each step tells them which device to touch, whether to *do*
   something or *check* something, and which tests (if any) this step verifies.
5. Results are recorded per test, with a one-click shortcut for the common all-passed case.
6. When something fails, they write what happened, attach a screenshot, and say whether they can
   keep going.
7. The dashboard shows, across the whole day, which tests passed, which failed, which were skipped
   as invalid, and which were never reached.

## Document map

| File | Contents |
|---|---|
| `00-product-overview.md` | This document — problem, concept, testing day narrative |
| `01-domain-model.md` | Entities, fields, relationships, identity and versioning |
| `02-authoring.md` | Templates, flows, steps, devices, marking tests |
| `03-execution.md` | Runs, claiming, verdicts, failure handling, blocking |
| `04-coverage-and-reporting.md` | Coverage rules, conflict resolution, dashboards |
| `05-design-and-ux.md` | Visual system, device identity, rationale for every UI decision |
| `06-decision-log.md` | Every decision taken, the alternatives, and why — including the stack and platform (D32–D39, D44) |
| `07-open-items.md` | What is still open or deliberately deferred |
| `08-api-and-integration.md` | Issue-feed export, authoring as files, why there is no direct integration |
