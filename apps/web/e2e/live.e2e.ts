/**
 * The promise of milestone 3, kept honest: two people, two browsers, one day.
 * Nothing here reloads a page — every assertion on the second browser is about
 * a change that arrived through Electric.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

const API = `http://localhost:${process.env.API_PORT ?? 8788}/api`;

async function signIn(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByText("Who are you?").waitFor();
  await page.getByRole("button", { name, exact: true }).click();
  await page.locator("main").waitFor();
  return page;
}

async function relay(page: Page) {
  const products = (await (await page.request.get(`${API}/products`)).json()) as { id: string; name: string }[];
  const product = products.find((p) => p.name === "Relay")!;
  const templates = (await (await page.request.get(`${API}/products/${product.id}/templates`)).json()) as { id: string; name: string }[];
  const template = templates.find((t) => t.name.startsWith("Monthly regression"))!;
  return { product, template };
}

test("a claim and a verdict in one browser land on the other's board without a reload", async ({ browser }) => {
  const noa = await signIn(browser, "Noa");
  const dana = await signIn(browser, "Dana");
  const { product, template } = await relay(noa);

  // Noa starts a fresh day through the same cookie the browser holds.
  const run = (await (await noa.request.post(`${API}/templates/${template.id}/runs?force=true`)).json()) as { id: string };
  const board = `/products/${product.id}/runs/${run.id}`;
  await noa.goto(board);
  await dana.goto(board);
  await expect(dana.getByRole("heading", { name: "Flows" })).toBeVisible();

  const flowName = "Messaging across two devices";
  const danaCard = dana.locator(".panel", { hasText: flowName });
  await expect(danaCard.getByText("Nobody has taken this yet")).toBeVisible();

  await noa.locator(".panel", { hasText: flowName }).getByRole("button", { name: "Claim flow" }).click();
  await noa.waitForURL(/flows\//);

  // Dana never reloaded; the claim arrived.
  await expect(danaCard.getByText("Claimed by Noa")).toBeVisible({ timeout: 15_000 });
  await expect(dana.getByText("Noa", { exact: true }).first()).toBeVisible();

  // Noa passes the first marked test. It is a draft on Noa's machine: Dana's
  // board must not move until Noa finishes the flow.
  const passedBefore = await dana.locator(".kpi").innerText();
  await noa.locator(".trow .v.pass").first().click();
  await expect(noa.locator(".trow .v.on.pass")).toHaveCount(1);
  await noa.waitForTimeout(1500);
  expect(await dana.locator(".kpi").innerText()).toBe(passedBefore);
  // …but Dana does see it as in flight under the flow: provisional, not counted.
  await expect(danaCard.locator(".resultrow.live")).toContainText(/1 of \d+ tests checked/, { timeout: 15_000 });

  // Finishing records it; Dana's board counts it without a reload.
  noa.once("dialog", (d) => void d.accept());
  await noa.getByRole("button", { name: "Finish flow" }).click();
  await noa.waitForURL(new RegExp(`${run.id}$`));
  await expect.poll(async () => dana.locator(".kpi").innerText(), { timeout: 15_000 }).not.toBe(passedBefore);
  await expect(danaCard.locator(".resultrow:not(.live)")).toContainText("1 of");
  await expect(danaCard.locator(".resultrow.live")).toHaveCount(0);
});

test("claiming a flow someone holds asks first, and nothing moves until the server agrees", async ({ browser }) => {
  const noa = await signIn(browser, "Noa");
  const dana = await signIn(browser, "Dana");
  const { product, template } = await relay(noa);
  const run = (await (await noa.request.post(`${API}/templates/${template.id}/runs?force=true`)).json()) as { id: string; snapshot: { flows: { id: string; name: string }[] } };
  const flowName = "Messaging across two devices";
  const flow = run.snapshot.flows.find((f) => f.name === flowName)!;
  const board = `/products/${product.id}/runs/${run.id}`;
  await noa.goto(board);
  await expect(noa.getByRole("heading", { name: "Flows" })).toBeVisible();

  // Dana takes it through the API, as if from another room, before Noa's board hears of it.
  await dana.request.post(`${API}/runs/${run.id}/flows/${flow.id}/claim`);

  const card = noa.locator(".panel", { hasText: flowName });
  await card.getByRole("button", { name: /Claim flow|Run it too/ }).click();
  const dialog = noa.getByRole("dialog");
  await expect(dialog).toContainText("Dana is already on this flow");
  expect(noa.url()).not.toMatch(/flows\//);

  // Leaving it creates nothing for Noa.
  await dialog.getByRole("button", { name: "Leave it to Dana" }).click();
  await expect(dialog).toBeHidden();
  const state = (await (await noa.request.get(`${API}/runs/${run.id}`)).json()) as { flowRuns: { claimedBy: string | null; state: string }[] };
  expect(state.flowRuns.filter((f) => f.state === "claimed").map((f) => f.claimedBy)).toEqual(["Dana"]);

  // Going ahead knowingly gives Noa her own run of it.
  await card.getByRole("button", { name: /Claim flow|Run it too/ }).click();
  await noa.getByRole("dialog").getByRole("button", { name: "Run it as well" }).click();
  await noa.waitForURL(/flows\//);
  await expect(noa.getByText("Claimed by you")).toBeVisible();
});

test("pass the rest and finish records every remaining test, then takes the next unclaimed flow", async ({ browser }) => {
  const noa = await signIn(browser, "Noa");
  const { product, template } = await relay(noa);
  const run = (await (await noa.request.post(`${API}/templates/${template.id}/runs?force=true`)).json()) as { id: string; snapshot: { flows: { id: string; name: string }[] } };
  const [first, second] = run.snapshot.flows;
  await noa.goto(`/products/${product.id}/runs/${run.id}`);
  await noa.locator(".panel", { hasText: first!.name }).getByRole("button", { name: "Claim flow" }).click();
  await noa.waitForURL(/flows\//);

  await noa.getByRole("radio", { name: `Take the next flow: ${second!.name}` }).click();
  // It asks first: a pass nobody looked at is worse than "not reached".
  noa.on("dialog", (d) => void d.accept());
  await noa.getByRole("button", { name: /I checked the rest .* and finish/ }).click();

  // Straight into the next flow, and the first one is finished with every test passed.
  await expect(noa.getByRole("heading", { name: second!.name })).toBeVisible({ timeout: 15_000 });
  const state = (await (await noa.request.get(`${API}/runs/${run.id}`)).json()) as {
    flowRuns: { id: string; flowId: string; claimedBy: string | null; state: string }[];
    results: { flowRunId: string; verdict: string }[];
  };
  const done = state.flowRuns.find((f) => f.flowId === first!.id && f.state === "finished")!;
  const verdicts = state.results.filter((r) => r.flowRunId === done.id).map((r) => r.verdict);
  expect(verdicts.length).toBeGreaterThan(0);
  expect(new Set(verdicts)).toEqual(new Set(["pass"]));
  expect(state.flowRuns.some((f) => f.flowId === second!.id && f.claimedBy === "Noa" && f.state === "claimed")).toBe(true);
});

test("an edit in the flow editor reaches a second author live", async ({ browser }) => {
  const noa = await signIn(browser, "Noa");
  const dana = await signIn(browser, "Dana");
  const { product, template } = await relay(noa);
  const full = (await (await noa.request.get(`${API}/templates/${template.id}`)).json()) as { flows: { id: string; name: string }[] };
  const flow = full.flows.find((f) => f.name === "Messaging across two devices")!;
  const editor = `/products/${product.id}/templates/${template.id}/flows/${flow.id}`;

  await noa.goto(editor);
  await dana.goto(editor);
  await expect(noa.locator(".steps > li").first()).toBeVisible();
  await expect(dana.locator(".steps > li").first()).toBeVisible();
  await expect(noa.locator(".who")).toContainText("Dana", { timeout: 15_000 });

  const before = await dana.locator(".steps > li").count();
  await noa.locator(".between").nth(1).hover();
  await noa.locator(".between").nth(1).getByRole("button", { name: "Insert a step here" }).click();
  await noa.locator(".between.open .menu").getByRole("button", { name: "Action" }).click();
  await noa.getByLabel("Step text").fill("Dismiss the what's-new sheet.");
  await noa.getByRole("button", { name: "Add step" }).click();

  await expect(dana.locator(".steps > li")).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(dana.locator(".steps > li").nth(1)).toContainText("Dismiss the what's-new sheet.");

  // Delete it again so the seeded flow is left as it was.
  noa.once("dialog", (d) => void d.accept());
  await noa.locator(".steps > li").nth(1).getByRole("button", { name: "Edit" }).click();
  await noa.getByRole("button", { name: "Delete step" }).click();
  await expect(dana.locator(".steps > li")).toHaveCount(before, { timeout: 15_000 });
});
