import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  timeout: 260_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'unit',
      testMatch: /.*\.unit\.spec\.ts/
    },
    {
      name: 'chromium',
      testIgnore: /.*\.unit\.spec\.ts/
    }
  ],
  use: {
    baseURL: process.env.STAGE_BASE_URL ?? 'https://stage.allright.com',
    locale: 'uk-UA',
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  }
});
