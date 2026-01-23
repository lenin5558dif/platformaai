import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  const emptyState = page.getByRole("heading", {
    name: "Чем я могу помочь сегодня?",
  });
  const composer = page.getByPlaceholder("Отправьте сообщение OmniLLM...");
  await expect(emptyState.or(composer).first()).toBeVisible();
});
