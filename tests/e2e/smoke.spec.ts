import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "PlatformaAI" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New Chat/i })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hello! I'm ready to assist." })
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Ask anything or paste text...")
  ).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
});
