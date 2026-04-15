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

  test.describe("auth roundtrip", () => {
    test.skip(!process.env.E2E_BASE_URL, "auth roundtrip is run against the deployed server");

    test("registers through the browser form and lands in the app", async ({ page }) => {
      const stamp = Date.now();
      const email = `codex+${stamp}@example.com`;
      const password = "CodexPass123!";

      await page.goto("/login?mode=register", { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Регистрация" }).click();
      await page.getByLabel("Никнейм").fill(`codex_${stamp}`);
      await page.getByLabel("Электронная почта").fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByLabel("Повторите пароль").fill(password);

      const registerResponse = page.waitForResponse((response) =>
        response.url().includes("/api/auth/register") && response.request().method() === "POST"
      );
      const signInResponse = page.waitForResponse((response) =>
        response.url().includes("/api/auth/callback/credentials") &&
        response.request().method() === "POST"
      );

      await page.getByRole("button", { name: "Создать аккаунт" }).click();

      await expect((await registerResponse).status()).toBe(201);
      await expect((await signInResponse).ok()).toBeTruthy();
      await expect(page).not.toHaveURL(/\/login\?/);

      await page.goto("/billing", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Подписка и платежи" })).toBeVisible();
    });

    test("signs in through the browser form for an existing user", async ({ page }) => {
      const stamp = Date.now();
      const email = `codex+signin-${stamp}@example.com`;
      const password = "CodexPass123!";

      const seedResponse = await page.request.post("/api/auth/register", {
        data: {
          nickname: `seed_${stamp}`,
          email,
          password,
          confirmPassword: password,
        },
      });
      expect(seedResponse.status()).toBe(201);

      await page.goto("/login?mode=signin", { waitUntil: "networkidle" });
      await page.getByLabel("Электронная почта").fill(email);
      await page.getByLabel("Пароль").fill(password);

      const signInResponse = page.waitForResponse((response) =>
        response.url().includes("/api/auth/callback/credentials") &&
        response.request().method() === "POST"
      );

      await page.getByRole("button", { name: "Войти" }).click();

      await expect((await signInResponse).ok()).toBeTruthy();
      await expect(page).not.toHaveURL(/\/login\?/);

      await page.goto("/billing", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Подписка и платежи" })).toBeVisible();
    });
  });

  test.describe("server-only share coverage", () => {
    test.skip(!process.env.E2E_BASE_URL, "share smoke requires E2E_BASE_URL");

    test("renders unavailable share state", async ({ page }) => {
      await page.goto("/share/invalid-token", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Ссылка недоступна" })).toBeVisible();
    });
  });
});
