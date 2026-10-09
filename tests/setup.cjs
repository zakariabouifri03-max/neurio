module.exports = async () => {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return;
  const { default: chromium, inflate } = require("@sparticuz/chromium");
  const path = require("node:path");
  const bin = path.resolve(
    path.dirname(require.resolve("@sparticuz/chromium")),
    "../bin",
  );
  await inflate(path.join(bin, "al2023.tar.br"));
  await chromium.executablePath();
};
