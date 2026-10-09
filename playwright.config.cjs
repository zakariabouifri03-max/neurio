const { defineConfig } = require("@playwright/test");
const packaged = require("@sparticuz/chromium").default;
const { tmpdir } = require("node:os");
const { join } = require("node:path");
module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  globalSetup: "./tests/setup.cjs",
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_EXECUTABLE_PATH || join(tmpdir(), "chromium"),
      args: packaged.args.filter(
        (arg) =>
          !arg.includes("disable-web-security") &&
          !arg.includes("single-process"),
      ),
      env: {
        ...process.env,
        LD_LIBRARY_PATH: join(tmpdir(), "al2023/lib"),
        FONTCONFIG_PATH: join(tmpdir(), "fonts"),
      },
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
  },
});
