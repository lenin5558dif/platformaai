import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:4173";
const outDir = path.resolve("artifacts/ui-audit");

const routes = [
  { name: "home", url: "/" },
  { name: "login", url: "/login" },
  { name: "settings", url: "/settings" },
  { name: "billing", url: "/billing" },
  { name: "models", url: "/models" },
];

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
const badResponses = [];

page.on("console", (msg) => {
  if (msg.type() === "error") {
    consoleErrors.push(msg.text());
  }
});

page.on("requestfailed", (req) => {
  failedRequests.push({
    url: req.url(),
    method: req.method(),
    failure: req.failure()?.errorText ?? "unknown",
  });
});

page.on("response", (res) => {
  if (res.status() >= 400 && res.url().startsWith(baseUrl)) {
    badResponses.push({
      status: res.status(),
      url: res.url(),
      method: res.request().method(),
    });
  }
});

const pageResults = [];
for (const route of routes) {
  const fullUrl = `${baseUrl}${route.url}`;
  let status = "ok";
  let title = "";
  let finalUrl = fullUrl;
  try {
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    title = await page.title();
    finalUrl = page.url();
    await page.screenshot({
      path: path.join(outDir, `${route.name}.png`),
      fullPage: true,
    });
  } catch (error) {
    status = "failed";
    await page.screenshot({
      path: path.join(outDir, `${route.name}-failed.png`),
      fullPage: true,
    });
    consoleErrors.push(`[goto:${fullUrl}] ${error instanceof Error ? error.message : String(error)}`);
  }
  pageResults.push({
    name: route.name,
    url: fullUrl,
    finalUrl,
    title,
    status,
  });
}

await browser.close();

const report = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  pages: pageResults,
  consoleErrors,
  failedRequests,
  badResponses,
};

await fs.writeFile(
  path.join(outDir, "report.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
