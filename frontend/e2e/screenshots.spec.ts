import { test, type Page } from "@playwright/test";

/**
 * Screenshot generator for the README / project page. Not part of the normal
 * test suite — gated behind SCREENSHOTS=1 so CI never runs it. Runs against
 * the demo build's mocked backend (src/demo/), no real Zabbix/gateway needed.
 *
 *   SCREENSHOTS=1 pnpm exec playwright test screenshots --project=chromium
 *   THEME=dark SCREENSHOTS=1 pnpm exec playwright test screenshots --project=chromium
 *
 * Writes PNGs to ../docs/images/. Fixed naming contract (do not rename):
 * problems, host-detail, latest-data, explorer, topology, metrics, logs,
 * command-palette — each as <name>.png and <name>-dark.png.
 */

const OUT = "../docs/images";
const THEME = process.env.THEME === "dark" ? "dark" : "light";
const SUFFIX = THEME === "dark" ? "-dark" : "";
// First seeded host (web-01) — see src/demo/mockData.ts hostCounter start.
const HERO_HOST_ID = "10001";

test.skip(!process.env.SCREENSHOTS, "screenshot generator — set SCREENSHOTS=1 to run");
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(() => test.setTimeout(180_000));

async function prep(page: Page) {
  await page.addInitScript((theme) => {
    try {
      localStorage.setItem("auzui-theme", theme);
    } catch {
      /* ignore */
    }
  }, THEME);
}

/**
 * Navigate + capture, best-effort. domcontentloaded (not the default `load`)
 * so a route holding a long-lived request can't hang `goto`; per-route
 * errors are swallowed so one bad page never aborts the whole batch.
 */
async function shot(page: Page, route: string, name: string) {
  try {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}${SUFFIX}.png`, fullPage: false });
  } catch (err) {
    console.warn(`screenshot "${name}" (${route}) failed:`, err);
  }
}

test("auzui screenshots", async ({ page }) => {
  await prep(page);

  for (const [route, name] of [
    ["/", "problems"],
    [`/hosts/${HERO_HOST_ID}`, "host-detail"],
    ["/explorer", "explorer"],
    ["/logs", "logs"],
  ] as const) {
    await shot(page, route, name);
  }

  // Latest Data: empty until a host is picked — select one via the host combobox.
  try {
    await page.goto("/latest-data", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByPlaceholder(/host/i).click();
    await page.getByRole("button", { name: /web-01/ }).first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/latest-data${SUFFIX}.png`, fullPage: false });
  } catch (err) {
    console.warn("screenshot 'latest-data' failed:", err);
  }

  // Topology: no seeded Zabbix maps in the demo data, so the default "Maps"
  // tab is empty — switch to "L3 Subnets" (derived from host IPs) and focus
  // the first cluster.
  try {
    await page.goto("/topology?tab=l3", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(300);
    await page.locator("aside button, div button").filter({ hasText: /10\.10\./ }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/topology${SUFFIX}.png`, fullPage: false });
  } catch (err) {
    console.warn("screenshot 'topology' failed:", err);
  }

  // Metrics: pick the first suggested recipe, then check a few matrix cells
  // so the comparison chart below isn't empty.
  try {
    await page.goto("/metrics", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByText("Load across", { exact: false }).first().click();
    await page.waitForTimeout(500);
    const cells = page.getByRole("checkbox");
    const count = await cells.count();
    for (let i = 0; i < Math.min(4, count); i++) await cells.nth(i).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/metrics${SUFFIX}.png`, fullPage: false });
  } catch (err) {
    console.warn("screenshot 'metrics' failed:", err);
  }

  // Command palette: open on "/" via the ⌘K keyboard shortcut.
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(500);
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/command-palette${SUFFIX}.png`, fullPage: false });
  } catch (err) {
    console.warn("screenshot 'command-palette' failed:", err);
  }
});
