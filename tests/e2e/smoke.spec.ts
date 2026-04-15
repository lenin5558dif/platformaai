import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  // Anonymous users are redirected to /login; authed users see ChatApp.
  // Accept either the chat empty-state/composer or the login email field.
  const emptyState = page.getByRole("heading", {
    name: "Здравствуйте! Я готов помочь.",
  });
  const composer = page.getByPlaceholder(
    "Спросите что угодно или вставьте текст...",
  );
  const loginEmail = page.getByPlaceholder("name@company.ru");
  await expect(emptyState.or(composer).or(loginEmail).first()).toBeVisible();
});
