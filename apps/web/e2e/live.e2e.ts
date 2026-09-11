/**
 * The promise of milestone 3, kept honest: two people, two browsers, one day.
 * Nothing here reloads a page — every assertion on the second browser is about
 * a change that arrived through Electric.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

const API = "http://localhost:8787/api";

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

  // Noa passes the first marked test; Dana's board counts it.
  const passedBefore = await dana.locator(".kpi").innerText();
  await noa.locator(".trow .v.pass").first().click();
  await expect(noa.locator(".trow .v.on.pass")).toHaveCount(1);
  await expect.poll(async () => dana.locator(".kpi").innerText(), { timeout: 15_000 }).not.toBe(passedBefore);
  await expect(danaCard.locator(".tag")).toContainText("1/");
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
