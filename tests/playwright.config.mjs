import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 20000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8765',
    viewport: { width: 390, height: 844 },   // 휴대폰 화면 크기
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:8765',
    reuseExistingServer: false,
  },
});
