import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root,
  entryPoints: { main: 'app/js/main.js', workspace: 'app/styles/index.css' },
  bundle: true, splitting:true, chunkNames:'chunks/[name]-[hash]', define:{'process.env.NODE_ENV':JSON.stringify(process.argv.includes('--dev')?'development':'production')}, minify: true, format: 'esm', target: ['es2022'], outdir: 'dist/assets',
  loader: { '.woff2': 'file', '.webp':'file', '.avif':'file', '.svg':'file', '.png':'file' }, assetNames: '[name]-[hash]', publicPath:'/assets', metafile: true });
let html = await readFile(root + 'app/index.html', 'utf8');
html = html.replace(/  <link rel="stylesheet"[^>]+\/>\n/g, '');
// Inline the compressed application shell. Graphics and fonts stay external.
const css=await readFile(root+'dist/assets/workspace.css','utf8');
html = html.replace('</head>', `  <style>${css}</style>\n</head>`);
const script=await readFile(root+'dist/assets/main.js','utf8');
html = html.replace('<script type="module" src="./js/main.js"></script>',()=>`<script type="module">${script.replace(/<\/script/gi,'<\\/script')}</script>`);
// Preload shared infrastructure only. Route preloading waits for the account
// policy in main.js; the URL alone must not select a private workspace renderer.
const outputs=result.metafile.outputs;
function staticGraph(file,seen=new Set()){
  if(seen.has(file)||!outputs[file])return seen;
  seen.add(file);
  for(const item of outputs[file].imports||[])if(item.kind==='import-statement'&&!item.external)staticGraph(item.path,seen);
  return seen;
}
const core=[...staticGraph('dist/assets/main.js')].filter(p=>p!=='dist/assets/main.js');
const preload=`<script>(()=>{const core=${JSON.stringify(core.map(p=>'/'+p.replace('dist/','')))};for(const href of core){const link=document.createElement('link');link.rel='modulepreload';link.href=href;document.head.append(link);}})();</script>`;
html=html.replace('</head>',`  ${preload}\n</head>`);
for (const name of Object.keys(result.metafile.outputs).filter(name => /source-sans-3-|space-grotesk-/.test(name))) {
  html = html.replace('  <meta name="color-scheme" content="dark" />', `  <meta name="color-scheme" content="dark" />\n  <link rel="preload" href="/${name.replace('dist/', '')}" as="font" type="font/woff2" crossorigin fetchpriority="high" />`);
}
await mkdir(root + 'dist', { recursive: true });
await writeFile(root + 'dist/index.html', html);
// A real HTTP 404 can recover without JavaScript, auth or API availability.
let notFound = await readFile(root + 'app/404.html', 'utf8');
notFound = notFound.replace(/  <link rel="stylesheet"[^>]+\/>\n/g, '');
notFound = notFound.replace('</head>', `  <style>${css}</style>\n</head>`);
await writeFile(root + 'dist/404.html', notFound);
await cp(root + 'app/assets/morrow-mark.svg', root + 'dist/assets/morrow-mark.svg');
await mkdir(root + 'artifacts', { recursive: true });
await writeFile(root + 'artifacts/build-meta.json', JSON.stringify(result.metafile, null, 2));
await cp(root + 'app/fonts', root + 'dist/fonts', { recursive: true });
console.log('Dashboard built: lazy route chunks, local graphics and typography.');
