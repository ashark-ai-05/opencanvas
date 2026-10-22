#!/usr/bin/env node
/**
 * Snapshot GitHub traffic for the repo into <outDir>/YYYY-MM-DD.json and
 * regenerate <outDir>/README.md as one table row per snapshot.
 *
 *   GITHUB_TOKEN=$(gh auth token) node scripts/traffic-snapshot.mjs metrics
 *
 * GitHub keeps only 14 days of traffic, so a weekly run is the only way to
 * see whether a launch channel moved anything. Idempotent per day. The
 * traffic endpoints need push access on the repo (a PAT or, on Actions,
 * the workflow token when it is allowed to).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.REPO ?? 'ashark-ai-05/opencanvas';
const outDir = process.argv[2] ?? 'metrics';
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

async function gh(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'opencanvas-traffic' },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function snapshot() {
  const [repo, views, clones, referrers, paths] = await Promise.all([
    gh(''),
    gh('/traffic/views'),
    gh('/traffic/clones'),
    gh('/traffic/popular/referrers'),
    gh('/traffic/popular/paths'),
  ]);
  return {
    date: new Date().toISOString().slice(0, 10),
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    views14d: { count: views.count, uniques: views.uniques },
    clones14d: { count: clones.count, uniques: clones.uniques },
    referrers: referrers.map((r) => ({ referrer: r.referrer, count: r.count, uniques: r.uniques })),
    paths: paths.map((p) => ({ path: p.path, count: p.count, uniques: p.uniques })),
    viewsDaily: views.views.map((v) => ({ date: v.timestamp.slice(0, 10), count: v.count, uniques: v.uniques })),
  };
}

export function renderReadme(rows) {
  const lines = [
    '# OpenCanvas traffic snapshots',
    '',
    'Weekly snapshot of GitHub traffic (GitHub itself keeps only 14 days). Written by `scripts/traffic-snapshot.mjs`.',
    '',
    '| date | stars | forks | 14d views | 14d uniques | 14d clone uniques | top referrer |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const top = r.referrers[0] ? `${r.referrers[0].referrer} (${r.referrers[0].uniques})` : '';
    lines.push(`| ${r.date} | ${r.stars} | ${r.forks} | ${r.views14d.count} | ${r.views14d.uniques} | ${r.clones14d.uniques} | ${top} |`);
  }
  return lines.join('\n') + '\n';
}

const snap = await snapshot();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${snap.date}.json`), JSON.stringify(snap, null, 2) + '\n');
const rows = readdirSync(outDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')));
writeFileSync(join(outDir, 'README.md'), renderReadme(rows));
console.log(`${snap.date}: ${snap.stars} stars, ${snap.views14d.uniques} unique visitors / 14d, ${rows.length} snapshots`);
