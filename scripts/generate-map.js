// Natural Earth geography is public domain. Generate once; runtime uses the JSON only.
import fs from "node:fs";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { Delaunay } from "d3-delaunay";
import clipping from "polygon-clipping";

const atlas = JSON.parse(
  fs.readFileSync(
    new URL("../node_modules/world-atlas/countries-110m.json", import.meta.url),
  ),
);
const countries = feature(atlas, atlas.objects.countries).features.filter(
  (f) => f.id !== "010",
);
const collection = { type: "FeatureCollection", features: countries };
const projection = geoNaturalEarth1().fitExtent(
  [
    [28, 48],
    [1052, 550],
  ],
  collection,
);
const path = geoPath(projection).digits(2);
const seeds = {
  alaska: [-153, 65, "na"],
  mackenzie: [-112, 65, "na"],
  groenlandia: [-42, 73, "na"],
  vancouver: [-123, 51, "na"],
  ottawa: [-94, 52, "na"],
  labrador: [-65, 53, "na"],
  california: [-117, 36, "na"],
  novayork: [-83, 36, "na"],
  mexico: [-101, 22, "na"],
  venezuela: [-65, 7, "sa"],
  peru: [-76, -11, "sa"],
  brasil: [-49, -10, "sa"],
  argentina: [-65, -37, "sa"],
  islandia: [-19, 65, "eu"],
  inglaterra: [-3, 54, "eu"],
  suecia: [18, 64, "eu"],
  alemanha: [10, 51, "eu"],
  polonia: [24, 51, "eu"],
  franca: [1, 44, "eu"],
  moscou: [38, 59, "eu"],
  argelia: [3, 28, "af"],
  egito: [30, 27, "af"],
  sudao: [33, 9, "af"],
  congo: [18, -6, "af"],
  africasul: [24, -26, "af"],
  madagascar: [47, -20, "af"],
  omsk: [62, 58, "as"],
  dudinka: [86, 70, "as"],
  siberia: [113, 66, "as"],
  tchita: [115, 54, "as"],
  vladivostok: [145, 57, "as"],
  mongolia: [100, 46, "as"],
  japao: [138, 36, "as"],
  aral: [62, 42, "as"],
  china: [105, 30, "as"],
  india: [78, 20, "as"],
  vietna: [108, 16, "as"],
  orientemedio: [46, 28, "as"],
  sumatra: [102, -2, "oc"],
  borneo: [114, 1, "oc"],
  novaguine: [144, -6, "oc"],
  australia: [135, -26, "oc"],
};
const sa = new Set(
  "032 068 076 152 170 218 238 254 328 600 604 740 858 862".split(" "),
);
const eu = new Set(
  "008 040 056 070 100 112 191 196 203 208 233 246 250 276 300 348 352 372 380 428 440 442 498 499 528 578 616 620 642 688 703 705 724 752 756 804 807 826".split(
    " ",
  ),
);
const af = new Set(
  "012 024 072 108 120 132 140 148 174 178 180 204 226 231 232 262 266 270 288 324 384 404 426 430 434 450 454 466 478 480 504 508 516 562 566 624 638 646 678 686 690 694 706 710 716 728 729 732 748 768 788 800 818 834 854 894".split(
    " ",
  ),
);
const oc = new Set("036 090 242 360 540 548 554 598 626".split(" "));
const na = new Set(
  "044 084 124 188 192 214 222 304 320 332 340 388 484 558 591 630 780 840".split(
    " ",
  ),
);
const groups = Object.fromEntries(
  ["na", "sa", "eu", "af", "as", "oc"].map((id) => [id, []]),
);
// geoPath clips the dateline. Read its projected rings to keep Russia's two sides apart.
function rings(svg) {
  return [...svg.matchAll(/M([^MZ]+)Z/g)].map((m) => {
    const points = m[1].split("L").map((p) => p.split(",").map(Number));
    points.push([...points[0]]);
    return [points];
  });
}
for (const f of countries) {
  const polygons = rings(path(f));
  if (f.id === "643") {
    const meridian = Array.from({ length: 101 }, (_, i) =>
      projection([43, 90 - i * 1.8]),
    );
    const west = [[[-100, -100], ...meridian, [-100, 710], [-100, -100]]];
    const east = [[[1200, -100], ...meridian, [1200, 710], [1200, -100]]];
    groups.eu.push(clipping.intersection(polygons, west));
    groups.as.push(clipping.intersection(polygons, east));
  } else {
    const id = sa.has(f.id)
      ? "sa"
      : eu.has(f.id)
        ? "eu"
        : af.has(f.id)
          ? "af"
          : oc.has(f.id)
            ? "oc"
            : na.has(f.id)
              ? "na"
              : "as";
    groups[id].push(polygons);
  }
}
const round = (n) => Math.round(n * 100) / 100;
const toPath = (multi) =>
  multi
    .map((poly) =>
      poly
        .map(
          (ring) =>
            "M" +
            ring.map(([x, y]) => `${round(x)},${round(y)}`).join("L") +
            "Z",
        )
        .join(""),
    )
    .join("");
const continents = {};
const territories = {};
for (const [continent, parts] of Object.entries(groups)) {
  const land = clipping.union(...parts);
  continents[continent] = toPath(land);
  const entries = Object.entries(seeds).filter(([, s]) => s[2] === continent);
  const points = entries.map(([, s]) => projection(s));
  const cells = Delaunay.from(points).voronoi([0, 0, 1080, 610]);
  entries.forEach(([id], i) => {
    const cell = [cells.cellPolygon(i).map(([x, y]) => [x, y])];
    const shape = clipping.intersection(land, cell);
    territories[id] = {
      x: round(points[i][0]),
      y: round(points[i][1]),
      path: toPath(shape),
    };
  });
}
// Offset crowded European labels, with leader lines keeping their anchors unambiguous.
const labels = {
  islandia: [15, -8],
  inglaterra: [-13, 5],
  suecia: [7, -23],
  alemanha: [-11, 21],
  polonia: [25, 13],
  franca: [-32, 23],
  moscou: [23, -6],
  borneo: [12, -18],
  sumatra: [-15, 13],
  novaguine: [13, -10],
  japao: [21, 8],
};
for (const [id, [dx, dy]] of Object.entries(labels)) {
  territories[id].labelX = round(territories[id].x + dx);
  territories[id].labelY = round(territories[id].y + dy);
}
const map = {
  attribution:
    "Natural Earth (public domain), via world-atlas 2.0.2. Strategic regions are original schematic partitions, not political boundaries.",
  continents,
  territories,
  graticule: path(geoGraticule10()),
  coastline: path(collection),
};
fs.writeFileSync(
  new URL("../src/map-geometry.json", import.meta.url),
  JSON.stringify(map),
);
console.log(
  `Generated ${Object.keys(territories).length} territories with Natural Earth coastlines.`,
);
