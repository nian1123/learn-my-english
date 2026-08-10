import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node tests/fixtures/dictionary-provider.mjs",
      url: "http://127.0.0.1:4174/health",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      command:
        "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
      env: {
        YT_DLP_PATH: "./tests/fixtures/yt-dlp",
        DICTIONARY_API_BASE_URL: "http://127.0.0.1:4174",
        OPENAI_BASE_URL: "http://127.0.0.1:51448/v1",
        OPENAI_API_KEY: "e2e-local-secret",
        OPENAI_MODEL: "e2e-local-model",
        DEEPSEEK_BASE_URL: "https://api.deepseek.example",
        DEEPSEEK_API_KEY: "e2e-deepseek-secret",
        DEEPSEEK_MODEL: "e2e-deepseek-model",
      },
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
