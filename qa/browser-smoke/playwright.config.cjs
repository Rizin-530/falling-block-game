const { defineConfig } = require("@playwright/test");

const headed = process.env.SMOKE_HEADED === "1";
const baseURL = "http://127.0.0.1:4173/";

module.exports = defineConfig({
  testDir: ".",
  testMatch: "smoke.spec.cjs",
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "line",
  globalSetup: require.resolve("./global-setup.cjs"),
  globalTeardown: require.resolve("./global-teardown.cjs"),
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    headless: !headed,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
