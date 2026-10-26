import { TERRITORIES, WORLD, CONTINENTS, COLORS } from "./world.js";

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export const owned = (s, p) =>
  TERRITORIES.filter((t) => s.board[t.id].owner === p);
export const controls = (s, p, c) =>
  TERRITORIES.filter((t) => t.continent === c).every(
    (t) => s.board[t.id].owner === p,
  );
export function objectiveText(o) {
  if (o.type === "eliminate")
    return `Eliminar pessoalmente todos os exércitos ${o.targetName ? `de ${o.targetName} (cor ${["coral", "jade", "ocre", "azul", "lilás", "marfim"][o.target]})` : `do jogador ${["coral", "jade", "ocre", "azul", "lilás", "marfim"][o.target]}`}. Se outro jogador o eliminar, conquiste 24 territórios.`;
  if (o.type === "territories")
    return `Conquistar ${o.count} territórios${o.min === 2 ? " com pelo menos 2 exércitos em cada um" : ""}.`;
  return `Conquistar ${o.continents.map((c) => CONTINENTS.find((x) => x.id === c).name).join(" e ")}${o.extra ? " e mais um continente à sua escolha" : ""}.`;
}
export function achieved(s, p) {
  const o = s.players[p].objective;
  if (o.type === "eliminate") return s.eliminatedBy?.[o.target] === p;
  if (o.type === "territories")
    return (
      owned(s, p).filter((t) => s.board[t.id].armies >= o.min).length >= o.count
    );
  return (
    o.continents.every((c) => controls(s, p, c)) &&
    (!o.extra ||
      CONTINENTS.filter((c) => controls(s, p, c.id)).length >
        o.continents.length)
  );
}
export function createGame(names, { random = Math.random } = {}) {
  if (names.length < 3 || names.length > 6)
    throw Error("A partida precisa de 3 a 6 jogadores.");
  const objectives = shuffle(
    [
      { type: "territories", count: 24, min: 1 },
      { type: "territories", count: 18, min: 2 },
      { type: "continents", continents: ["as", "sa"] },
      { type: "continents", continents: ["as", "af"] },
      { type: "continents", continents: ["na", "af"] },
      { type: "continents", continents: ["na", "oc"] },
      { type: "continents", continents: ["eu", "sa"], extra: true },
      { type: "continents", continents: ["eu", "oc"], extra: true },
      ...Array.from({ length: 6 }, (_, target) => ({
        type: "eliminate",
        target,
      })),
    ],
    random,
  );
  const players = names.map((p, i) => ({
    ...p,
    id: i,
    color: COLORS[i],
    cards: [],
    objective:
      objectives[i].type === "eliminate" &&
      (objectives[i].target === i || objectives[i].target >= names.length)
        ? { type: "territories", count: 24, min: 1 }
        : objectives[i],
  }));
  for (const p of players)
    if (p.objective.type === "eliminate")
      p.objective.targetName = players[p.objective.target].name;
  const s = {
    version: 1,
    players,
    board: {},
    eliminatedBy: {},
    current: 0,
    round: 1,
    phase: "reinforce",
    pool: 0,
    continentPools: {},
    deck: shuffle(
      [
        ...TERRITORIES.map((t) => ({ id: t.id, symbol: t.symbol })),
        { id: "wild1", symbol: 3 },
        { id: "wild2", symbol: 3 },
      ],
      random,
    ),
    discard: [],
    trades: 0,
    conquered: false,
    log: [],
    winner: null,
    dice: null,
    revision: 0,
  };
  shuffle(TERRITORIES, random).forEach(
    (t, i) => (s.board[t.id] = { owner: i % players.length, armies: 1 }),
  );
  const initial = { 3: 35, 4: 30, 5: 25, 6: 20 }[players.length];
  players.forEach((p, i) => {
    const ts = owned(s, i);
    for (let n = ts.length; n < initial; n++)
      s.board[ts[Math.floor(random() * ts.length)].id].armies++;
  });
  beginTurn(s);
  return s;
}
function log(s, msg) {
  s.log.unshift(msg);
  s.log = s.log.slice(0, 60);
}
function beginTurn(s) {
  s.phase = "reinforce";
  s.pool = Math.max(3, Math.floor(owned(s, s.current).length / 2));
  s.continentPools = {};
  for (const c of CONTINENTS)
    if (controls(s, s.current, c.id)) s.continentPools[c.id] = c.bonus;
  s.conquered = false;
  s.dice = null;
  s.movable = {};
  log(
    s,
    `É a vez de ${s.players[s.current].name}. Reforços disponíveis: ${s.pool + Object.values(s.continentPools).reduce((a, b) => a + b, 0)}.`,
  );
}
export function validSet(cards) {
  if (cards.length !== 3) return false;
  const plain = cards.filter((c) => c.symbol !== 3).map((c) => c.symbol);
  return (
    new Set(plain).size === 1 ||
    new Set(plain).size === plain.length ||
    plain.length === 0
  );
}
export function tradeSets(cards) {
  const sets = [];
  for (let a = 0; a < cards.length; a++)
    for (let b = a + 1; b < cards.length; b++)
      for (let c = b + 1; c < cards.length; c++)
        if (validSet([cards[a], cards[b], cards[c]])) sets.push([a, b, c]);
  return sets;
}
export function resolveDice(attacker, defender) {
  const a = [...attacker].sort((a, b) => b - a),
    d = [...defender].sort((a, b) => b - a);
  let lossA = 0,
    lossD = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++)
    if (a[i] > d[i]) lossD++;
    else lossA++;
  return { a, d, lossA, lossD };
}
function require(condition, message) {
  if (!condition) throw Error(message);
}
function integer(n, min, max) {
  return Number.isInteger(n) && n >= min && n <= max;
}
export function applyAction(state, actor, action, random = Math.random) {
  const s = structuredClone(state);
  require(s.winner === null, "A partida terminou.");
  require(actor === s.current, "Aguarde a sua vez.");
  require(action && typeof action.type === "string", "Comando inválido.");
  const p = s.players[actor];
  if (action.type === "reinforce") {
    require(s.phase === "reinforce", "Os reforços já terminaram.");
    const t = WORLD[action.to];
    require(t && s.board[t.id].owner === actor, "Escolha um território seu.");
    const regional = s.continentPools[t.continent] || 0;
    require(integer(
      action.count,
      1,
      s.pool + regional,
    ), "Quantidade de reforços inválida.");
    const used = Math.min(action.count, regional);
    s.continentPools[t.continent] = regional - used;
    s.pool -= action.count - used;
    s.board[t.id].armies += action.count;
  } else if (action.type === "trade") {
    require(s.phase === "reinforce", "Troque cartas antes de atacar.");
    const ids = action.cards;
    require(Array.isArray(ids) &&
      ids.length === 3 &&
      new Set(ids).size === 3, "Escolha três cartas diferentes.");
    const cards = ids.map((id) => p.cards.find((c) => c.id === id));
    require(cards.every(Boolean) &&
      validSet(cards), "A combinação de cartas não é válida.");
    const bonus = s.trades < 5 ? 4 + s.trades * 2 : 15 + (s.trades - 5) * 5;
    s.trades++;
    s.pool += bonus;
    for (const c of cards)
      if (s.board[c.id]?.owner === actor) s.board[c.id].armies += 2;
    p.cards = p.cards.filter((c) => !ids.includes(c.id));
    s.discard.push(...cards);
    log(s, `${p.name} trocou cartas por ${bonus} exércitos.`);
  } else if (action.type === "next") {
    if (s.phase === "reinforce") {
      require(s.pool === 0 &&
        Object.values(s.continentPools).every(
          (n) => n === 0,
        ), "Distribua todos os reforços primeiro.");
      require(p.cards.length <
        5, "Com 5 ou mais cartas, a troca é obrigatória.");
      s.phase = "attack";
    } else if (s.phase === "attack") {
      s.phase = "move";
      for (const t of owned(s, actor))
        s.movable[t.id] = s.board[t.id].armies - 1;
    } else if (s.phase === "move") {
      if (s.conquered) {
        if (!s.deck.length) {
          s.deck = shuffle(s.discard, random);
          s.discard = [];
        }
        if (s.deck.length) p.cards.push(s.deck.pop());
      }
      let next = (actor + 1) % s.players.length;
      while (!owned(s, next).length) next = (next + 1) % s.players.length;
      if (next <= actor) s.round++;
      s.current = next;
      beginTurn(s);
    }
  } else if (action.type === "attack") {
    require(s.phase === "attack", "Você não está na fase de ataque.");
    const from = WORLD[action.from],
      to = WORLD[action.to];
    require(from &&
      to &&
      from.neighbors.includes(to.id), "Os territórios precisam ser vizinhos.");
    const a = s.board[from.id],
      d = s.board[to.id];
    require(a.owner === actor &&
      d.owner !== actor, "Ataque de um território seu para um adversário.");
    require(a.armies > 1, "É preciso deixar um exército na origem.");
    const diceA = Math.min(3, a.armies - 1),
      diceD = Math.min(3, d.armies);
    const roll = (n) =>
      Array.from({ length: n }, () => 1 + Math.floor(random() * 6));
    const result = resolveDice(roll(diceA), roll(diceD));
    a.armies -= result.lossA;
    d.armies -= result.lossD;
    s.dice = { ...result, from: from.name, to: to.name };
    log(
      s,
      `${from.name} → ${to.name}: atacante perdeu ${result.lossA}, defensor perdeu ${result.lossD}.`,
    );
    if (d.armies === 0) {
      const old = d.owner;
      const requested = integer(action.occupy, 1, 3) ? action.occupy : 1;
      const count = Math.min(requested, diceA, a.armies - 1);
      d.owner = actor;
      d.armies = count;
      a.armies -= count;
      s.conquered = true;
      log(s, `${p.name} conquistou ${to.name}!`);
      if (!owned(s, old).length) {
        s.eliminatedBy ||= {};
        s.eliminatedBy[old] = actor;
        p.cards.push(...s.players[old].cards);
        s.players[old].cards = [];
        log(s, `${s.players[old].name} foi eliminado.`);
        for (const q of s.players)
          if (
            q.id !== actor &&
            q.objective.type === "eliminate" &&
            q.objective.target === old
          )
            q.objective = { type: "territories", count: 24, min: 1 };
      }
    }
  } else if (action.type === "move") {
    require(s.phase === "move", "Remaneje após encerrar os ataques.");
    const from = WORLD[action.from],
      to = WORLD[action.to];
    require(from &&
      to &&
      from.neighbors.includes(to.id), "Remaneje entre territórios vizinhos.");
    require(s.board[from.id].owner === actor &&
      s.board[to.id].owner === actor, "Os dois territórios precisam ser seus.");
    require(integer(
      action.count,
      1,
      Math.min(s.movable[from.id] || 0, s.board[from.id].armies - 1),
    ), "Você só pode mover exércitos que já estavam na origem no início desta fase.");
    s.board[from.id].armies -= action.count;
    s.board[to.id].armies += action.count;
    s.movable[from.id] -= action.count;
    log(
      s,
      `${p.name} moveu ${action.count} exército(s) de ${from.name} para ${to.name}.`,
    );
  } else throw Error("Comando desconhecido.");
  if (achieved(s, actor)) {
    s.winner = actor;
    log(s, `${p.name} cumpriu seu objetivo e venceu!`);
  }
  s.revision++;
  return s;
}
export function viewFor(state, player) {
  const s = structuredClone(state);
  s.deck = [];
  s.discard = [];
  for (const p of s.players) {
    p.cardCount = p.cards.length;
    if (p.id !== player) {
      p.cards = [];
      if (p.id !== s.winner) p.objective = null;
    }
  }
  return s;
}
export function botAction(s, random = Math.random) {
  const p = s.current,
    me = s.players[p],
    ts = owned(s, p);
  const border = ts.filter((t) =>
    t.neighbors.some((n) => s.board[n].owner !== p),
  );
  if (s.phase === "reinforce") {
    const sets = tradeSets(me.cards);
    if (sets.length)
      return { type: "trade", cards: sets[0].map((i) => me.cards[i].id) };
    const regional = Object.keys(s.continentPools).find(
      (c) => s.continentPools[c] > 0,
    );
    if (regional) {
      const choices = ts.filter((t) => t.continent === regional);
      const t = choices.find((t) => border.includes(t)) || choices[0];
      return { type: "reinforce", to: t.id, count: s.continentPools[regional] };
    }
    if (s.pool) {
      const target =
        me.objective.type === "continents"
          ? border.filter((t) => me.objective.continents.includes(t.continent))
          : border;
      const choices = target.length ? target : border.length ? border : ts;
      const t = choices[Math.floor(random() * choices.length)];
      return { type: "reinforce", to: t.id, count: s.pool };
    }
    return { type: "next" };
  }
  if (s.phase === "attack") {
    const options = border
      .flatMap((t) =>
        t.neighbors
          .filter((n) => s.board[n].owner !== p)
          .map((n) => ({
            from: t.id,
            to: n,
            score: s.board[t.id].armies - s.board[n].armies,
          })),
      )
      .filter((x) => s.board[x.from].armies >= 3 && x.score >= 2)
      .sort((a, b) => b.score - a.score);
    if (options.length)
      return {
        type: "attack",
        from: options[0].from,
        to: options[0].to,
        occupy: 3,
      };
    return { type: "next" };
  }
  const inner = ts.find(
    (t) =>
      (s.movable[t.id] || 0) > 0 &&
      t.neighbors.every((n) => s.board[n].owner === p) &&
      t.neighbors.some((n) => border.some((b) => b.id === n)),
  );
  if (inner)
    return {
      type: "move",
      from: inner.id,
      to: inner.neighbors.find((n) => border.some((b) => b.id === n)),
      count: s.movable[inner.id],
    };
  return { type: "next" };
}
