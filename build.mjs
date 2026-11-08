// Zero-dependency build: bundles src/js/*.js into one classic script (dist/app.js),
// rewrites index.html to use it, and copies the remaining static assets.
// Output works on any static host, in a sub-folder, and even from file://.
//
//   node build.mjs              -> dist/
//   node build.mjs --out public -> public/
//   node build.mjs --no-minify  -> readable app.js

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outName = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist';
const minify = !args.includes('--no-minify');
const src = path.join(root, 'src');
const out = path.resolve(root, outName);

// Dependency order: modules must come after the ones they import.
const MODULE_ORDER = ['engine.js', 'audio.js', 'storage.js', 'main.js'];

function stripModuleSyntax(code, file) {
  // Remove single- or multi-line `import ... from '...';` statements.
  let result = code.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  // `export function foo` -> `function foo`, `export const X` -> `const X`
  result = result.replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, '');
  if (/^\s*(import|export)\s/m.test(result)) {
    throw new Error(`Unsupported import/export syntax left in ${file}`);
  }
  return result;
}

function minifyJs(code) {
  // Conservative: drop full-line comments and blank lines, trim indentation.
  // (Avoids touching strings, regexes or inline comments.)
  return code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n');
}

function minifyCss(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

async function listJs(dir) {
  return (await readdir(dir)).filter((f) => f.endsWith('.js'));
}

async function main() {
  const present = await listJs(path.join(src, 'js'));
  const missing = present.filter((f) => !MODULE_ORDER.includes(f));
  if (missing.length) {
    throw new Error(`Add ${missing.join(', ')} to MODULE_ORDER in build.mjs`);
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // 1. JS bundle
  const parts = [];
  for (const file of MODULE_ORDER) {
    const code = await readFile(path.join(src, 'js', file), 'utf8');
    parts.push(`/* ${file} */\n${stripModuleSyntax(code, file)}`);
  }
  let bundle = `(function () {\n'use strict';\n${parts.join('\n')}\n})();\n`;
  if (minify) bundle = minifyJs(bundle) + '\n';
  await writeFile(path.join(out, 'app.js'), bundle);

  // 2. HTML (swap the module entry for the bundle)
  let html = await readFile(path.join(src, 'index.html'), 'utf8');
  const tag = '<script type="module" src="js/main.js"></script>';
  if (!html.includes(tag)) throw new Error('Module script tag not found in src/index.html');
  html = html.replace(tag, '<script defer src="app.js"></script>');
  await writeFile(path.join(out, 'index.html'), html);

  // 3. CSS
  let css = await readFile(path.join(src, 'style.css'), 'utf8');
  if (minify) css = minifyCss(css);
  await writeFile(path.join(out, 'style.css'), css);

  // 4. Any other static assets (icons, fonts, ...) except js/, index.html, style.css
  for (const entry of await readdir(src)) {
    if (['js', 'index.html', 'style.css'].includes(entry)) continue;
    await cp(path.join(src, entry), path.join(out, entry), { recursive: true });
  }

  const size = async (f) => ((await stat(path.join(out, f))).size / 1024).toFixed(1) + ' KB';
  console.log(`Built ${path.relative(root, out) || '.'}/`);
  for (const f of ['index.html', 'style.css', 'app.js']) console.log(`  ${f.padEnd(11)} ${await size(f)}`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
