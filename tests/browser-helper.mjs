import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { chromium as playwright } from "@playwright/test";

export async function launchBrowser() {
  // Supply CHROMIUM_PATH to use a locally installed browser instead.
  if (process.env.CHROMIUM_PATH)
    return playwright.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--enable-unsafe-swiftshader",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  const { default: chromium } = await import("@sparticuz/chromium");
  const env = { ...process.env };
  if (process.platform === "linux" && process.arch === "x64") {
    // Minimal CI containers may lack NSS. These libraries ship with the npm browser.
    const cache = path.resolve(".cache/chromium-libs");
    if (!fs.existsSync(path.join(cache, "lib/libnspr4.so"))) {
      fs.mkdirSync(cache, { recursive: true });
      const archive = fileURLToPath(
        new URL(
          "../bin/al2023.tar.br",
          import.meta.resolve("@sparticuz/chromium"),
        ),
      );
      const tar = path.join(cache, "runtime.tar");
      fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(archive)));
      execFileSync("tar", ["-xf", tar, "-C", cache]);
      fs.unlinkSync(tar);
    }
    env.LD_LIBRARY_PATH = [path.join(cache, "lib"), env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":");
  }
  return playwright.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args
      .filter(
        (a) => !["--single-process", "--disable-web-security"].includes(a),
      )
      .concat("--autoplay-policy=no-user-gesture-required"),
    env,
    headless: true,
  });
}
