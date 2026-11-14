// Builds health/app.js. Needs esbuild, react and react-dom from the oasis checkout:
//   node scripts/health/build.mjs "/Users/maxmarine/Documents/Claude Code/oasis"
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const oasis = process.argv[2];
if (!oasis) { console.error('usage: node scripts/health/build.mjs <path to the oasis checkout>'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(path.join(oasis, 'package.json'))('esbuild');
const r = await esbuild.build({
  entryPoints: [path.join(here, 'entry.jsx')], outfile: path.join(here, '../../health/app.js'),
  bundle: true, minify: true, format: 'iife', target: 'es2019', jsx: 'transform',
  nodePaths: [path.join(oasis, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, metafile: true,
});
console.log(Object.entries(r.metafile.outputs).map(([f, o]) => `${f} ${o.bytes} bytes`).join('\n'));
