require("dotenv").config();
const fs = require("node:fs");
fs.mkdirSync("dist/client", { recursive: true });
fs.writeFileSync(
  "dist/client/desktop-config.json",
  JSON.stringify({
    apiUrl: process.env.VITE_API_URL || "",
    mediaUrl: process.env.LIVEKIT_URL || "",
  }),
);
