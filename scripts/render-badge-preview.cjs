// Render the app's actual emblems into a self-contained PostPlan document.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const webRequire = Module.createRequire(path.join(root, 'apps/web/package.json'));
const ts = webRequire('typescript');
const React = webRequire('react');
const { renderToStaticMarkup } = webRequire('react-dom/server');
const icons = webRequire('lucide-react');
const componentPath = path.join(root, 'apps/web/components/badge-emblem.tsx');
const compiled = ts.transpileModule(fs.readFileSync(componentPath, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const componentModule = new Module(componentPath, module);
componentModule.filename = componentPath;
componentModule.paths = Module._nodeModulePaths(path.dirname(componentPath));
componentModule._compile(compiled, componentPath);
const { BadgeEmblem } = componentModule.exports;
const source = fs.readFileSync(path.join(root, 'apps/web/components/achievement-badges.tsx'), 'utf8');
const definitions = [...source.matchAll(/id: "([^"]+)",\s*name: "([^"]+)",\s*metric: "([^"]+)"[\s\S]*?icon: (\w+)/g)]
  .map(([, id, name, metric, icon]) => ({ id, name, metric, icon }));
if (definitions.length !== 40) throw new Error(`Expected 40 badges, found ${definitions.length}`);
const tiers = ['bronze', 'silver', 'gold', 'platinum', 'ruby', 'sapphire', 'emerald', 'diamond'];
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function emblem(badge, level = 2) {
  if (!icons[badge.icon]) throw new Error(`Unknown icon ${badge.icon}`);
  return renderToStaticMarkup(React.createElement(BadgeEmblem, {
    badgeId: badge.id, icon: icons[badge.icon], level, tierClass: level < 0 ? 'locked' : tiers[level]
  }));
}
const css = fs.readFileSync(path.join(root, 'apps/web/components/badge-emblem.css'), 'utf8');
const featured = ['long-distance', 'adventurous', 'daily', 'mystery', 'environmental', 'geocacher']
  .map(id => definitions.find(b => b.id === id));
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoStats badges · Enamel collection · Pass 02</title>
<style>
${css}
*{box-sizing:border-box}html{scroll-behavior:smooth;background:#16271f;color:#f7efd9}body{margin:0;font-family:Arial,sans-serif}
main,header,footer{max-width:1200px;margin:auto;padding:0 32px}a{color:inherit;text-underline-offset:5px}header{padding-top:28px;display:flex;justify-content:space-between;gap:20px;font-size:11px;font-weight:700;letter-spacing:1px}
.intro{padding:56px 0 25px;display:flex;justify-content:space-between;align-items:end;gap:30px}.kicker{color:#d6bb80;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase}h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(42px,6vw,72px);line-height:1;letter-spacing:-2px;margin:16px 0}p{color:#bac8bd;font-size:14px;line-height:1.6;margin:0;max-width:570px}.count{white-space:nowrap;color:#cbbc98;font-size:12px}
.feature-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:12px 0 38px}.feature{background:#21382c;border:1px solid #3c5040;border-radius:18px;text-align:center;padding:22px 8px 18px}.hero-emblem{height:139px;display:grid;place-items:center}.hero-emblem .badge-picture{transform:scale(1.5);transform-origin:center}h3{font-size:12px;line-height:1.4;margin:10px 0 0;font-weight:600}.feature h3{color:#e7e6d4;font-size:12px}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:15px;border-top:1px solid #425344;padding:26px 0 16px}h2{font:400 27px Georgia,serif;margin:0}.section-heading p{font-size:12px}
.tier-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));background:#eee7d6;border-radius:16px;padding:25px 12px 18px;gap:8px;color:#2c3d30}.tier{text-align:center;min-width:0}.tier .badge-picture{vertical-align:top}.tier strong{display:block;font-size:11px;text-transform:capitalize;margin-top:8px}.tier small{display:block;color:#596653;font-size:10px;margin-top:4px}
.all-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.card{display:flex;gap:16px;align-items:center;border:1px solid #3c5040;background:#21382c;border-radius:14px;padding:18px 14px;min-width:0}.card h3{margin:0 0 5px;color:#f7efd9;font-size:13px}.card p{font-size:11px;line-height:1.35;color:#b3c3b5}.card small{display:block;font-size:9px;color:#b0a587;margin-bottom:7px;letter-spacing:1px}.card>div{min-width:0}
.states{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:36px}.state{padding:25px;background:#1b3025;border:1px solid #3c5040;border-radius:14px;display:flex;gap:24px;align-items:center}.state h3{margin:0 0 6px}.state p{font-size:12px}.small-emblem{width:80px;flex-shrink:0;display:grid;place-items:center}.small-emblem .badge-picture{transform:scale(.6)}
footer{border-top:1px solid #425344;padding-top:20px;padding-bottom:30px;margin-top:35px;font-size:11px;color:#a8b9aa}section{scroll-margin-top:24px}
@media(max-width:1050px){.all-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.feature-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.states{grid-template-columns:1fr}}
@media(max-width:700px){main,header,footer{padding-left:18px;padding-right:18px}.intro{display:block;padding-top:40px}.count{margin-top:18px}.all-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card{flex-direction:column;gap:6px;text-align:center;padding:16px 10px}.tier-grid{grid-template-columns:repeat(4,minmax(0,1fr));row-gap:24px}.section-heading{display:block}.section-heading p{margin-top:8px}.hero-emblem .badge-picture{transform:scale(1.2)}.hero-emblem{height:110px}.feature{padding:14px 5px}.feature h3{font-size:11px}}
@media print{html{background:white;color:#1b3025}.feature,.card,.state{background:#f3f0e6;break-inside:avoid}.card h3,p,.card p{color:#24372b}header a{display:none}}
</style></head><body>
<header><span>GEOSTATS / BADGE COLLECTION</span><a href="#all-badges">See all 40 ↓</a></header>
<main><section class="intro"><div><div class="kicker">Pass 02 · Enamel pins</div><h1>A little more character.</h1><p>Round metal rims, rich enamel colors, and bold symbols. Each badge has its own color family; the rim and small numbered tab show its achievement tier.</p></div><div class="count">40 designs / 8 tiers</div></section>
<div class="feature-grid">${featured.map(b => `<article class="feature"><div class="hero-emblem">${emblem(b)}</div><h3>${escape(b.name.replace(/^The /, ''))}</h3></article>`).join('')}</div>
<section><div class="section-heading"><h2>Eight finishes</h2><p>The same badge, from Bronze to Diamond.</p></div><div class="tier-grid">${tiers.map((tier,i)=>`<div class="tier">${emblem(featured[0],i)}<strong>${tier}</strong><small>Level ${i+1}</small></div>`).join('')}</div></section>
<section id="all-badges"><div class="section-heading"><h2>The complete collection</h2><p>All 40 shown at Gold for comparison. These are design examples, not account stats.</p></div><div class="all-grid">${definitions.map((b,i)=>`<article class="card">${emblem(b)}<div><small>${String(i+1).padStart(2,'0')} / GOLD</small><h3>${escape(b.name.replace(/^The /,''))}</h3><p>${escape(b.metric)}</p></div></article>`).join('')}</div></section>
<section><div class="section-heading"><h2>In use</h2><p>Earned, locked, and compact.</p></div><div class="states"><article class="state">${emblem(featured[2],1)}<div><h3>Daily Cacher · Silver</h3><p>The full-color earned badge.</p></div></article><article class="state">${emblem(featured[2],-1)}<div><h3>Daily Cacher · Locked</h3><p>A readable symbol with a small lock.</p></div></article><article class="state"><span class="small-emblem">${emblem(featured[2],1)}</span><div><h3>48 px wide</h3><p>The same design at a smaller size.</p></div></article></div></section>
</main><footer>GeoStats · Design preview 02 · 2026-09-06</footer></body></html>`;
if (/<script|<iframe|\bon\w+=|https?:\/\//i.test(html.replaceAll('http://www.w3.org/2000/svg', ''))) throw new Error('Unexpected active or external content');
fs.writeFileSync(path.join(root, 'badge-logo-preview.html'), html);
console.log('Rendered all 40 badges using the app component and stylesheet.');
