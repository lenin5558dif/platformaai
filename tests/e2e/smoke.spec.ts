import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  const emptyState = page.getByRole("heading", {
    name: "Hello! I'm ready to assist.",
  });
  const composer = page.getByPlaceholder("Ask anything or paste text...");
  await expect(emptyState.or(composer).first()).toBeVisible();
});
