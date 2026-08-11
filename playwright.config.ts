import { defineConfig, devices } from "@playwright/test";

const externalProviderEnvironment = {
  YT_DLP_PATH: "./tests/fixtures/yt-dlp",
  DICTIONARY_API_BASE_URL: "http://127.0.0.1:4174",
  YOUTUBE_OEMBED_BASE_URL: "http://127.0.0.1:4175/oembed",
};

const configuredAiEnvironment = {
  OPENAI_BASE_URL: "http://127.0.0.1:4176/v1",
  OPENAI_API_KEY: "e2e-local-secret",
  OPENAI_MODEL: "e2e-local-model",
  OPENAI_TIMEOUT_MS: "300",
  DEEPSEEK_BASE_URL: "http://127.0.0.1:4177/v1",
  DEEPSEEK_API_KEY: "e2e-deepseek-secret",
  DEEPSEEK_MODEL: "e2e-deepseek-model",
  DEEPSEEK_TIMEOUT_MS: "300",
};

const unconfiguredAiEnvironment = {
  OPENAI_BASE_URL: "",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "",
  DEEPSEEK_BASE_URL: "",
  DEEPSEEK_API_KEY: "",
  DEEPSEEK_MODEL: "",
};

const localOnlyAiEnvironment = {
  ...configuredAiEnvironment,
  DEEPSEEK_BASE_URL: "",
  DEEPSEEK_API_KEY: "",
  DEEPSEEK_MODEL: "",
};

function applicationServer(
  port: number,
  aiEnvironment: Record<string, string>,
  providerEnvironment: Record<string, string> = {},
) {
  return {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      ...externalProviderEnvironment,
      ...providerEnvironment,
      ...aiEnvironment,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  };
}

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
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: [
    {
      command: "node tests/fixtures/dictionary-provider.mjs",
      url: "http://127.0.0.1:4174/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "node tests/fixtures/youtube-metadata-provider.mjs",
      url: "http://127.0.0.1:4175/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "node tests/fixtures/local-ai-provider.mjs",
      url: "http://127.0.0.1:4176/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "node tests/fixtures/deepseek-provider.mjs",
      url: "http://127.0.0.1:4177/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    applicationServer(3100, configuredAiEnvironment),
    applicationServer(3101, unconfiguredAiEnvironment),
    applicationServer(3102, configuredAiEnvironment, {
      YT_DLP_PATH: "./tests/fixtures/missing-yt-dlp",
    }),
    applicationServer(3103, configuredAiEnvironment, {
      CAPTION_PROVIDER_TIMEOUT_MS: "500",
    }),
    applicationServer(3104, localOnlyAiEnvironment),
  ],
});
