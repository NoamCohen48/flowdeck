// The live demos. Plain DOM, no framework: each one is a small piece of the
// app's behaviour, built from the same rules the domain package enforces.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
};

const DEVICES = {
  A: { name: "Pixel 8", color: "#5B45C7" },
  B: { name: "iPhone 13", color: "#0C7F80" },
  C: { name: "Second laptop", color: "#A85C10" },
};
const dev = (slot, ghost = false) =>
  h("span", { class: ghost ? "dev ghost" : "dev", style: `--dev:${DEVICES[slot].color}` }, h("i", {}, slot), DEVICES[slot].name);

const VERDICTS = [
  { key: "pass", glyph: "✓", label: "Pass" },
  { key: "fail", glyph: "✕", label: "Fail" },
  { key: "minor", glyph: "!", label: "Minor issue" },
  { key: "skip", glyph: "–", label: "Skipped: the test is wrong" },
];
// Worst first: one failure anywhere is the test's result.
const RANK = { fail: 4, skip: 3, minor: 2, pass: 1 };
const NAMES = { pass: "Passed", fail: "Failed", minor: "Minor issue", skip: "Skipped" };

function verdictButtons(current, onPick, about) {
  return h("div", { class: "verdicts", role: "group", "aria-label": `Verdict for ${about}` },
    VERDICTS.map((v) => h("button", {
      type: "button", class: `v ${v.key}`, "aria-pressed": String(current === v.key),
      "aria-label": v.label, title: v.label, onclick: () => onPick(current === v.key ? null : v.key),
    }, v.glyph)));
}

/* ---- 1. The runner, on a phone ---------------------------------------- */

const FLOW = [
  { device: "A", kind: "do", text: "Open the #qa-sandbox channel." },
  { device: "A", kind: "do", text: "Send the message “ping 1”." },
  { device: "A", kind: "check", text: "Watch the message as it sends.", expect: "Appears at once with a pending clock, then a single check within 2s.",
    tests: ["Sent message is confirmed", "Sending a message shows it optimistically"] },
  { device: "B", kind: "do", text: "Unlock the iPhone." },
  { device: "B", kind: "do", text: "Open #qa-sandbox." },
  { device: "B", kind: "check", text: "Look for the message you just sent.", expect: "“ping 1” is the last message, with your name on it.",
    tests: ["A sent message arrives on the other device"] },
  { device: "C", kind: "check", text: "Look at #qa-sandbox in the browser.", expect: "“ping 1” is there, in the same order.",
    tests: ["Messages sync to the web client"] },
];

function runner(root) {
  const totalTests = FLOW.reduce((n, s) => n + (s.tests?.length ?? 0), 0);
  let state;
  const reset = () => { state = { at: 2, verdicts: {} }; };
  reset();

  const scroll = h("div", { class: "scroll" });
  const hands = h("div", { class: "hands" });
  const count = h("span");
  const fill = h("i", { class: "r", style: "width:0" });
  const again = h("button", { type: "button", onclick: () => { reset(); render(true); } }, "Start over");
  const foot = h("div", { class: "foot" }, count, h("div", { class: "bar", "aria-hidden": "true" }, fill), again);
  root.append(h("div", { class: "screen" }, hands, scroll, foot));

  const recorded = () => Object.keys(state.verdicts).length;
  const stepDone = (i) => {
    const s = FLOW[i];
    return s.tests ? s.tests.every((t) => state.verdicts[`${i}:${t}`]) : i < state.at;
  };
  // A check is done when every test on it has a verdict; a "do" step when the tester says so.
  const advance = () => {
    while (state.at < FLOW.length && FLOW[state.at].tests && stepDone(state.at)) state.at++;
  };

  function render(jump = false) {
    const current = FLOW[Math.min(state.at, FLOW.length - 1)].device;
    hands.replaceChildren("In your hands:", dev(state.at >= FLOW.length ? FLOW.at(-1).device : current));

    const items = [];
    FLOW.forEach((s, i) => {
      if (i > 0 && s.device !== FLOW[i - 1].device) {
        const reached = state.at >= i;
        items.push(h("div", { class: `pickup${reached ? "" : " muted"}`, style: `--dev:${DEVICES[s.device].color}`, "data-at": i },
          h("div", { class: "big" }, s.device),
          h("div", {}, h("b", {}, `Pick up ${DEVICES[s.device].name}`),
            h("span", {}, `Everything in this colour from here on happens on ${DEVICES[s.device].name}.`))));
      }
      const now = i === state.at;
      const done = i < state.at;
      const card = h("div", { class: `step${now ? " now" : ""}${done ? " done" : ""}`, style: `--dev:${DEVICES[s.device].color}`, "data-at": i },
        h("div", { class: "sline" },
          h("span", { class: "snum" }, String(i + 1)), dev(s.device),
          h("span", { class: `kind ${s.kind === "do" ? "act" : "chk"}` }, s.kind === "do" ? "Do this" : "Check this")),
        h("p", { class: "stext" }, s.text),
        s.expect && h("p", { class: "expect" }, h("b", {}, "Expected: "), s.expect));
      if (s.tests && (now || done)) {
        card.append(h("div", { class: "tests" },
          h("div", { class: "cap" }, `This step verifies ${s.tests.length} test${s.tests.length > 1 ? "s" : ""}`),
          s.tests.map((t) => {
            const key = `${i}:${t}`;
            const v = state.verdicts[key];
            return h("div", { class: "trow" }, h("div", { class: "tname" }, t),
              verdictButtons(v, (pick) => {
                if (pick) state.verdicts[key] = pick; else delete state.verdicts[key];
                const before = state.at;
                if (i === state.at) advance();
                render(state.at !== before);
              }, t),
              v === "fail" && h("p", { class: "note" }, "Next, the tester writes what happened, adds a photo, and says whether it blocks the rest."));
          })));
      }
      if (s.kind === "do" && now) {
        card.append(h("button", { type: "button", class: "donebtn", onclick: () => { state.at++; advance(); render(true); } }, "Done, next step"));
      }
      items.push(card);
    });
    if (state.at >= FLOW.length) {
      items.push(h("div", { class: "finished" }, h("b", {}, "Flow finished"), `${recorded()} of ${totalTests} tests recorded, live on the board.`));
    }
    scroll.replaceChildren(...items);

    count.textContent = `${recorded()} of ${totalTests} tests`;
    fill.style.width = `${(recorded() / totalTests) * 100}%`;

    if (jump) {
      // Keep the hand-off in view when the flow moves to another device.
      const target = scroll.querySelector(`.pickup[data-at="${state.at}"]`) ?? scroll.querySelector(".step.now") ?? scroll.querySelector(".finished");
      if (target) scroll.scrollTo({ top: target.offsetTop - 12, behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
  }
  render();
  requestAnimationFrame(() => { const t = scroll.querySelector(".step.now"); if (t) scroll.scrollTop = t.offsetTop - 12 - 60; });
}

/* ---- 2. The board, live ----------------------------------------------- */

const PEOPLE = { Y: "Yuval", N: "Noa", D: "Dana", O: "Omer" };
const BOARD = [
  { name: "First run and sign-in", devices: ["A"], tests: 5, who: "Y", start: { pass: 4, minor: 1 } },
  { name: "Messaging across two devices", devices: ["A", "B", "C"], tests: 8, who: "N", start: { pass: 2 } },
  { name: "Attachments and previews", devices: ["A", "C"], tests: 6, who: "D", start: { pass: 1 } },
  { name: "Search and history", devices: ["B"], tests: 5, who: null, start: {} },
];
// What happens next, in order. A verdict, or a claim. It loops.
const SCRIPT = [
  ["N", "pass"], ["D", "pass"], ["N", "pass"], ["claim", 3, "O"], ["D", "minor"], ["N", "fail"],
  ["O", "pass"], ["D", "pass"], ["N", "pass"], ["O", "pass"], ["D", "skip"], ["N", "pass"],
  ["O", "pass"], ["D", "pass"], ["O", "minor"], ["N", "pass"], ["O", "pass"], ["N", "pass"],
];

function board(root) {
  let flows, step;
  const reset = () => {
    flows = BOARD.map((f) => ({ ...f, results: { pass: 0, fail: 0, minor: 0, skip: 0, ...f.start }, ago: f.who === "Y" ? "Finished at 08:40" : "" }));
    step = 0;
  };
  reset();

  const kpi = h("div", { class: "kpi" });
  const bar = h("div", { class: "bar", role: "img" });
  const grid = h("div", { class: "flows" });
  root.append(
    h("div", { class: "chrome" }, h("img", { src: "icon.svg", alt: "" }), "Flowdeck",
      h("span", { class: "live" }, h("span", { class: "dot" }), "Live, no refresh")),
    h("div", { class: "bbody" },
      h("div", { class: "title" }, h("div", {}, h("small", {}, "Relay · Monthly regression"), h("strong", {}, "Testing day")),
        h("span", { class: "pill open" }, h("span", { class: "dot" }), "In progress")),
      h("div", { class: "totals" }, kpi, bar),
      grid));

  const sum = (k) => flows.reduce((n, f) => n + f.results[k], 0);
  const reached = (f) => f.results.pass + f.results.fail + f.results.minor + f.results.skip;
  const total = flows.reduce((n, f) => n + f.tests, 0);

  function render(changed) {
    const counts = { pass: sum("pass"), fail: sum("fail"), minor: sum("minor"), skip: sum("skip") };
    const done = counts.pass + counts.fail + counts.minor + counts.skip;
    kpi.replaceChildren(
      ...[["", counts.pass, "passed"], ["f", counts.fail, "failed"], ["m", counts.minor, "minor"], ["s", counts.skip, "skipped"], ["", total - done, "not reached"]]
        .map(([c, n, l]) => h("div", { class: c }, h("b", {}, String(n)), h("span", {}, l))));
    bar.setAttribute("aria-label", `${done} of ${total} tests have a result`);
    bar.replaceChildren(...[["p", counts.pass], ["f", counts.fail], ["m", counts.minor], ["s", counts.skip]]
      .map(([c, n]) => h("i", { class: c, style: `width:${(n / total) * 100}%` })));

    grid.replaceChildren(...flows.map((f, i) => {
      const n = reached(f);
      const finished = n === f.tests;
      const status = !f.who ? h("span", { class: "pill none" }, "Open")
        : finished ? h("span", { class: "pill pass" }, h("span", { class: "dot" }), "Finished")
        : h("span", { class: "pill open" }, h("span", { class: "dot" }), "In progress");
      const card = h("div", { class: `fcard${finished ? " done" : f.who ? " running" : ""}` },
        h("div", { class: "top" }, h("strong", {}, f.name), status),
        h("div", { class: "devs" }, f.devices.map((d) => dev(d, true))),
        f.who
          ? h("div", { class: "who" }, h("span", { class: "avatar" }, f.who),
              h("span", {}, h("b", {}, PEOPLE[f.who]), " ", finished ? (f.ago || "finished") : `${n} of ${f.tests} tests${f.ago ? ` · ${f.ago}` : ""}`),
              h("span", { class: "tally" }, ["pass", "fail", "minor", "skip"].map((k) =>
                h("span", { class: `pill ${k}${f.results[k] ? "" : " off"}`, title: NAMES[k] }, String(f.results[k])))))
          : h("div", { class: "who" }, "Nobody yet. Claim it to make it yours."),
        h("div", { class: "bar", "aria-hidden": "true" },
          [["p", "pass"], ["f", "fail"], ["m", "minor"], ["s", "skip"]].map(([c, k]) => h("i", { class: c, style: `width:${(f.results[k] / f.tests) * 100}%` }))));
      if (i === changed && !reduceMotion.matches) card.classList.add("flash");
      return card;
    }));
  }

  function tick() {
    if (step >= SCRIPT.length) { reset(); render(); return; }
    const [who, what, by] = SCRIPT[step++];
    if (who === "claim") {
      flows[what].who = by; flows[what].ago = "just now";
      render(what); return;
    }
    const i = flows.findIndex((f) => f.who === who && reached(f) < f.tests);
    if (i < 0) return tick();
    flows.forEach((f) => { if (f.ago === "just now") f.ago = ""; });
    flows[i].results[what]++;
    flows[i].ago = reached(flows[i]) === flows[i].tests ? "just finished" : "just now";
    render(i);
  }

  render();
  if (reduceMotion.matches) return;
  // Only plays while it is on screen.
  let timer = null;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !timer) timer = setInterval(tick, 1700);
    else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
  }, { threshold: 0.35 }).observe(root);
}

/* ---- 3. Worst result wins --------------------------------------------- */

function worst(root) {
  const rows = [
    { flow: "Messaging across two devices", where: "step 6, on iPhone 13", v: "pass" },
    { flow: "Offline and reconnect", where: "step 9, on Pixel 8", v: "pass" },
    { flow: "Monthly smoke test", where: "step 4, on Second laptop", v: "minor" },
  ];
  const result = h("span", { class: "pill" });
  const list = h("div");
  const why = h("div", { class: "why" });
  root.append(
    h("div", { class: "head" },
      h("div", {}, h("small", {}, "Test"), h("strong", {}, "A sent message arrives on the other device")),
      h("div", { "aria-live": "polite" }, result)),
    list, why);

  function render() {
    const given = rows.filter((r) => r.v);
    const top = given.reduce((w, r) => (!w || RANK[r.v] > RANK[w.v] ? r : w), null);
    result.className = `pill ${top ? top.v : "none"}`;
    result.replaceChildren(top ? h("span", { class: "dot" }) : "", top ? NAMES[top.v] : "Not reached");
    list.replaceChildren(...rows.map((r) => h("div", { class: `row${r === top && given.length > 1 ? " decides" : ""}` },
      h("div", {}, h("b", {}, r.flow), h("span", {}, r.where)),
      verdictButtons(r.v, (pick) => { r.v = pick; render(); }, `${r.flow}, ${r.where}`))));
    why.textContent = !top ? "No flow has reached it yet, so it shows as not reached."
      : given.length === 1 ? `Only ${top.flow} has a result, so that is the test's result.`
      : top.v === "pass" ? `Every flow that reached it passed it.`
      : `${top.flow} says ${NAMES[top.v].toLowerCase()}, and the worst result is the test's result. Try changing it.`;
  }
  render();
}

for (const el of document.querySelectorAll("[data-demo]")) {
  ({ runner, board, worst })[el.dataset.demo]?.(el);
}
