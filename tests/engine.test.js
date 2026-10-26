import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  resolveDice,
  validSet,
  tradeSets,
  owned,
  controls,
  achieved,
  viewFor,
  botAction,
} from "../src/engine.js";
import { WORLD, TERRITORIES, CONTINENTS } from "../src/world.js";

function rng(seed = 1234) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const game = (n = 3) =>
  createGame(
    Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: true })),
    { random: rng() },
  );
function battle() {
  const s = game();
  s.phase = "attack";
  s.board.brasil = { owner: 0, armies: 10 };
  s.board.argentina = { owner: 1, armies: 3 };
  return s;
}
test("42 unique territories, reciprocal borders, and connected world", () => {
  assert.equal(TERRITORIES.length, 42);
  assert.equal(new Set(TERRITORIES.map((t) => t.id)).size, 42);
  for (const t of TERRITORIES)
    for (const n of t.neighbors) {
      assert.ok(WORLD[n]);
      assert.ok(WORLD[n].neighbors.includes(t.id));
    }
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    WORLD[id].neighbors.forEach(walk);
  };
  walk("brasil");
  assert.equal(seen.size, 42);
});
test("3–6 players get balanced territories and correct initial army totals", () => {
  for (let n = 3; n <= 6; n++) {
    const s = game(n);
    const counts = s.players.map((_, i) => owned(s, i).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    s.players.forEach((p, i) => {
      assert.equal(
        owned(s, i).reduce((sum, t) => sum + s.board[t.id].armies, 0),
        { 3: 35, 4: 30, 5: 25, 6: 20 }[n],
      );
      assert.ok(p.objective);
    });
  }
  assert.throws(() => game(2));
  assert.throws(() => game(7));
});
test("ties favor defender and sorted dice compare pairwise", () => {
  assert.deepEqual(resolveDice([2, 6, 4], [6, 3, 2]), {
    a: [6, 4, 2],
    d: [6, 3, 2],
    lossA: 2,
    lossD: 1,
  });
  assert.equal(resolveDice([6, 6, 6], [1]).lossD, 1);
});
test("three symbols equal, different and wild combinations", () => {
  const cards = (...symbols) => symbols.map((symbol) => ({ symbol }));
  for (const set of [
    [0, 0, 0],
    [0, 1, 2],
    [0, 1, 3],
    [0, 0, 3],
    [3, 3, 3],
  ])
    assert.ok(validSet(cards(...set)));
  assert.equal(validSet(cards(0, 0, 1)), false);
  assert.equal(validSet(cards(0, 1)), false);
  assert.ok(tradeSets(cards(0, 0, 1, 1, 2)).length > 0);
});
test("immutable engine rejects actions by wrong player and bad quantities", () => {
  const s = game(),
    snapshot = JSON.stringify(s),
    t = owned(s, 0)[0].id;
  assert.throws(() => applyAction(s, 1, { type: "next" }));
  for (const count of [-1, 0, NaN, Infinity, 1.5, 99999])
    assert.throws(() => applyAction(s, 0, { type: "reinforce", to: t, count }));
  const out = applyAction(s, 0, { type: "reinforce", to: t, count: 1 });
  assert.equal(out.board[t].armies, s.board[t].armies + 1);
  assert.equal(JSON.stringify(s), snapshot);
});
test("regional reinforcements cannot be placed in another continent", () => {
  const s = game();
  s.pool = 0;
  s.continentPools = { sa: 2 };
  s.board.brasil.owner = 0;
  s.board.alaska.owner = 0;
  assert.throws(() =>
    applyAction(s, 0, { type: "reinforce", to: "alaska", count: 1 }),
  );
  assert.throws(() => applyAction(s, 0, { type: "next" }));
  const out = applyAction(s, 0, { type: "reinforce", to: "brasil", count: 2 });
  assert.equal(out.continentPools.sa, 0);
  assert.equal(out.pool, 0);
});
test("mandatory card trades and territory bonuses", () => {
  const s = game();
  s.pool = 0;
  s.continentPools = {};
  s.players[0].cards = [
    { id: "brasil", symbol: 0 },
    { id: "peru", symbol: 0 },
    { id: "argentina", symbol: 0 },
    { id: "wild1", symbol: 3 },
    { id: "wild2", symbol: 3 },
  ];
  s.board.brasil.owner = 0;
  assert.throws(() => applyAction(s, 0, { type: "next" }));
  assert.throws(() =>
    applyAction(s, 0, { type: "trade", cards: ["brasil", "brasil", "brasil"] }),
  );
  const out = applyAction(s, 0, {
    type: "trade",
    cards: ["brasil", "peru", "argentina"],
  });
  assert.equal(out.pool, 4);
  assert.equal(out.players[0].cards.length, 2);
  assert.equal(out.board.brasil.armies, s.board.brasil.armies + 2);
  assert.equal(out.trades, 1);
});
test("attack requires a border, enemy and an army left behind", () => {
  const s = battle();
  assert.throws(() =>
    applyAction(s, 0, { type: "attack", from: "brasil", to: "japao" }),
  );
  s.board.brasil.armies = 1;
  assert.throws(() =>
    applyAction(s, 0, { type: "attack", from: "brasil", to: "argentina" }),
  );
});
test("defender rolls up to three dice and conquest transfers armies", () => {
  let s = battle();
  let rolls = 0;
  const seq = () => (++rolls <= 3 ? 0.99 : 0);
  s = applyAction(
    s,
    0,
    { type: "attack", from: "brasil", to: "argentina", occupy: 3 },
    seq,
  );
  assert.equal(s.dice.d.length, 3);
  assert.equal(s.board.argentina.owner, 0);
  assert.equal(s.board.argentina.armies, 3);
  assert.equal(s.board.brasil.armies, 7);
  assert.equal(s.conquered, true);
});
test("elimination transfers cards to the attacker", () => {
  let s = battle();
  for (const t of owned(s, 1)) s.board[t.id].owner = 2;
  s.board.argentina = { owner: 1, armies: 1 };
  s.players[1].cards = [{ id: "wild1", symbol: 3 }];
  let rolls = 0;
  s = applyAction(
    s,
    0,
    { type: "attack", from: "brasil", to: "argentina", occupy: 1 },
    () => (++rolls <= 3 ? 0.99 : 0),
  );
  assert.equal(s.players[0].cards.length, 1);
  assert.equal(s.players[1].cards.length, 0);
});
test("elimination objectives require the final attack, otherwise fall back to 24 territories", () => {
  let s = battle();
  for (const t of owned(s, 1)) s.board[t.id].owner = 2;
  s.board.argentina = { owner: 1, armies: 1 };
  s.players[0].objective = { type: "eliminate", target: 1 };
  s.players[2].objective = { type: "eliminate", target: 1 };
  let rolls = 0;
  s = applyAction(
    s,
    0,
    { type: "attack", from: "brasil", to: "argentina", occupy: 1 },
    () => (++rolls <= 3 ? 0.99 : 0),
  );
  assert.equal(s.winner, 0);
  assert.equal(s.players[2].objective.type, "territories");
  assert.equal(s.players[2].objective.count, 24);
});
test("received armies cannot move again during redeployment", () => {
  let s = game();
  for (const id of ["brasil", "peru", "argentina"])
    s.board[id] = { owner: 0, armies: 3 };
  s.phase = "attack";
  s = applyAction(s, 0, { type: "next" });
  s = applyAction(s, 0, { type: "move", from: "brasil", to: "peru", count: 2 });
  assert.throws(() =>
    applyAction(s, 0, {
      type: "move",
      from: "peru",
      to: "argentina",
      count: 3,
    }),
  );
  s = applyAction(s, 0, {
    type: "move",
    from: "peru",
    to: "argentina",
    count: 2,
  });
  assert.equal(s.board.peru.armies, 3);
});
test("a conquest awards just one card at end of turn", () => {
  let s = game();
  s.phase = "move";
  s.conquered = true;
  const remaining = s.deck.length;
  s = applyAction(s, 0, { type: "next" });
  assert.equal(s.players[0].cards.length, 1);
  assert.equal(s.deck.length, remaining - 1);
  assert.equal(s.current, 1);
});
test("objectives require troop counts and optional third continent", () => {
  const s = game();
  s.players[0].objective = { type: "territories", count: 18, min: 2 };
  TERRITORIES.forEach(
    (t, i) => (s.board[t.id] = { owner: i < 18 ? 0 : 1, armies: 1 }),
  );
  assert.equal(achieved(s, 0), false);
  owned(s, 0).forEach((t) => (s.board[t.id].armies = 2));
  assert.ok(achieved(s, 0));
  s.players[0].objective = {
    type: "continents",
    continents: ["eu", "oc"],
    extra: true,
  };
  TERRITORIES.forEach(
    (t) => (s.board[t.id].owner = ["eu", "oc"].includes(t.continent) ? 0 : 1),
  );
  assert.ok(controls(s, 0, "eu"));
  assert.equal(achieved(s, 0), false);
  TERRITORIES.filter((t) => t.continent === "sa").forEach(
    (t) => (s.board[t.id].owner = 0),
  );
  assert.ok(achieved(s, 0));
});
test("guest snapshots conceal deck, other hands and secret objectives", () => {
  const s = game();
  s.players[0].cards = [{ id: "wild1", symbol: 3 }];
  const v = viewFor(s, 1);
  assert.deepEqual(v.deck, []);
  assert.deepEqual(v.players[0].cards, []);
  assert.equal(v.players[0].cardCount, 1);
  assert.equal(v.players[0].objective, null);
  assert.ok(v.players[1].objective);
  s.winner = 0;
  assert.ok(viewFor(s, 1).players[0].objective);
});
test("bots play full matches without illegal actions, troop loss or card duplication", () => {
  for (const seed of [1, 2, 3, 42, 993]) {
    const random = rng(seed);
    let s = createGame(
      Array.from({ length: 3 }, (_, i) => ({ name: `Bot ${i}`, bot: true })),
      { random },
    );
    let actions = 0;
    while (s.winner === null && actions < 20000) {
      s = applyAction(s, s.current, botAction(s, random), random);
      actions++;
      for (const cell of Object.values(s.board)) {
        assert.ok(cell.armies >= 1);
        assert.ok(Number.isInteger(cell.armies));
      }
      const cards = [
        ...s.deck,
        ...s.discard,
        ...s.players.flatMap((p) => p.cards),
      ];
      assert.equal(cards.length, 44);
      assert.equal(new Set(cards.map((c) => c.id)).size, 44);
    }
    assert.notEqual(s.winner, null, `seed ${seed} must finish`);
    assert.ok(achieved(s, s.winner));
  }
});
