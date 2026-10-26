import { test, expect } from "@playwright/test";
import { WORLD } from "../src/world.js";

test("landing, rules and mobile layout", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "O mundo é o seu tabuleiro." }),
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
    await page.locator(`[data-territory="${regional}"]`).click();
    await page.locator("#amount").fill(String(count));
    await page.locator('[data-action="reinforce"]').click();
  }
  await page.locator(`[data-territory="${own}"]`).click();
  await page.locator("#amount").fill(String(s.pool));
  await page.locator('[data-action="reinforce"]').click();
  await expect(page.locator('[data-action="next"]')).toBeEnabled();
  await page.locator('[data-action="next"]').click();
  await expect(page.locator(".command-area h3")).toContainText("Atacar");
  await page.locator(`[data-territory="${own}"]`).click();
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

test("real WebRTC: create room, invite, sync a move, reject out-of-turn, reconnect", async ({
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
    await host.getByRole("button", { name: "Criar minha sala →" }).click();
    await expect(host.locator(".room-code")).toBeVisible();
    const code = await host.locator(".room-code").textContent();
    await guest.goto(`/?room=${code}`);
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
      .locator("[data-territory]")
      .filter({ has: host.locator('circle[fill="#db775e"]') })
      .first();
    const id = await source.getAttribute("data-territory");
    await source.click();
    const before = Number(
      await guest.locator(`[data-territory="${id}"] .army-count`).textContent(),
    );
    await host.locator('[data-action="reinforce"]').click();
    await expect(
      guest.locator(`[data-territory="${id}"] .army-count`),
    ).toHaveText(String(before + 1));
    await guest.reload();
    await guest.getByRole("button", { name: "Entrar na sala →" }).click();
    await expect(guest.locator(".territory")).toHaveCount(42);
    await expect(
      guest.locator(`[data-territory="${id}"] .army-count`),
    ).toHaveText(String(before + 1));
    await expect(guest.locator(".player-chip").nth(1)).toContainText("VOCÊ");
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
