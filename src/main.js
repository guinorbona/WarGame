import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/playfair-display/500.css";
import "@fontsource/playfair-display/500-italic.css";
import "./style.css";
import { TERRITORIES, WORLD, CONTINENTS, COLORS, SYMBOLS } from "./world.js";
import {
  createGame,
  applyAction,
  botAction,
  owned,
  controls,
  objectiveText,
  tradeSets,
} from "./engine.js";
import { Room } from "./network.js";

const app = document.querySelector("#app");
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = null,
  room = null,
  mode = "home",
  me = 0,
  selected = null,
  target = null,
  modal = null,
  tab = "mission",
  lobby = null,
  presence = [],
  timer = null,
  toastTimer = null,
  showConnections = false;
let name = localStorage.getItem("war-name") || "Comandante";
const query = new URLSearchParams(location.search);
let invite = query.get("room") || "";
const phases = { reinforce: "Reforçar", attack: "Atacar", move: "Remanejar" };
const phaseDescription = {
  reinforce: "Distribua seus exércitos antes de avançar.",
  attack: "Escolha sua origem e um território inimigo vizinho.",
  move: "Mova exércitos entre seus territórios vizinhos.",
};
function notify(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.role = "status";
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 6000);
}
function save() {
  if (mode === "solo" && state) {
    try {
      localStorage.setItem("war-save", JSON.stringify(state));
    } catch {
      notify("Não foi possível salvar neste navegador.");
    }
  }
}
function hasSave() {
  try {
    return !!localStorage.getItem("war-save");
  } catch {
    return false;
  }
}
const myTurn = () => state && state.current === me && state.winner === null;
function render() {
  app.innerHTML = `<header class="header"><a href="#" class="brand" data-action="home" aria-label="WAR, início"><span class="brand-mark">W</span><strong>WAR<span>ESTRATÉGIA & CONQUISTA</span></strong></a><nav><button class="nav-button" data-action="rules">Como jogar <span>↗</span></button><span class="edition">EDIÇÃO DIGITAL <i></i></span></nav></header>${state ? gameView() : mode === "lobby" ? lobbyView() : homeView()}<footer><span>UM MUNDO. SUA ESTRATÉGIA.</span><span>Projeto independente de fãs · Sem vínculo com a Grow</span><button data-action="rules">Regras & informações ↗</button></footer>${modal ? modalView() : ""}`;
  bind();
}
function homeView() {
  return `<main class="landing"><section class="hero"><div class="eyebrow"><span></span> A PRÓXIMA JOGADA É SUA</div><h1>O mundo é o<br>seu <em>tabuleiro.</em></h1><p>Trace sua estratégia. Conquiste territórios.<br>Reúna seus amigos para uma nova história.</p><div class="hero-details"><span>42 <small>TERRITÓRIOS</small></span><span>6 <small>CONTINENTES</small></span><span>3–6 <small>JOGADORES</small></span></div></section><section class="hero-map" aria-label="Mapa dos 42 territórios">${mapView(true)}<div class="map-caption"><span class="radar-dot"></span> CENTRAL DE OPERAÇÕES <span>01 / 06</span></div></section><section class="play-section"><div class="section-heading"><div><span class="eyebrow">ESCOLHA SUA MISSÃO</span><h2>Como você vai conquistar?</h2></div><span class="muted">Toda grande conquista começa com uma decisão.</span></div><div class="mode-grid"><button class="mode-card" data-action="solo-modal"><span class="card-top"><span class="mode-icon">♟</span><span class="tag">SEM ESPERA</span></span><h3>Campanha solo</h3><p>Você contra o mundo. Enfrente adversários automáticos e aprimore sua estratégia.</p><span class="card-bottom">Iniciar campanha <span>↗</span></span></button><button class="mode-card online" data-action="create-modal"><span class="card-top"><span class="mode-icon">⚑</span><span class="tag">COM AMIGOS</span></span><h3>Criar uma sala</h3><p>Seu tabuleiro, sua turma. Crie uma partida e compartilhe o convite com seus amigos.</p><span class="card-bottom">Preparar a mesa <span>↗</span></span></button><button class="mode-card" data-action="join-modal"><span class="card-top"><span class="mode-icon">⌁</span><span class="tag">TEM UM CONVITE?</span></span><h3>Entrar em uma sala</h3><p>Os aliados já estão esperando. Use o código da sala para entrar na disputa.</p><span class="card-bottom">Encontrar minha sala <span>↗</span></span></button></div>${hasSave() ? '<button class="resume" data-action="resume">↺ Continuar minha campanha salva <span>→</span></button>' : ""}</section><section class="how-strip"><span class="mini-globe">◎</span><div><strong>Fácil de começar. Impossível prever o final.</strong><p>Objetivos secretos, alianças improváveis e uma nova disputa a cada partida.</p></div><button class="text-button" data-action="rules">Conheça as regras <span>→</span></button></section></main>`;
}
function mapView(decorative = false) {
  const focus = !decorative && selected ? WORLD[selected] : null;
  return `<svg class="world-map ${decorative ? "decorative" : ""}" viewBox="0 0 1080 610" role="group" aria-label="Mapa esquemático. Selecione um território para jogar."><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#81978a" stroke-width=".5" opacity=".12"/></pattern></defs><rect width="1080" height="610" fill="url(#grid)"/><ellipse cx="535" cy="306" rx="505" ry="270" fill="none" stroke="#78917d" stroke-dasharray="3 10" opacity=".15"/>${TERRITORIES.flatMap((t) => t.neighbors.filter((n) => t.id < n && ((showConnections && !decorative) || (focus && (t.id === focus.id || n === focus.id)))).map((n) => `<line x1="${t.x}" y1="${t.y}" x2="${WORLD[n].x}" y2="${WORLD[n].y}" stroke="#e1c087" stroke-width="2" stroke-dasharray="5 5" opacity=".65"/>`)).join("")}<path d="M100 80 Q530 -45 952 90" fill="none" stroke="#81978a" stroke-dasharray="5 7" opacity=".25"/>${TERRITORIES.map(
    (t, i) => {
      const cell = state?.board[t.id];
      const color = decorative
        ? CONTINENTS.find((c) => c.id === t.continent).color
        : COLORS[cell.owner];
      const isNeighbor = focus?.neighbors.includes(t.id),
        active = selected === t.id || target === t.id;
      return `<g ${decorative ? "" : `class="territory ${active ? "selected" : ""} ${isNeighbor ? "neighbor" : ""}" data-territory="${t.id}" tabindex="0" role="button" aria-label="${escape(t.name)}, ${cell.armies} exércitos, ${escape(state.players[cell.owner].name)}"`}><title>${escape(t.name)}${decorative ? "" : ` · ${escape(state.players[cell.owner].name)} · ${cell.armies} exércitos`}</title><polygon points="${t.shape}" fill="${color}" fill-opacity="${decorative ? ".21" : active ? ".65" : ".29"}" stroke="${color}" stroke-width="${active ? 3 : 1}" stroke-linejoin="round"/>${decorative ? `<circle cx="${t.x}" cy="${t.y}" r="3" fill="${color}" opacity=".7"/>` : `<text class="map-label" x="${t.x}" y="${t.y - 10}" text-anchor="middle">${escape(t.name)}</text><circle cx="${t.x}" cy="${t.y + 8}" r="12" fill="${color}"/><text class="army-count" x="${t.x}" y="${t.y + 12}" text-anchor="middle">${cell.armies}</text>`}</g>`;
    },
  ).join(
    "",
  )}${decorative ? '<text x="177" y="363" class="ocean-label">OCEANO PACÍFICO</text><text x="390" y="467" class="ocean-label">ATLÂNTICO</text><text x="705" y="512" class="ocean-label">ÍNDICO</text>' : ""}</svg>`;
}
function lobbyView() {
  return `<main class="lobby-main"><button class="text-button" data-action="leave">← Voltar ao início</button><div class="eyebrow">SALA DE ESTRATÉGIA</div><h1>Reúna seu <em>esquadrão.</em></h1><p class="muted">${lobby ? "Compartilhe o convite. A conquista é melhor em boa companhia." : "Conectando à central de operações…"}</p>${lobby ? `<div class="lobby-layout"><section class="panel"><div class="panel-title">COMANDANTES <span>${lobby.members.length} / 6</span></div>${lobby.members.map((p, i) => `<div class="lobby-player"><span class="avatar" style="--player:${COLORS[i]}">${escape(p.name[0].toUpperCase())}</span><strong>${escape(p.name)}</strong><span class="muted">${!p.online ? "Desconectado" : i === 0 ? "Anfitrião" : "Pronto"}</span></div>`).join("")}${lobby.host ? `<label class="field-label" for="bot-count">ADVERSÁRIOS AUTOMÁTICOS</label><select id="bot-count">${Array.from({ length: 7 - lobby.members.length }, (_, i) => `<option value="${i}" ${i === Math.max(0, 3 - lobby.members.length) ? "selected" : ""}>${i} ${i === 1 ? "adversário" : "adversários"}</option>`).join("")}</select><button class="primary wide" data-action="start-online">Iniciar partida →</button><p class="fine">3 a 6 participantes, contando os adversários automáticos. Todos os humanos precisam estar conectados.</p>` : '<p class="waiting"><span class="radar-dot"></span> Aguardando o anfitrião iniciar a partida.</p>'}</section><section class="invite-panel"><span class="eyebrow">PASSAPORTE PARA A PARTIDA</span><h2>Convide seus amigos.</h2><label class="field-label">CÓDIGO DA SALA</label><div class="room-code">${escape(lobby.code)}</div><button class="primary wide" data-action="copy">Copiar link de convite ↗</button><p class="fine">Mantenha esta aba aberta. A sala usa conexão direta entre os participantes. Se o anfitrião sair, a partida será interrompida.</p></section></div>` : ""}</main>`;
}
function gameView() {
  const current = state.players[state.current],
    p = state.players[me],
    own = owned(state, me),
    armies = own.reduce((n, t) => n + state.board[t.id].armies, 0),
    isTurn = myTurn();
  const pool =
    state.pool + Object.values(state.continentPools).reduce((a, b) => a + b, 0);
  return `<main class="game-main"><div class="game-heading"><div><span class="eyebrow">${mode === "solo" ? "CAMPANHA SOLO" : `SALA ${escape(room?.code || "")}`} <span class="separator">/</span> RODADA ${state.round}</span><h2>A mesa de comando.</h2></div><div class="game-heading-actions"><span class="save-label">${mode === "solo" ? "● Progresso salvo neste navegador" : "● Conexão entre jogadores"}</span><button class="small-button" data-action="leave">Sair da mesa</button></div></div><div class="players-bar">${state.players.map((q) => `<div class="player-chip ${q.id === state.current ? "current" : ""} ${!owned(state, q.id).length ? "eliminated" : ""}" style="--player:${q.color}"><span class="player-dot"></span><div><strong>${escape(q.name)}${q.id === me ? " <small>VOCÊ</small>" : ""}</strong><span>${owned(state, q.id).length} territórios · ${q.cardCount ?? q.cards.length} cartas${q.bot ? " · IA" : mode === "online" && presence.find((m) => m.id === q.id)?.online === false ? " · desconectado" : ""}</span></div>${q.id === state.current ? '<span class="turn-mark">◂</span>' : ""}</div>`).join("")}</div><div class="game-layout"><section class="board-panel"><div class="board-top"><span><i class="status-dot" style="background:${current.color}"></i> ${state.winner !== null ? "Partida encerrada" : isTurn ? "Sua vez, comandante" : `Vez de ${escape(current.name)}`}</span><button class="map-toggle ${showConnections ? "active" : ""}" data-action="connections">⌁ Fronteiras</button></div><div class="map-scroll">${mapView()}</div><div class="continent-legend">${CONTINENTS.map((c) => `<span title="Bônus de ${c.bonus} exércitos, exclusivos deste continente"><i style="background:${c.color}"></i>${c.name} <b>+${c.bonus}</b></span>`).join("")}</div><div class="phase-bar">${["reinforce", "attack", "move"].map((phase, i) => `<span class="${state.phase === phase ? "active" : ""}"><b>0${i + 1}</b> ${phases[phase]}</span>`).join("")}<span class="phase-round">RODADA ${String(state.round).padStart(2, "0")}</span></div></section><aside class="command-panel"><div class="panel-tabs"><button data-tab="mission" class="${tab === "mission" ? "active" : ""}">Missão</button><button data-tab="cards" class="${tab === "cards" ? "active" : ""}">Cartas <small>${p.cards.length}</small></button><button data-tab="log" class="${tab === "log" ? "active" : ""}">Diário</button></div>${
    tab === "mission"
      ? `<div class="mission"><span class="eyebrow">SEU OBJETIVO SECRETO</span><span class="mission-icon">⚑</span><h3>Uma missão.<br>Um novo império.</h3><details><summary>Revelar meu objetivo</summary><p>${escape(objectiveText(p.objective))}</p></details><div class="your-stats"><span><b>${own.length}</b> territórios</span><span><b>${armies}</b> exércitos</span></div></div>`
      : tab === "cards"
        ? cardsView()
        : `<div class="game-log" aria-live="polite">${state.log
            .slice(0, 18)
            .map(
              (l, i) =>
                `<p><span>${String(state.log.length - i).padStart(2, "0")}</span>${escape(l)}</p>`,
            )
            .join("")}</div>`
  }<div class="command-area"><span class="eyebrow">${isTurn ? "SUA PRÓXIMA JOGADA" : "CENTRAL DE OPERAÇÕES"}</span><h3>${isTurn ? `${phases[state.phase]}${state.phase === "reinforce" ? ` <span class="pool">${pool}</span>` : ""}` : "Acompanhe a estratégia"}</h3><p class="command-hint">${isTurn ? phaseDescription[state.phase] : "Explore o mapa e prepare sua próxima jogada."}</p>${
    isTurn &&
    state.phase === "reinforce" &&
    Object.entries(state.continentPools).some(([, n]) => n > 0)
      ? `<p class="fine">Reservas regionais: ${Object.entries(
          state.continentPools,
        )
          .filter(([, n]) => n > 0)
          .map(([c, n]) => `${CONTINENTS.find((x) => x.id === c).name}: ${n}`)
          .join(" · ")}. Use-as no próprio continente.</p>`
      : ""
  }${selectionView()}${isTurn ? `<button class="primary wide" data-action="next" ${state.phase === "reinforce" && (pool > 0 || p.cards.length >= 5) ? "disabled" : ""}>${state.phase === "reinforce" ? "Iniciar ataques" : state.phase === "attack" ? "Encerrar ataques" : "Finalizar meu turno"} →</button>${p.cards.length >= 5 && state.phase === "reinforce" ? '<p class="fine warning">Troca de cartas obrigatória. Abra a aba Cartas.</p>' : ""}` : ""}</div>${diceView()}</aside></div></main>${state.winner !== null ? `<div class="victory-banner" role="status"><span>⚑</span><div><strong>${escape(state.players[state.winner].name)} conquistou a vitória!</strong><p>${escape(objectiveText(state.players[state.winner].objective))}</p></div><button class="small-button" data-action="victory-close">Continuar vendo o mapa</button></div>` : ""}`;
}
function selectionView() {
  if (!selected)
    return '<div class="empty-selection"><span>⌖</span> Selecione um território no mapa</div>';
  const t = WORLD[selected],
    b = state.board[selected];
  let html = `<div class="selection"><div class="selection-title"><strong>${escape(t.name)}</strong><span style="color:${COLORS[b.owner]}">${b.armies} exércitos</span></div><p class="fine">${escape(state.players[b.owner].name)} · ${CONTINENTS.find((c) => c.id === t.continent).name}</p>`;
  if (myTurn() && b.owner === me) {
    if (state.phase === "reinforce") {
      const max = state.pool + (state.continentPools[t.continent] || 0);
      html += max
        ? `<div class="action-row"><input id="amount" type="number" min="1" max="${max}" value="1" aria-label="Exércitos para reforçar"/><button class="secondary" data-action="reinforce">+ Reforçar</button></div>`
        : '<p class="fine">Sem reforços disponíveis para este território.</p>';
    } else {
      const choices = t.neighbors.filter((n) =>
        state.phase === "attack"
          ? state.board[n].owner !== me
          : state.board[n].owner === me,
      );
      html += `<label class="field-label" for="target">${state.phase === "attack" ? "ALVO DO ATAQUE" : "DESTINO"}</label><select id="target"><option value="">Selecione um vizinho</option>${choices.map((n) => `<option value="${n}" ${target === n ? "selected" : ""}>${escape(WORLD[n].name)} (${state.board[n].armies})</option>`).join("")}</select>`;
      if (state.phase === "attack")
        html += `<label class="field-label" for="amount">OCUPAÇÃO SE CONQUISTAR (1 A 3)</label><div class="action-row"><input id="amount" type="number" min="1" max="3" value="1" aria-label="Exércitos para ocupar após conquista"/><button class="danger" data-action="attack" ${!target || b.armies < 2 ? "disabled" : ""}>Lançar dados ⚄</button></div><p class="fine">Ataca com até 3 dados. A ocupação será limitada aos dados de ataque e exércitos restantes.</p>`;
      else
        html += `<div class="action-row"><input id="amount" type="number" min="1" max="${Math.min(state.movable[selected] || 0, b.armies - 1)}" value="1" aria-label="Exércitos para remanejar"/><button class="secondary" data-action="move" ${!target || !(state.movable[selected] > 0) ? "disabled" : ""}>Mover →</button></div>`;
    }
  } else
    html += `<p class="fine">Vizinhos: ${t.neighbors.map((n) => escape(WORLD[n].name)).join(", ")}.</p>`;
  return html + "</div>";
}
function cardsView() {
  const p = state.players[me];
  const can = myTurn() && state.phase === "reinforce";
  return `<div class="cards-section"><span class="eyebrow">SEU ARSENAL ESTRATÉGICO</span><p class="fine">Troque 3 símbolos iguais ou diferentes. Curingas substituem qualquer símbolo. Territórios seus recebem +2.</p><div class="hand">${p.cards.length ? p.cards.map((c) => `<label class="territory-card"><input type="checkbox" name="trade-card" value="${c.id}" ${can ? "" : "disabled"}/><span class="card-symbol">${SYMBOLS[c.symbol] || "★"}</span><span>${escape(WORLD[c.id]?.name || "Curinga")}</span></label>`).join("") : '<p class="empty-cards">Suas conquistas viram cartas.<br>Conquiste ao menos um território para receber uma carta no fim do turno.</p>'}</div><button class="secondary wide" data-action="trade" ${!can || !tradeSets(p.cards).length ? "disabled" : ""}>Trocar cartas selecionadas</button><p class="fine">Próxima troca: ${state.trades < 5 ? 4 + state.trades * 2 : 15 + (state.trades - 5) * 5} exércitos.</p></div>`;
}
function diceView() {
  const d = state.dice;
  return d
    ? `<div class="dice-panel"><span class="eyebrow">ÚLTIMO COMBATE</span><p>${escape(d.from)} → ${escape(d.to)}</p><div class="dice-line"><span>Ataque</span>${d.a.map((n) => `<b class="die attack-die">${n}</b>`).join("")}<small>−${d.lossA}</small></div><div class="dice-line"><span>Defesa</span>${d.d.map((n) => `<b class="die">${n}</b>`).join("")}<small>−${d.lossD}</small></div></div>`
    : "";
}
function modalView() {
  let content = "";
  if (modal === "rules")
    content = `<span class="eyebrow">MANUAL DO COMANDANTE</span><h2>Estratégia antes da sorte.</h2><div class="rules"><p>Adaptação independente das mecânicas clássicas de conquista territorial de WAR. Não é um produto oficial da Grow. O mapa é esquemático; as linhas e a lista de vizinhos definem as fronteiras válidas.</p><h3>01 · Preparação e objetivo</h3><p>3 a 6 jogadores, 42 territórios e 6 continentes. Cada jogador recebe um objetivo secreto: conquistar continentes, 24 territórios, 18 territórios com 2 exércitos em cada um, ou eliminar pessoalmente os exércitos de uma cor. Vence quem cumprir seu objetivo, verificado após cada ação.</p><p>Nesta edição, a distribuição inicial é automática e aleatória: um exército em cada território, depois completam-se 35, 30, 25 ou 20 exércitos por jogador em mesas de 3, 4, 5 ou 6 participantes. Se o objetivo indicar sua própria cor ou uma cor ausente, ele será substituído por conquistar 24 territórios. Se outro jogador eliminar sua cor-alvo, seu objetivo também passa a ser conquistar 24 territórios.</p><h3>02 · Reforços e continentes</h3><p>No início do turno, receba metade dos seus territórios, arredondada para baixo, com mínimo de 3 exércitos. O domínio completo de continentes gera reservas extras, que devem ser usadas no próprio continente: América do Norte +5, América do Sul +2, Europa +5, África +3, Ásia +7, Oceania +2. Distribua todos os reforços antes de atacar.</p><h3>03 · Combates</h3><p>Ataque apenas territórios inimigos vizinhos. Sempre deixe ao menos um exército na origem. O atacante lança até 3 dados (limitados aos exércitos menos um); o defensor lança até 3, limitados aos seus exércitos. Compare os maiores dados em pares: quem tiver o menor perde um exército. Empates favorecem a defesa. Você pode atacar quantas vezes quiser ou pular esta fase.</p><p>Ao conquistar, mova de 1 a 3 exércitos, limitados ao número de dados usados no ataque e aos exércitos restantes. Escolha a ocupação antes de lançar os dados. Eliminar um jogador transfere suas cartas ao vencedor do combate.</p><h3>04 · Remanejamento</h3><p>Após os ataques, mova exércitos entre territórios seus que sejam vizinhos. Exércitos recebidos nesta fase não podem ser movidos novamente. Sempre deixe um na origem. Ao encerrar o turno, você recebe uma carta se conquistou pelo menos um território, independentemente de quantas conquistas fez.</p><h3>05 · Cartas</h3><p>Troque 3 cartas de símbolos iguais ou 3 diferentes; curingas substituem qualquer símbolo. As trocas globais valem 4, 6, 8, 10, 12, 15 e, depois, mais 5 por troca. Cada carta de território que você controla adiciona 2 exércitos diretamente nele. Troque durante os reforços; com 5 ou mais cartas, a troca é obrigatória antes de atacar.</p><h3>06 · Solo e salas on-line</h3><p>No solo, seus oponentes são automáticos e o progresso fica salvo neste navegador. Nas salas, o anfitrião sincroniza e valida as jogadas. Mantenha a aba dele aberta. Os objetivos e cartas dos outros jogadores não são enviados aos convidados; o anfitrião é uma autoridade de confiança e tem acesso técnico ao estado completo.</p><p>O modo on-line usa o servidor público de sinalização do PeerJS e WebRTC. Algumas redes corporativas ou móveis bloqueiam conexões diretas e podem exigir infraestrutura TURN própria. Não há contas, chat, migração de anfitrião nem recuperação da sala após o anfitrião fechar a página. Um convidado pode reconectar à mesma sala usando a mesma aba e navegador.</p></div>`;
  else if (modal === "leave")
    content = `<span class="eyebrow">PAUSA NA CONQUISTA</span><h2>Sair da mesa?</h2><p class="muted">${mode === "solo" ? "Sua campanha está salva neste navegador. Você poderá continuar pelo início." : room?.host ? "Você é o anfitrião. Sair encerrará a conexão de todos e a partida não poderá ser recuperada." : "Você será desconectado. Pode entrar novamente enquanto o anfitrião mantiver a sala aberta."}</p><button class="primary wide" data-action="confirm-leave">Sair da mesa</button>`;
  else
    content = `<span class="eyebrow">${modal === "solo" ? "CAMPANHA SOLO" : modal === "create" ? "JOGUE COM AMIGOS" : "SEU LUGAR À MESA"}</span><h2>${modal === "solo" ? "Prepare sua estratégia." : modal === "create" ? "Uma nova sala." : "Entre na disputa."}</h2><form id="setup-form"><label class="field-label" for="player-name">SEU NOME</label><input id="player-name" maxlength="20" required value="${escape(name)}" autocomplete="nickname"/>${modal === "solo" ? '<label class="field-label" for="players">PARTICIPANTES</label><select id="players"><option value="3">Você + 2 adversários automáticos</option><option value="4">Você + 3 adversários automáticos</option><option value="5">Você + 4 adversários automáticos</option><option value="6">Você + 5 adversários automáticos</option></select><p class="fine">Territórios e exércitos iniciais são distribuídos automaticamente. Sua campanha será salva neste navegador.</p>' : modal === "join" ? `<label class="field-label" for="room-code">CÓDIGO DA SALA</label><input id="room-code" required minlength="10" maxlength="10" pattern="[a-fA-F0-9]{10}" value="${escape(invite)}" placeholder="Ex.: a1b2c3d4e5" autocomplete="off"/><p class="fine">O anfitrião precisa estar com a sala aberta.</p>` : '<p class="fine">Crie a sala e envie o link para até 5 amigos. Você também pode completar a mesa com adversários automáticos.</p>'}<button type="submit" class="primary wide">${modal === "solo" ? "Iniciar campanha" : modal === "create" ? "Criar minha sala" : "Entrar na sala"} →</button></form>`;
  return `<div class="modal-backdrop"><section class="modal ${modal === "rules" ? "rules-modal" : ""}" role="dialog" aria-modal="true" aria-label="${modal === "rules" ? "Regras do jogo" : "Configuração da partida"}"><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button>${content}</section></div>`;
}
function onRoomEvent(type, data) {
  if (type === "error" || type === "notice") notify(data);
  if (type === "identity") me = data;
  if (type === "lobby") {
    lobby = data;
    presence = data.members;
    render();
  }
  if (type === "presence") {
    presence = data;
    if (state) render();
  }
  if (type === "state") {
    state = data;
    mode = "online";
    render();
  }
  if (type === "action") {
    try {
      execute(data.action, data.actor);
    } catch (e) {
      data.connection.send({ type: "error", message: e.message });
    }
  }
}
function execute(action, actor = me) {
  if (mode === "online" && !room.host) {
    room.send(action);
    return;
  }
  state = applyAction(state, actor, action);
  // Only disclose the winning objective to guests when the match ends.
  if (room?.host) room.sync(state);
  save();
  render();
  scheduleBot();
}
function scheduleBot() {
  clearTimeout(timer);
  if (
    !state ||
    state.winner !== null ||
    (mode === "online" && !room?.host) ||
    !state.players[state.current].bot
  )
    return;
  timer = setTimeout(() => {
    try {
      execute(botAction(state), state.current);
    } catch (e) {
      notify(`Adversário automático: ${e.message}`);
    }
  }, 550);
}
function startSolo(count) {
  clearTimeout(timer);
  room?.close();
  room = null;
  mode = "solo";
  me = 0;
  selected = null;
  target = null;
  tab = "mission";
  state = createGame([
    { name },
    ...Array.from({ length: count - 1 }, (_, i) => ({
      name: ["Atlas", "Aurora", "Orion", "Vega", "Ícaro"][i],
      bot: true,
    })),
  ]);
  modal = null;
  save();
  render();
}
function chooseTerritory(id) {
  if (
    selected &&
    myTurn() &&
    state.phase !== "reinforce" &&
    state.board[selected].owner === me &&
    WORLD[selected].neighbors.includes(id) &&
    ((state.phase === "attack" && state.board[id].owner !== me) ||
      (state.phase === "move" && state.board[id].owner === me))
  ) {
    target = id;
  } else {
    selected = id;
    target = null;
  }
  render();
}
function bind() {
  document
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => handle(el.dataset.action)),
    );
  document.querySelectorAll("[data-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      tab = el.dataset.tab;
      render();
    }),
  );
  document.querySelectorAll("[data-territory]").forEach((el) => {
    el.addEventListener("click", () => chooseTerritory(el.dataset.territory));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        chooseTerritory(el.dataset.territory);
      }
    });
  });
  document.querySelector("#target")?.addEventListener("change", (e) => {
    target = e.target.value;
    render();
  });
  document.querySelector("#setup-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    name = document.querySelector("#player-name").value.trim() || "Comandante";
    localStorage.setItem("war-name", name);
    if (modal === "solo") {
      startSolo(Number(document.querySelector("#players").value));
      return;
    }
    const code = document.querySelector("#room-code")?.value;
    const create = modal === "create";
    room?.close();
    room = new Room(onRoomEvent);
    mode = "lobby";
    lobby = null;
    modal = null;
    me = 0;
    render();
    try {
      if (create) room.create(name);
      else room.join(code, name);
    } catch (err) {
      notify(err.message);
    }
  });
  document.querySelector(".modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) {
      modal = null;
      render();
    }
  });
  if (modal) {
    const dialog = document.querySelector(".modal");
    dialog.querySelector("input,button")?.focus();
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [
        ...dialog.querySelectorAll("button,input,select,a,[tabindex]"),
      ].filter((x) => !x.disabled);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
}
async function handle(action) {
  try {
    if (action === "rules") {
      modal = "rules";
      render();
    }
    if (action === "close-modal") {
      modal = null;
      render();
    }
    if (
      action === "solo-modal" ||
      action === "create-modal" ||
      action === "join-modal"
    ) {
      modal = action.split("-")[0];
      render();
    }
    if (action === "home") {
      if (state || mode === "lobby") {
        modal = "leave";
        render();
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
    if (action === "leave") {
      modal = "leave";
      render();
    }
    if (action === "confirm-leave") {
      save();
      clearTimeout(timer);
      room?.close();
      room = null;
      state = null;
      mode = "home";
      lobby = null;
      modal = null;
      selected = null;
      target = null;
      render();
    }
    if (action === "resume") {
      try {
        const saved = JSON.parse(localStorage.getItem("war-save"));
        if (
          saved?.version !== 1 ||
          !saved.players?.[0]?.objective ||
          TERRITORIES.some((t) => !saved.board?.[t.id])
        )
          throw Error();
        state = saved;
        mode = "solo";
        me = 0;
        modal = null;
        selected = null;
        target = null;
        render();
        scheduleBot();
      } catch {
        notify(
          "A campanha salva não pôde ser recuperada. Inicie uma nova partida.",
        );
      }
    }
    if (action === "start-online") {
      const bots = Number(document.querySelector("#bot-count").value);
      if (lobby.members.length + bots < 3)
        throw Error(
          "Inclua ao menos 3 participantes, contando os adversários automáticos.",
        );
      if (lobby.members.some((p) => !p.online))
        throw Error("Todos os participantes precisam estar conectados.");
      state = createGame([
        ...lobby.members.map((p) => ({ name: p.name })),
        ...Array.from({ length: bots }, (_, i) => ({
          name: `Estrategista ${i + 1}`,
          bot: true,
        })),
      ]);
      mode = "online";
      me = 0;
      room.sync(state);
      render();
      scheduleBot();
    }
    if (action === "copy") {
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("room", room.code);
      try {
        await navigator.clipboard.writeText(url.href);
        notify("Link de convite copiado. Envie para seus amigos!");
      } catch {
        notify(`Copie este convite: ${url.href}`);
      }
    }
    if (action === "connections") {
      showConnections = !showConnections;
      render();
    }
    if (action === "reinforce")
      execute({
        type: "reinforce",
        to: selected,
        count: Number(document.querySelector("#amount").value),
      });
    if (action === "attack")
      execute({
        type: "attack",
        from: selected,
        to: target,
        occupy: Number(document.querySelector("#amount").value),
      });
    if (action === "move")
      execute({
        type: "move",
        from: selected,
        to: target,
        count: Number(document.querySelector("#amount").value),
      });
    if (action === "next") {
      selected = null;
      target = null;
      execute({ type: "next" });
    }
    if (action === "trade")
      execute({
        type: "trade",
        cards: [
          ...document.querySelectorAll('[name="trade-card"]:checked'),
        ].map((x) => x.value),
      });
    if (action === "victory-close")
      document.querySelector(".victory-banner")?.remove();
  } catch (e) {
    notify(e.message);
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal) {
    modal = null;
    render();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (room && !room.closed) {
    e.preventDefault();
    e.returnValue = "";
  }
});
render();
if (invite) {
  modal = "join";
  render();
}
