import { test, expect, type Page } from "@playwright/test";

async function expectLoginPage(page: Page) {
  await expect(page).toHaveURL(/\/login\?mode=signin$/);
  await expect(page.getByRole("heading", { name: "Вход в PlatformaAI" })).toBeVisible();
  await expect(page.getByLabel("Электронная почта")).toBeVisible();
  await expect(page.getByLabel("Пароль")).toBeVisible();
}

test.describe("browser smoke", () => {
  for (const route of ["/", "/models", "/billing", "/org"]) {
    test(`redirects ${route} to login`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expectLoginPage(page);
    });
  }

  test("keeps public routes public", async ({ page }) => {
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(
      page.getByRole("heading", { name: /Раскройте потенциал всех LLM/ })
    ).toBeVisible();

    await page.goto("/invite/accept", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", {
        name: "Примите приглашение и сразу попадите в рабочее пространство",
      })
    ).toBeVisible();
    await expect(page.getByText("Нужна ссылка из письма")).toBeVisible();
    await expect(page.getByRole("link", { name: "Войти в аккаунт" })).toBeVisible();
  });

  test("renders the login surface", async ({ page }) => {
    await page.goto("/login?mode=signin", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("tab", { name: "Вход" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Регистрация" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Вход в PlatformaAI" })).toBeVisible();
    await expect(page.getByLabel("Электронная почта")).toBeVisible();
    await expect(page.getByLabel("Пароль")).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  });

  test.describe("server-only share coverage", () => {
    test.skip(!process.env.E2E_BASE_URL, "share smoke requires E2E_BASE_URL");

    test("renders unavailable share state", async ({ page }) => {
      await page.goto("/share/invalid-token", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Ссылка недоступна" })).toBeVisible();
    });
  });
});
