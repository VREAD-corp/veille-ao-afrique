import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:8765/';
const out = process.argv[2];
const b = await chromium.launch();
for (const [name, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
  await p.goto(base); await p.screenshot({ path: `${out}/${name}-home.png` });
  await p.screenshot({ path: `${out}/${name}-home-full.png`, fullPage: true });
  await p.selectOption('select[name=secteur]', 'energie'); await p.waitForTimeout(2500);
  console.log(name, 'count:', await p.locator('#compte').innerText());
  await p.locator('#compte').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${out}/${name}-filter.png` });
  const href = await p.locator('#resultats .card-title a').first().getAttribute('href');
  await p.goto('http://127.0.0.1:8765' + href); await p.screenshot({ path: `${out}/${name}-tender.png`, fullPage: true });
  await p.goto(base + 'alertes/'); await p.screenshot({ path: `${out}/${name}-alertes.png`, fullPage: true });
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  console.log(name, 'scroll', sw, 'errors', errs.slice(0, 5));
  await p.close();
}
await b.close();
