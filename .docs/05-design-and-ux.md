# Design and UX

*Every visual decision in the demo, and the reason for it.*

---

## Design brief

The primary user is a tester, mid-testing-day, holding two phones, three hours in, tired. The
interface has to answer three questions without being read carefully:

1. **Which device am I touching?**
2. **Am I doing something, or checking something?**
3. **Where am I, and what is left?**

Everything else — authoring, dashboards, the library — is secondary and styled to stay out of the
way.

## Where the boldness is spent

One idea carries the visual identity: **device identity as a colour system.** Every other surface is
deliberately quiet — hairline borders, restrained type, no decorative gradients or shadows — so the
device colours are the only strong colour on the page apart from result states.

---

## The device system

Each device gets a colour and a letter, used consistently everywhere it appears. Slots are
assigned per template, by first appearance across its flows (D41), so a device is the same colour
on the board, the template page, the runner and the editor:

| | Device | Colour |
|---|---|---|
| A | Pixel 8 | violet `#5B45C7` |
| B | iPhone 13 | teal `#0C7F80` |
| C | Chrome on laptop | ochre `#A85C10` |
| D | Second laptop | magenta `#B23A72` |

Four expressions of the same identity:

**1. The coloured left edge on every step.** A 4px bar. The flow reads as a set of colour bands down
the page, so a tester can see they are about to switch devices before reading a word. Scanning is
the point — the tester should not have to parse text to know which screen to touch.

**2. The device chip.** Letter in a circle plus the device name, inline on every step. The letter
gives an abstract handle ("device A") for anyone who prefers it; the name is concrete. Both are
always present, so free-text labels work whether abstract or literal.

**3. The sticky "in your hands" bar.** Pinned below the header during execution, listing every
device in play. It grows as the flow introduces devices, so the tester's physical setup and the
screen always agree.

**4. The hand-off banner.** When a flow first needs a device, a full-width banner filled solid in
that device's colour, its letter in a white disc and the device named large: *"Pick up iPhone 13 —
everything in this colour from here on happens on iPhone 13 (device B)."*

The banner is intentionally the loudest element in the product — louder than a failed verdict, which
is why it is solid rather than the tinted, dashed box it started as. Multi-device ambiguity is the
biggest pain point in the current suite, and the design puts its heaviest emphasis exactly there.

---

## Action versus check

Two markers, distinguished by *fill* rather than colour, so they remain legible next to the device
colours and in any colour-vision condition:

- **Action** — filled dark square, `▸`. Something to perform.
- **Check** — hollow outlined square, `◉`. Something to observe.

Checks additionally show an indented **Expected:** block with a left rule. Actions do not. The
asymmetry is informative: an expected result appearing means "stop and look".

Each step also carries a small text label ("Do this" / "Check this"). Redundant with the marker on
purpose — this is the second-most-important distinction on the screen and it should not rest on
iconography alone.

---

## Result states

| State | Colour | Reasoning |
|---|---|---|
| Pass | green `#1B7A46` | |
| Fail | red `#C22F2F` | |
| Minor | amber `#A66A00` | Distinct from red — it is verified, with a caveat |
| Skipped | grey `#78868F` | Deliberately colourless: not a judgment on the product |

Grey for skipped is a semantic choice, not an aesthetic one. Pass, fail and minor are all statements
about the product. Skipped is a statement about the *test*, and giving it a status colour would
imply it belongs on the same axis.

Verdict buttons are compact glyphs (`✓ ✕ ! –`), four per test row, with the selected one filling
solid. Small enough that three test rows on one step do not dominate; large enough for a touch
target.

---

## Layout decisions

**One long scrolling column during execution.** No pagination, no wizard, no collapsing. The tester's
mental model is "I am walking down a list", and any chrome that hides upcoming steps fights that.

**The current step gets a soft ring**, not a heavy highlight. It orients without shouting, since the
tester frequently works ahead of or behind the system's idea of where they are.

**Completed steps stay visible**, slightly faded, with their results shown inline. Testers
re-check what they just did constantly, and hiding completed work would force scrolling backwards
through collapsed sections.

**Attached tests are indented under their step**, separated by a dashed rule. The step is the
instruction; the tests are consequences of it. The indentation encodes that relationship.

**Notes render inline** in a tinted panel matching their verdict — red for failures, amber for minor,
grey for skipped. Nobody should have to open anything to read why something failed.

**A fixed progress footer** carries counts and a proportional bar. Persistent because "how much is
left" is asked constantly and should never require scrolling.

---

## Type and colour

**IBM Plex Sans**, one family, weights 400/500/600. Chosen for its engineering-tool character and
because it stays legible at 13px for the dense metadata rows. Hierarchy comes from weight and size
rather than from multiple families.

Background is a cool grey `#EEF1F4` with white surfaces; text is a slate `#16202B`. Cool and neutral
so the device colours and result states are the only saturated things on screen. Warm neutrals were
avoided precisely because they would compete.

Structure comes from hairline borders and spacing rather than shadows. The only shadow in the
product is on the modal dialog, where elevation is meaningful.

---

## Writing

Interface copy is plain and instructional:

- Buttons say what happens: *Claim flow*, *Pass all*, *Save report*, *Abandon flow*.
- Empty and warning states explain the consequence, not just the fact: not *"uncovered"* but
  *"In no template at all. It will never be checked on a testing day."*
- The failure dialog asks a human question — *"Can you keep going?"* — rather than exposing the
  data model's word ("blocking").
- Mechanics that could surprise are stated inline: *"This day runs against a snapshot of the
  template taken at 09:20."*

---

## Accessibility and robustness

- Device identity is never colour alone — always colour **plus** a letter **plus** a name.
- Action/check differ by fill and shape, not hue.
- Visible keyboard focus rings; `prefers-reduced-motion` respected.
- Responsive to phone width — a tester may well be marking results on a phone.
- The demo is a single self-contained file with no external dependencies for CSS or logic, so it
  works opened from disk, emailed, or shared.
