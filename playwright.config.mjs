import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /acceptance\.playwright\.mjs/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  webServer: {
    command: "python3 -m http.server 8080 --directory docs",
    port: 8080,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], serviceWorkers: "block" },
    },
    {
      name: "iphone-ua-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      },
    },
  ],
});
