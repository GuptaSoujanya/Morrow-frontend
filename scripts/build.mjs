import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root,
  entryPoints: { main: 'app/js/main.js', workspace: 'app/styles/index.css' },
  bundle: true, splitting:true, chunkNames:'chunks/[name]-[hash]', define:{'process.env.NODE_ENV':JSON.stringify(process.argv.includes('--dev')?'development':'production')}, minify: true, format: 'esm', target: ['es2022'], outdir: 'dist/assets',
  loader: { '.woff2': 'file', '.webp':'file', '.avif':'file', '.svg':'file', '.png':'file' }, assetNames: '[name]-[hash]', publicPath:'/assets', metafile: true });
let html = await readFile(root + 'app/index.html', 'utf8');
const mascotAsset = Object.keys(result.metafile.outputs).find(path => /\/morrow-mascot-[^/]+\.webp$/.test(path));
if (!mascotAsset) throw new Error('The shared Morrow mascot was not included in the build.');
const mascotUrl = '/' + mascotAsset.replace('dist/', '');
// Startup and client-rendered branding share a URL, so the image downloads once.
html = html.replaceAll('/assets/morrow-mascot.webp', mascotUrl);
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
for (const name of Object.keys(result.metafile.outputs).filter(name => /(?:inter|manrope)-latin-/.test(name) && !name.includes('latin-ext-'))) {
  html = html.replace('</head>', `  <link rel="preload" href="/${name.replace('dist/', '')}" as="font" type="font/woff2" crossorigin fetchpriority="high" />\n</head>`);
}
await mkdir(root + 'dist', { recursive: true });
await writeFile(root + 'dist/index.html', html);
// Retire the previous remote browser view from existing build directories too.
await rm(root + 'dist/browser.html', {force: true});
await rm(root + 'dist/assets/browser-page.js', {force: true});
// A real HTTP 404 can recover without JavaScript, auth or API availability.
let notFound = await readFile(root + 'app/404.html', 'utf8');
notFound = notFound.replaceAll('/assets/morrow-mascot.webp', mascotUrl);
notFound = notFound.replace(/  <link rel="stylesheet"[^>]+\/>\n/g, '');
notFound = notFound.replace('</head>', `  <style>${css}</style>\n</head>`);
await writeFile(root + 'dist/404.html', notFound);
await cp(root + 'app/assets/morrow-favicon.png', root + 'dist/assets/morrow-favicon.png');
await mkdir(root + 'artifacts', { recursive: true });
await writeFile(root + 'artifacts/build-meta.json', JSON.stringify(result.metafile, null, 2));
await cp(root + 'app/fonts', root + 'dist/fonts', { recursive: true });
console.log('Dashboard built: lazy route chunks, local graphics and typography.');
