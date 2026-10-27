import geography from "./map-geometry.json";
import { TERRITORIES, WORLD, CONTINENTS, COLORS } from "./world.js";

// Region colors remain the player colors; only presentation changes.
export function tacticalMap({
  state,
  selected,
  target,
  showConnections,
  zoom = 1,
  decorative = false,
  escape,
}) {
  const focus = !decorative && selected ? WORLD[selected] : null;
  const prefix = decorative ? "overview" : "operation";
  const seaLinks = new Set([
    "alaska:vladivostok",
    "groenlandia:islandia",
    "argelia:brasil",
    "inglaterra:islandia",
    "islandia:suecia",
    "franca:inglaterra",
    "inglaterra:suecia",
    "argelia:franca",
    "egito:franca",
    "africasul:madagascar",
    "madagascar:sudao",
    "japao:mongolia",
    "japao:vladivostok",
    "india:sumatra",
    "borneo:vietna",
    "borneo:sumatra",
    "australia:sumatra",
    "borneo:novaguine",
    "australia:borneo",
    "australia:novaguine",
  ]);
  const routes = TERRITORIES.flatMap((t) =>
    t.neighbors
      .filter((n) => t.id < n)
      .map((n) => ({
        from: t,
        to: WORLD[n],
        sea: seaLinks.has(`${t.id}:${n}`),
      })),
  );
  const connection = ({ from: a, to: b, sea }) => {
    const active = focus && (a.id === focus.id || b.id === focus.id);
    if (!sea && !active && !showConnections) return "";
    if (a.id === "alaska" && b.id === "vladivostok")
      return `<path class="sea-route ${active ? "route-active" : ""}" d="M${a.x},${a.y} Q95,${a.y - 55} 28,${a.y - 25} M1052,${b.y - 25} Q985,${b.y - 55} ${b.x},${b.y}"/>`;
    const midX = (a.x + b.x) / 2,
      midY =
        (a.y + b.y) / 2 - (sea ? Math.min(40, Math.abs(a.x - b.x) * 0.15) : 0);
    return `<path class="${sea ? "sea-route" : "land-route"} ${active ? "route-active" : ""}" d="M${a.x},${a.y} Q${midX},${midY} ${b.x},${b.y}"/>`;
  };
  return `<svg class="world-map tactical-map ${decorative ? "decorative" : ""}" ${decorative ? "" : `style="width:${zoom * 100}%;min-width:${zoom * 850}px"`} viewBox="0 0 1080 610" role="group" aria-label="Mapa tático mundial. Selecione um território para jogar.">
    <defs>
      <pattern id="${prefix}-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#5a9ea6" stroke-width=".4" opacity=".19"/></pattern>
      <pattern id="${prefix}-land" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="#c4e1d9" stroke-width=".4" opacity=".12"/></pattern>
      <radialGradient id="${prefix}-ocean"><stop stop-color="#16303b"/><stop offset="1" stop-color="#080f18"/></radialGradient>
    </defs>
    <rect width="1080" height="610" fill="url(#${prefix}-ocean)"/>
    <rect width="1080" height="610" fill="url(#${prefix}-grid)"/>
    <path d="${geography.graticule}" class="geo-graticule"/>
    <g class="bathymetry" fill="none">${Array.from({ length: 14 }, (_, i) => `<ellipse cx="485" cy="335" rx="${52 + i * 28}" ry="${84 + i * 18}" transform="rotate(-24 485 335)"/>`).join("")}</g>
    <g class="map-regions">${TERRITORIES.map((t) => {
      const cell = state?.board[t.id];
      const color = decorative
        ? CONTINENTS.find((c) => c.id === t.continent).color
        : COLORS[cell.owner];
      const active = selected === t.id || target === t.id;
      return `<g ${decorative ? "" : `class="territory ${active ? "selected" : ""} ${focus?.neighbors.includes(t.id) ? "neighbor" : ""}" data-territory="${t.id}" tabindex="0" role="button" aria-label="${escape(t.name)}, ${cell.armies} exércitos, ${escape(state.players[cell.owner].name)}"`}><title>${escape(t.name)}${decorative ? "" : ` · ${escape(state.players[cell.owner].name)} · ${cell.armies} exércitos`}</title><path class="zone-shape" d="${t.path}" fill="${color}" fill-opacity="${decorative ? 0.35 : active ? 0.83 : 0.53}" stroke="${color}" stroke-width="${active ? 1.6 : 0.65}" stroke-linejoin="round"/><path class="land-hatch" d="${t.path}" fill="url(#${prefix}-land)" pointer-events="none"/></g>`;
    }).join("")}</g>
    <path class="coastline" d="${Object.values(geography.continents).join("")}"/>
    <g class="map-routes" pointer-events="none">${routes.map(connection).join("")}</g>
    <g class="map-markers">${TERRITORIES.map((t, i) => {
      const cell = state?.board[t.id],
        color = decorative
          ? CONTINENTS.find((c) => c.id === t.continent).color
          : COLORS[cell.owner];
      const lx = t.labelX ?? t.x,
        ly = t.labelY ?? t.y,
        active = selected === t.id || target === t.id;
      return decorative
        ? `<g class="overview-marker"><circle cx="${t.x}" cy="${t.y}" r="2" fill="${color}"/><text x="${t.x + 5}" y="${t.y + 2}">${String(i + 1).padStart(2, "0")}</text></g>`
        : `<g class="territory-marker ${active ? "marker-active" : ""}" data-marker="${t.id}" role="button" tabindex="0" aria-label="Selecionar ${escape(t.name)}"><title>${escape(t.name)} · ${cell.armies} exércitos</title>${t.labelX ? `<path class="label-leader" d="M${t.x},${t.y}L${lx},${ly}"/><circle cx="${t.x}" cy="${t.y}" r="2" fill="${color}"/>` : ""}<text class="map-label" x="${lx}" y="${ly - 14}" text-anchor="middle">${escape(t.name)}</text><circle class="unit-marker" cx="${lx}" cy="${ly}" r="10.5" fill="${color}"/><text class="army-count" x="${lx}" y="${ly + 3.5}" text-anchor="middle">${cell.armies}</text>${active ? `<path class="target-reticle" d="M${lx - 16},${ly - 8}v-8h8 M${lx + 8},${ly - 16}h8v8 M${lx + 16},${ly + 8}v8h-8 M${lx - 8},${ly + 16}h-8v-8"/>` : ""}</g>`;
    }).join("")}</g>
    <g class="map-hud" pointer-events="none"><path d="M18 40V18H48 M1032 18H1062V40 M18 570V592H48 M1032 592H1062V570"/><text x="29" y="32">${decorative ? "SATCOM // VISÃO GLOBAL" : "ÁREA DE OPERAÇÕES // GLOBAL"}</text><text x="1050" y="32" text-anchor="end">WGS 84 · NE / 110M</text><text x="29" y="578">INTEL // ${decorative ? "42 SETORES" : "42 TERRITÓRIOS"} · 06 CONTINENTES</text><text x="1050" y="578" text-anchor="end">${decorative ? "RECONHECIMENTO" : focus ? `SETOR ${String(TERRITORIES.indexOf(focus) + 1).padStart(2, "0")} SELECIONADO` : "AGUARDANDO COMANDO"}</text><path d="M1025 490v-35m-7 10 7-10 7 10"/><text x="1025" y="446" text-anchor="middle">N</text></g>
    <g class="ocean-names" pointer-events="none"><text x="132" y="375">PACÍFICO</text><text x="455" y="420">ATLÂNTICO</text><text x="760" y="445">ÍNDICO</text></g>
  </svg>`;
}
