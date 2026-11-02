/**
 * `flowdeck guide`: how to write a suite that testers can run without asking
 * anyone. Written for people and for agents alike — an agent that reads this
 * before editing should produce files a tester can walk down cold. The same
 * rules are checked by `flowdeck lint` where they can be checked mechanically;
 * the guide says why.
 */

export const TOPICS = {
  overview: `FLOWDECK, IN ONE PAGE

A test says what must be true. A flow says what a person does.

  tests/        one file per test — an assertion about the product, with no steps in it
  templates/    one folder per kind of testing day; each holds flows in order
  *.flow.yaml   one flow: a sequence of steps a tester walks down, top to bottom

A step "verifies" the tests it confirms. That link is the whole model:
  - a test no step verifies is uncovered: it will never be checked on a testing day
  - the same test can be verified by many flows; its result is the worst of them
  - a step can verify nothing (most "do" steps do not)

On a testing day each tester claims a flow, walks its steps on real devices, and
records a verdict per test: pass, fail, minor or skipped (the test itself is wrong).

Instead of writing long flows by hand, you can describe how a person moves through
the app (graph.yaml) and the state each test needs (given:), and let
"flowdeck generate" work the flows out: flowdeck guide graph.

Topics:  flowdeck guide tests | flows | steps | graph | files | workflow | all`,

  tests: `WRITING TESTS

A test is an assertion — something that must be true — not a procedure. It does not
say how to get there; the flows do that, and many flows may reach the same test.

  title:   what is true, as a statement            "Sign-in rejects a wrong password"
  expect:  what the tester sees when it holds       "An inline error appears under the
                                                     password field. The field is not cleared."
  tags:    optional, for filtering                   [auth, onboarding]

Good practice
  - Title it as a fact, not a task. "Sign-in rejects a wrong password", not
    "Test the sign-in" or "Check wrong password".
  - Make expect observable and specific: what is on the screen, how fast, what is NOT
    there. "Works correctly" cannot fail; "loads within 3 seconds and shows the
    workspace name in the header" can.
  - One assertion per test. "Messages send and reactions show" is two tests: when it
    fails, which one broke?
  - No steps in a test. If you are writing "open…, tap…", that belongs in a flow.
  - Keep tests independent of devices. A test is about the product; the flow decides
    which phone or laptop proves it.

The key is the file name: tests/sign-in-rejects-a-wrong-password.yaml. Keys are
lowercase words joined by hyphens, and they are permanent — see "flowdeck guide files".

Example: tests/message-arrives-on-the-other-device.yaml

  title: A sent message arrives on the other device
  expect: It appears within 2 seconds, in order, with the sender's name.
  tags: [messaging, sync]`,

  flows: `WRITING FLOWS

A flow is what one tester does, start to finish, in one sitting. It lives in a
template (a kind of testing day) and lists its steps in order.

  name:             what the tester is doing          "Messaging across two devices"
  precondition:     the state to start from           "Two accounts signed in; #general is empty"
  estimateMinutes:  a rough, hand-typed guess         15
  steps:            the list, top to bottom (see "flowdeck guide steps")

Good practice
  - Write for a tester who has never seen the product's code and cannot ask you.
  - State the starting point in precondition instead of depending on another flow
    having run first. Flows are claimed in any order, by different people.
  - Keep a flow to something one person finishes in under an hour. Long flows get
    abandoned half way, and half a flow is recorded as nothing.
  - End with checks. A flow that only "does" things verifies nothing.
  - Mark every test the flow actually confirms with "verifies" on the check that
    shows it. Coverage is computed from these marks and nothing else.
  - Introduce devices deliberately: the first step that names a device is where the
    tester picks it up, so use the same device name every time (one device, one
    name — "iPhone 13", never also "iphone" or "the iPhone").

Order inside a template: templates/<template>/template.yaml lists its flows under
"flows:". A flow file not listed there still runs, but goes last.`,

  steps: `WRITING STEPS

Each step is one of:

  - do: Open the app                        something to do
    device: Pixel 8
  - check: Look at the header               something to look at, with what should be seen
    device: Pixel 8
    expect: The workspace name is shown in full, not truncated.
    verifies: [workspace-name-renders-in-the-header]

Optional on either kind:
    after: The channel list                 where the step leaves the tester, so they can
                                            recover if the step is out of date

The rules (flowdeck lint checks them)

  1. ONE DEVICE PER STEP. A step happens on exactly one device. Anything that involves
     two devices is two steps, one on each:
        bad:   - do: Send "hi" on the phone and check it arrives on the laptop
        good:  - do: Send "hi" to Dana.
                 device: Pixel 8
               - check: Look at the chat with Noa.
                 device: Chrome on laptop
                 expect: The message "hi" is there within 2 seconds.
     Never "both screens", "each device", "all phones": write one check per device.

  2. ONE THING PER STEP. No "and", no "then", no comma-joined actions:
        bad:   - do: Open the chat and send "hello".
        good:  - do: Open the chat.
               - do: Send "hello".
     When a step fails, the tester and the report point at one action, and a stale
     step is one edit. "Look at the reaction and its count" is fine — that is one
     look at two things, not two actions.

  3. A CHECK SAYS WHAT TO SEE. Every check has an "expect". A "do" step never has one
     (it would not be shown); if there is something to see, make it a check.

  4. VERIFY ON THE CHECK THAT SHOWS IT. "verifies" goes on the step where the tester
     can actually see the test hold — usually a check, right after the action.

  5. BE CONCRETE. "Tap Send" beats "submit the message"; "Settings → Account → Sign
     out" beats "sign out". Quote exact text the tester will type or see.

  6. SAY WHERE IT LEAVES THEM when the next step depends on it: after: "The channel
     list". If the UI changed, the tester can still get there and carry on.`,

  graph: `GENERATED FLOWS: THE GRAPH AND EACH TEST'S GIVEN

A long flow where each test sets up the next is the cheapest way to test, and the
hardest to write: you have to hold the whole app in your head. So describe the app
once, say the state each test needs, and let flowdeck find the flows.

graph.yaml is how a person moves through the app:

  roles:      the devices a flow needs, by part, not by model
                phone-a: { name: Phone A, surface: phone, usually: Pixel 8 }
  screens:    where a role can be, per surface
                phone: [sign-in, channels, thread, settings]
  facts:      what can be true in the world, each with what it means
                message: A message is in #general
                ~sent: Just sent         (~ = fresh: true only until the next action)
  starts:     states a flow may begin from: the precondition in words, and where
              every role is
                signed-in:
                  say: Both phones signed in, on the channel list.
                  at: { phone-a: channels, phone-b: channels }
  actions:    one step on one role, from a screen to a screen (the same one when
              "to" is left out), needing some facts and setting others
                - device: phone-a
                  from: thread
                  do: Send "hi".
                  needs: ["!offline"]           (!x: x must be false)
                  sets: [message, ~sent]        (-x: makes x false)
              device and from can be lists: [phone-a, phone-b] does it on either.

A test's given is the state it needs — never steps, because there is more than one
way to get there:

  given:
    device: phone-b          the role the check happens on
    at: thread               its screen
    facts: [message]         what must be true (and "!x" what must not)
    also: { phone-a: thread }   other roles that must be somewhere too (optional)
    look: Look for "hi".     the check's instruction (the title when left out)

  flowdeck generate                 writes templates/generated/, flows of at most 25 steps
  flowdeck generate --max 15        shorter flows, more of them
  flowdeck generate --replan        plan from nothing (tests may move between flows)

Every test with a given lands in exactly one generated flow, checked as soon as the
flow can reach its state. Each flow begins from a start, so flows can run side by
side. Run it again after an edit and the flows change as little as they can: tests
stay in their flow, new ones go where they cost the fewest steps. It says when
planning from nothing would be noticeably shorter. The same suite always gives the
same flows.

Rules worth knowing:
  - Name facts for what a tester can see, and give a fact its role when it is about
    one device: reacted-on-b, not reacted.
  - A check that must come right after an action ("watch it send") needs a fresh fact.
  - Do not edit templates/generated/: it is rewritten. Edit the graph and the givens.
  - Tests with no given are left to hand-written flows; both count for coverage.
  - flowdeck lint checks the graph: unknown screens and facts, a fact nothing sets,
    a screen with no way out, a given no start can reach.`,

  files: `THE FILES

  product.yaml                            name, description
  graph.yaml                              roles, screens, facts, starts, actions (optional)
  tests/<key>.yaml                        title, expect, tags, given, metadata, archived
  templates/<key>/template.yaml           name, description, archived, flows (in order)
  templates/<key>/<flow-key>.flow.yaml    name, precondition, estimateMinutes, archived, steps

Keys are file names: lowercase letters, digits and single hyphens. They are how
everything is matched on push, so:
  - Editing a file's contents changes that thing. An edited test gets a new version;
    results recorded against the old version stay as they were.
  - Renaming a file is a different key: the old one is archived and a new one created.
    Its history stays with the old key. Rename only when you mean "this is a new test".
  - Deleting a file archives it on push. Nothing is ever deleted on the server; bring
    the file back and push to restore it.
  - archived: true keeps a thing in the folder but takes it out of new testing days.

Unknown fields are errors, so a typo ("expected:", "devices:") is caught, not ignored.

YAML: put text in double quotes when it starts with a quote or a symbol, or contains
": " or " #" — otherwise "Open #general" is read as "Open" plus a comment:
    do: "Open #general"
    expect: "\\"hello\\" is the last message"
Long text can go on its own lines after "|". flowdeck writes files this way itself.
.flowdeck/ holds the server address and the copy you last pulled; do not edit it.`,

  workflow: `THE WORKFLOW

  flowdeck pull relay            first time: writes ./relay with every file
  cd relay
  ... edit, add files (flowdeck new test "…" / flowdeck new flow <template> "…") ...
  flowdeck lint                  the rules, offline. Errors must be fixed; warnings
                                 are judgement calls — read each one
  flowdeck status                what you changed since the pull, offline
  flowdeck push --plan           what the server would change. Nothing is written
  flowdeck push                  apply it, in one transaction

If someone changed the suite since your pull, push is refused (exit 3). Run
"flowdeck pull": it merges — what only they changed comes in, what only you changed
stays, and anything you both changed keeps yours and is listed. Then push again.

After a testing day:
  flowdeck report                every failure, minor issue and wrong test from the
                                 latest day, with the file and step each points at
  flowdeck coverage              which tests no flow verifies

Every command takes --json for scripts and agents. Exit codes: 0 ok, 1 the suite
has errors, 2 usage, 3 the server's suite moved on, 4 the server failed or is
unreachable.`,
} as const;

export type Topic = keyof typeof TOPICS;

export function guide(topic?: string): string | undefined {
  if (!topic) return TOPICS.overview;
  if (topic === "all") return Object.values(TOPICS).join("\n\n\n");
  return (TOPICS as Record<string, string>)[topic];
}

/** What a pull writes as AGENTS.md: enough to start, pointing at the guide for the rest. */
export const AGENTS_MARKER = "<!-- flowdeck: generated; edit freely, or delete this line to keep your own -->";

export function agentsFile(productName: string): string {
  return `${AGENTS_MARKER}
# ${productName} — Flowdeck suite

These files are a manual-test suite. Tests (tests/*.yaml) say what must be true;
flows (templates/*/*.flow.yaml) are the steps a human tester walks, on real devices.
Edit them as files, then use the \`flowdeck\` CLI to land the change.

Before writing anything, read the rules: \`flowdeck guide all\`.

The ones that matter most:
- A test is an assertion with an observable \`expect\` — never a procedure.
- Each step happens on exactly one \`device\`. Two devices means two steps.
- Each step does one thing: no "and", no "then". Split it.
- A \`check:\` step has an \`expect:\`; a \`do:\` step does not.
- Put \`verifies: [test-key]\` on the check where the tester can see the test hold.
- File names are keys. Renaming a file archives the old thing and creates a new one.

Workflow:
1. \`flowdeck pull\` to start from the server's current suite.
2. Edit files; \`flowdeck new test "<title>" --expect "<what is seen>"\` and
   \`flowdeck new flow <template> "<name>"\` create correctly named files.
3. \`flowdeck lint\` until there are no errors; read every warning.
4. \`flowdeck push --plan\` and check each line is intended (\`-\` archives).
5. \`flowdeck push\`. On exit code 3, \`flowdeck pull\` (it merges) and push again.

If there is a graph.yaml, the flows in templates/generated/ are written by
\`flowdeck generate\`: change graph.yaml and the tests' \`given:\`, then run it again.
Never edit the generated files. \`flowdeck guide graph\` has the format.

\`flowdeck report --json\` lists what testers found on the latest testing day,
including steps they flagged as wrong — fix those flows first.
`;
}
