#!/usr/bin/env node
/**
 * Bundles YOU MAN into one self-contained HTML file.
 *
 * Everything the game needs — Three.js, all modules, the stylesheet — is
 * inlined, so the result runs from a single file with no server, no imports
 * and no network access at all. Used for sandboxed hosts that only accept one
 * document, and handy as a drag-and-drop build.
 *
 *   node tools/build-single.mjs [outfile]
 *
 * Pass --fragment to omit <html>/<head>/<body> for hosts that supply their own
 * document skeleton.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => a !== '--fragment');
const FRAGMENT = process.argv.includes('--fragment');
const OUT = resolve(ROOT, args[0] || 'dist/you-man.html');

const tmp = resolve(ROOT, '.bundle.tmp.js');
execFileSync(
  'npx',
  ['--yes', 'esbuild@0.24.0', resolve(ROOT, 'src/main.js'),
   '--bundle', '--format=iife', '--minify', '--target=es2020', `--outfile=${tmp}`],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] }
);
const bundle = readFileSync(tmp, 'utf8');
rmSync(tmp);

const css = readFileSync(resolve(ROOT, 'styles/main.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

// Take the markup between <body> and </body>, minus the tags that pull in the
// external stylesheet and module entry point.
const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script[^>]*type="module"[^>]*><\/script>/g, '')
  .trim();

const VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

// In fragment mode there is no <head> of our own to put the viewport tag in,
// and a <meta> placed in <body> is ignored — mobile browsers would fall back
// to a ~980px layout viewport and render the game zoomed out. So it is
// installed into the real <head> at runtime instead.
const viewportShim = FRAGMENT
  ? `<script>(function(){var m=document.querySelector('meta[name="viewport"]')||document.head.appendChild(document.createElement('meta'));m.name='viewport';m.content=${JSON.stringify(VIEWPORT)};})();</script>\n`
  : '';

const head = `<title>YOU MAN</title>
${FRAGMENT ? '' : `<meta name="viewport" content="${VIEWPORT}" />\n`}<meta name="theme-color" content="#03070f" />
<style>
/* The host may composite this page over a light ground, so the game paints
   its own background explicitly rather than inheriting one. */
html, body { background: #03070f; }
${css}
</style>`;

const script = `<script>window.YOUMAN_SINGLE_FILE = true;</script>
<script>${bundle}</script>`;

const out = FRAGMENT
  ? `${head}\n${viewportShim}${body}\n${script}\n`
  : `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n${head}\n</head>\n<body>\n${body}\n${script}\n</body>\n</html>\n`;

writeFileSync(OUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`wrote ${OUT} (${kb} KB, ${FRAGMENT ? 'fragment' : 'full document'})`);
