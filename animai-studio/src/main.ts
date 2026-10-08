import "./styles/app.css";
import { AnimaiApp } from "./ui/app";
import { log } from "./core/logger";

const host = document.getElementById("app");
if (!host) throw new Error("#app missing");

const app = new AnimaiApp();
app.mount(host);

log.info("Boot", {
  desktop: Boolean(window.animaiDesktop),
  userAgent: navigator.userAgent,
});
