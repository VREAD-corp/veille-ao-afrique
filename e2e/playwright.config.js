import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 120000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL || 'https://ao-afrique.jalonel.com/', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
