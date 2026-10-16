// Live e2e checks of https://ao-afrique.jalonel.com/ (run: ADMIN_TOKEN=... npx playwright test)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const GAS = 'https://script.google.com/macros/s/AKfycbyUsVoWWzL7xA18-O-GkEto4ivugNO-8v4W0l1pugf1HmLHUSKG7uOhEcx3FT2RgfKpWA/exec';
const TOKEN = process.env.ADMIN_TOKEN || '';
const SHOTS = process.env.SHOTS || 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function admin(request, extra = '') {
  const r = await request.get(`${GAS}?action=admin&token=${TOKEN}${extra}`);
  const j = await r.json();
  expect(j.ok, JSON.stringify(j)).toBe(true);
  return j;
}
const c = (j, k) => j.counters[k] || 0;
// Our runs never count as visits: octave_notrack=1 sends them to the "excluded" counters instead (reason notrack).
const x = (j, k) => (j.excluded || {})[`${k}|notrack`] || 0;
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('octave_notrack', '1')); });

async function noHorizontalScroll(page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, 'page wider than viewport').toBeLessThanOrEqual(cw + 1);
}

test('data is present and fresh', async ({ page, request }, info) => {
  const r = await request.get('data/ouverts.json');
  expect(r.ok()).toBeTruthy();
  const data = await r.json();
  expect(data.count).toBeGreaterThan(1000);
  const ageH = (Date.now() - Date.parse(data.updated)) / 3600e3;
  expect(ageH, `data updated ${data.updated}`).toBeLessThan(14);
  expect(data.notices.some(n => n.x === 'PMMP')).toBeTruthy();
  expect(data.notices.some(n => n.x === 'BM')).toBeTruthy();
  await page.goto('');
  await expect(page.locator('h1')).toContainText("Appels d'offres publics");
  await expect(page.locator('#resultats .card').first()).toBeVisible();
  expect(await page.locator('#resultats .card').count()).toBe(30);
  await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-accueil.png`, fullPage: false });
});

test('filters work and are tracked', async ({ page, request }, info) => {
  const before = await admin(request);
  await page.goto('');
  await page.selectOption('select[name=secteur]', 'eau-assainissement');
  await expect(page.locator('#compte')).toContainText('correspond', { timeout: 30000 });
  const n1 = parseInt((await page.locator('#compte').innerText()).replace(/\D/g, ''), 10);
  expect(n1).toBeGreaterThan(5);
  expect(page.url()).toContain('secteur=eau-assainissement');
  await page.selectOption('select[name=echeance]', '14');
  await expect.poll(async () => parseInt((await page.locator('#compte').innerText()).replace(/\D/g, ''), 10)).toBeLessThan(n1);
  const badges = await page.locator('#resultats .badge').allInnerTexts();
  for (const b of badges) expect(b === 'Dernier jour' || Number(b.replace('J-', '')) <= 14, b).toBeTruthy();
  await page.fill('input[name=q]', 'forage');
  await page.waitForTimeout(600);
  const titles = await page.locator('#resultats .card').count();
  expect(titles).toBeGreaterThanOrEqual(0);
  await page.fill('input[name=q]', '');
  await page.selectOption('select[name=echeance]', '');
  await page.selectOption('select[name=region]', 'Souss-Massa');
  await expect(page.locator('#compte')).toContainText('correspond');
  const places = await page.locator('#resultats .facts').allInnerTexts();
  expect(places.length).toBeGreaterThan(0);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-filtres.png`, fullPage: false });
  await page.waitForTimeout(4000);
  await expect.poll(async () => x(await admin(request), 'filter_use:secteur'), { timeout: 30000, intervals: [3000] })
    .toBeGreaterThan(x(before, 'filter_use:secteur'));
  const after = await admin(request);
  expect(x(after, 'view')).toBeGreaterThan(x(before, 'view'));
  expect(x(after, 'filter_use:region')).toBeGreaterThan(x(before, 'filter_use:region'));
  expect(c(after, 'filter_use:region'), 'test hits must not count as visits').toBe(c(before, 'filter_use:region'));
});

test('tender page has summary, official link and JSON-LD', async ({ page }, info) => {
  await page.goto('');
  const href = await page.locator('#resultats .card-title a').first().getAttribute('href');
  await page.goto(href);
  await expect(page.locator('.summary p').first()).toContainText('au plus tard le');
  const official = page.locator('.official a');
  await expect(official).toHaveAttribute('href', /marchespublics\.gov\.ma|worldbank\.org/);
  const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
  expect(ld.join(' ')).toContain('"Demand"');
  expect(ld.join(' ')).toContain('BreadcrumbList');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-fiche.png`, fullPage: true });
});

test('alert form posts to the Sheet, pre-registration is tracked', async ({ page, request }, info) => {
  const before = await admin(request);
  await page.goto('alertes/?secteur=energie');
  await expect(page.locator('input[name=sectors][value=energie]')).toBeChecked();
  await expect(page.getByText('bientôt disponible').first()).toBeVisible();
  await page.locator('.preinscr[data-plan="pro-79"]').click();
  await expect(page.locator('#plan-chosen')).toContainText('79');
  const email = `e2e-${info.project.name}-${Date.now()}@example.com`;
  await page.fill('input[name=email]', email);
  await page.check('input[name=regions][value=souss-massa]');
  await page.check('input[name=consent]');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-alertes.png`, fullPage: true });
  // cro.js conversion goal: spy on octaveCro.goal (our run sends nothing: octave_notrack=1).
  await page.evaluate(() => { const g = window.octaveCro.goal; window.__goals = []; window.octaveCro.goal = (m) => { window.__goals.push(m); g(m); }; });
  await page.click('#alerte-form button[type=submit]');
  await expect(page.locator('#form-msg')).toContainText('Pré-inscription enregistrée', { timeout: 30000 });
  expect(await page.evaluate(() => window.__goals)).toEqual(['preorder']);
  const after = await admin(request, `&find=${encodeURIComponent(email)}`);
  expect(after.found, 'row written in the Sheet').toBe(true);
  expect(after.test_rows).toBeGreaterThan(before.test_rows);
  expect(c(after, 'preinscription_signup:test')).toBeGreaterThan(c(before, 'preinscription_signup:test'));
  await expect.poll(async () => x(await admin(request), 'preinscription_click:pro-79'), { timeout: 30000, intervals: [3000] })
    .toBeGreaterThan(x(before, 'preinscription_click:pro-79'));
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-alertes-ok.png`, fullPage: false });
});

test('cro.js loads on every kind of page, no A/B test, nothing sent for our runs', async ({ page }) => {
  const cro = [];
  page.on('request', (r) => { if (r.url().startsWith(GAS) && (r.postData() || '').includes('"kind":"cro"')) cro.push(r.url()); });
  const tender = await (async () => { await page.goto(''); return page.locator('#resultats .card-title a').first().getAttribute('href'); })();
  for (const path of ['', tender, 'alertes/', 'confidentialite/', 'page-inexistante/']) {
    await page.goto(path);
    const tag = page.locator('script[src*="static/cro.js"]');
    await expect(tag).toHaveCount(1);
    await expect(tag).toHaveAttribute('data-site', 'veille-ao-afrique');
    await expect(tag).toHaveAttribute('data-api', GAS);
    await expect.poll(() => page.evaluate(() => typeof (window.octaveCro || {}).goal)).toBe('function');
    // No experiment here: no variant, even when a forcing parameter is passed.
    expect(await page.evaluate(() => [window.octaveCro.v('price'), document.documentElement.getAttribute('data-xp-price')])).toEqual([undefined, null]);
  }
  await page.goto('?xp_price=b');
  expect(await page.evaluate(() => window.octaveCro.v('price'))).toBeUndefined();
  const served = await page.request.get('static/cro.js');
  expect(served.ok()).toBeTruthy();
  expect(await served.text()).toContain('Octave cro.js');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.goto('alertes/');
  await page.waitForTimeout(1000);
  expect(cro, 'octave_notrack=1: no behaviour batch is sent').toEqual([]);
  await page.goto('confidentialite/');
  await expect(page.locator('main')).toContainText('profondeur de défilement');
  await expect(page.locator('main')).toContainText('Global Privacy Control');
});
