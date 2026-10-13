import { defineConfig, devices } from "@playwright/test";

/* Lets context.route() see requests made by the service worker (Chromium). */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const IPHONE_UA = devices["iPhone 13"].userAgent;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /\.playwright\.mjs$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node e2e/server.mjs",
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], serviceWorkers: "block" },
    },
    {
      name: "webkit-iphone-390",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
      },
    },
    {
      name: "chromium-iphone-ua-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        userAgent: IPHONE_UA,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      },
    },
  ],
});
