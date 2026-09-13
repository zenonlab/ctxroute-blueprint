#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [scenePath, navigationPath] = process.argv.slice(2);
if (!scenePath || !navigationPath) process.exit(2);
const scene = JSON.parse(await readFile(scenePath, "utf8"));
const navigation = JSON.parse(await readFile(navigationPath, "utf8"));
const regions = scene.instances.filter(i => i.id.startsWith("activity.region."))
  .map(i => { const m = i.id.match(/\.([a-g])(\d+)$/); return { row: +m[2], col: m[1].charCodeAt(0) - 97, p: i.translation }; })
  .sort((a, b) => a.row - b.row || (a.row % 2 ? b.col - a.col : a.col - b.col));
const radius = 9000, points = [];
for (const { p: [x, , z] } of regions) for (const [dx, dz] of [[0, -radius], [radius, 0], [0, radius], [-radius, 0]]) points.push([x + dx, 0, z + dz]);
const bridged = [];
for (let i = 0; i < points.length; i += 4) {
  const orbit = points.slice(i, i + 4);
  if (bridged.length) {
    const a = bridged.at(-1), b = orbit[0], d = Math.hypot(b[0] - a[0], b[2] - a[2]), steps = Math.max(1, Math.ceil(d / 30000));
    for (let s = 1; s < steps; s++) { const t = s / steps; bridged.push([a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t]); }
  }
  bridged.push(...orbit);
}
const nodes = bridged.map((p, i) => ({ id: `orbit-${String(i).padStart(3, "0")}`, position: p, next: [`orbit-${String((i + 1) % bridged.length).padStart(3, "0")}`], annotations: {} }));
navigation.nodes = nodes;
navigation.recipe.route = nodes.map(n => n.id);
navigation.recipe.instances = [{ id: "route.primary", speed: 4200, start_distance: 0 }];
navigation.recipe.source = { ...navigation.recipe.source, adapter: "gcn-orbit-route-author-v2", scope: "source-region orbit traversal" };
await writeFile(navigationPath, `${JSON.stringify(navigation, null, 2)}\n`);
console.log(JSON.stringify({ format: "orbite.route-author/2", regions: regions.length, nodes: nodes.length, closed: true }));
