import { test, expect } from "@playwright/test";
import { WORLD } from "../src/world.js";
import { createGame } from "../src/engine.js";

test("landing, rules and mobile layout", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Domine o mapa. Cumpra a missão." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Como jogar" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Empates favorecem a defesa",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/war-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("solo reinforcement, battle, bot turn and save recovery", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let seed = 1234;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  });
  await page.goto("/");
  await page.locator('[data-action="solo-modal"]').click();
  await page.locator("#player-name").fill("Teste Solo");
  await page.getByRole("button", { name: "Iniciar campanha →" }).click();
  await expect(page.locator(".territory")).toHaveCount(42);
  let s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("war-save")),
  );
  const own = Object.keys(s.board).find(
    (t) =>
      s.board[t].owner === 0 &&
      WORLD[t].neighbors.some((n) => s.board[n].owner !== 0),
  );
  for (const [continent, count] of Object.entries(s.continentPools)) {
    if (!count) continue;
    const regional = Object.keys(s.board).find(
      (t) => s.board[t].owner === 0 && WORLD[t].continent === continent,
    );
    await page.locator(`[data-marker="${regional}"]`).click();
    await page.locator("#amount").fill(String(count));
    await page.locator('[data-action="reinforce"]').click();
  }
  await page.locator(`[data-marker="${own}"]`).click();
  await page.locator("#amount").fill(String(s.pool));
  await page.locator('[data-action="reinforce"]').click();
  await expect(page.locator('[data-action="next"]')).toBeEnabled();
  await page.locator('[data-action="next"]').click();
  await expect(page.locator(".command-area h3")).toContainText("Atacar");
  await page.locator(`[data-marker="${own}"]`).click();
  await page.locator("#target").selectOption({ index: 1 });
  await page.locator('[data-action="attack"]').click();
  await expect(page.locator(".dice-panel")).toBeVisible();
  await page.locator('[data-action="next"]').click();
  await page.locator('[data-action="next"]').click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => JSON.parse(localStorage.getItem("war-save")).round),
      { timeout: 40000 },
    )
    .toBeGreaterThan(1);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("war-save")).current,
        ),
      { timeout: 40000 },
    )
    .toBe(0);
  s = await page.evaluate(() => JSON.parse(localStorage.getItem("war-save")));
  await page.reload();
  await page.locator('[data-action="resume"]').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("war-save")).revision,
    ),
  ).toBe(s.revision);
  await expect(page.locator(".players-bar")).toContainText("Teste Solo");
  await page.screenshot({ path: "/tmp/war-game.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("tactical map zoom, drag, keyboard selection and saved-game compatibility", async ({
  page,
}) => {
  const saved = createGame([
    { name: "Veterano" },
    { name: "Atlas", bot: true },
    { name: "Aurora", bot: true },
  ]);
  await page.addInitScript(
    (saved) => localStorage.setItem("war-save", JSON.stringify(saved)),
    saved,
  );
  await page.goto("/");
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator(".territory-marker")).toHaveCount(42);
  await page.getByRole("button", { name: "Ampliar mapa" }).click();
  await expect(
    page.getByRole("button", { name: "Restaurar escala" }),
  ).toHaveText("150%");
  const viewport = page.locator(".map-scroll");
  await viewport.evaluate((el) => el.scrollTo(110, 20));
  await page.locator('[data-tab="cards"]').click();
  expect(await viewport.evaluate((el) => el.scrollLeft)).toBe(110);
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + 180, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 80, { steps: 8 });
  await page.mouse.up();
  expect(await viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(180);
  await expect(page.locator(".selection")).toHaveCount(0);
  await page.getByRole("button", { name: "Restaurar escala" }).click();
  await page.locator('[data-marker="japao"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".selection-title strong")).toHaveText("Japão");
  await expect(
    page.getByRole("button", { name: "Restaurar escala" }),
  ).toHaveText("100%");
  await page.setViewportSize({ width: 390, height: 844 });
  const initialWidth = await page
    .locator(".map-scroll svg")
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Ampliar mapa" }).click();
  expect(
    await page
      .locator(".map-scroll svg")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(initialWidth * 1.4);
});

for (const transport of ["WebRTC", "WebSocket relay"])
  test(`real ${transport}: create room, invite, sync a move, reject out-of-turn, reconnect`, async ({
    browser,
  }) => {
    const hostContext = await browser.newContext(),
      guestContext = await browser.newContext();
    const host = await hostContext.newPage(),
      guest = await guestContext.newPage();
    host.on("pageerror", (e) => console.error("host:", e.message));
    guest.on("pageerror", (e) => console.error("guest:", e.message));
    try {
      await host.goto("/");
      await host.locator('[data-action="create-modal"]').click();
      await host.locator("#player-name").fill("Anfitrião");
      if (transport === "WebSocket relay") {
        await host.locator(".network-options summary").click();
        await host.locator("#relay-url").fill("ws://127.0.0.1:9002/relay");
      }
      await host.getByRole("button", { name: "Criar minha sala →" }).click();
      await expect(host.locator(".room-code")).toBeVisible();
      await host.evaluate(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: async (value) => {
            window.invitationUnderTest = value;
          },
        });
      });
      await host.locator('[data-action="copy"]').click();
      const invitation = await host.evaluate(() => window.invitationUnderTest);
      expect(new URL(invitation).searchParams.get("relay")).toBe(
        transport === "WebSocket relay" ? "ws://127.0.0.1:9002/relay" : null,
      );
      await guest.goto(invitation);
      await guest.locator("#player-name").fill("Convidado");
      await guest.getByRole("button", { name: "Entrar na sala →" }).click();
      await expect(host.locator(".lobby-player")).toHaveCount(2, {
        timeout: 20000,
      });
      await expect(guest.locator(".lobby-player")).toHaveCount(2);
      await host.locator("#bot-count").selectOption("1");
      await host.locator('[data-action="start-online"]').click();
      await expect(host.locator(".territory")).toHaveCount(42);
      await expect(guest.locator(".territory")).toHaveCount(42);
      await expect(guest.locator(".player-chip").nth(1)).toContainText("VOCÊ");
      await expect(guest.locator('[data-action="next"]')).toHaveCount(0);
      const source = host
        .locator("[data-marker]")
        .filter({ has: host.locator('circle[fill="#db775e"]') })
        .first();
      const id = await source.getAttribute("data-marker");
      await source.click();
      const before = Number(
        await guest.locator(`[data-marker="${id}"] .army-count`).textContent(),
      );
      await host.locator('[data-action="reinforce"]').click();
      await expect(
        guest.locator(`[data-marker="${id}"] .army-count`),
      ).toHaveText(String(before + 1));
      await guest.reload();
      await guest.getByRole("button", { name: "Entrar na sala →" }).click();
      await expect(guest.locator(".territory")).toHaveCount(42);
      await expect(
        guest.locator(`[data-marker="${id}"] .army-count`),
      ).toHaveText(String(before + 1));
      await expect(guest.locator(".player-chip").nth(1)).toContainText("VOCÊ");
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
