import { AIProvider } from "./provider";
import { LocalProvider } from "./localProvider";
import { CloudProvider } from "./cloudProvider";
import { CustomProvider } from "./customProvider";
import { loadSettings, saveSettings } from "../core/settings";

export class AIRegistry {
  readonly providers: AIProvider[] = [new LocalProvider(), new CloudProvider(), new CustomProvider()];
  currentId = "local";

  constructor() {
    const s = loadSettings();
    this.currentId = s.aiProvider || "local";
    const cloud = this.providers.find((p) => p.id === "cloud") as CloudProvider;
    const custom = this.providers.find((p) => p.id === "custom") as CustomProvider;
    cloud.endpoint = s.cloudEndpoint || "";
    cloud.apiKey = s.cloudKey || "";
    custom.endpoint = s.customEndpoint || "";
    custom.apiKey = s.customKey || "";
  }

  current(): AIProvider {
    return this.providers.find((p) => p.id === this.currentId) || this.providers[0];
  }

  setCurrent(id: string): void {
    this.currentId = id;
    const s = loadSettings();
    s.aiProvider = id;
    saveSettings(s);
  }

  configure(partial: { cloudEndpoint?: string; cloudKey?: string; customEndpoint?: string; customKey?: string }): void {
    const s = loadSettings();
    Object.assign(s, partial);
    saveSettings(s);
    const cloud = this.providers.find((p) => p.id === "cloud") as CloudProvider;
    const custom = this.providers.find((p) => p.id === "custom") as CustomProvider;
    if (partial.cloudEndpoint !== undefined) cloud.endpoint = partial.cloudEndpoint;
    if (partial.cloudKey !== undefined) cloud.apiKey = partial.cloudKey;
    if (partial.customEndpoint !== undefined) custom.endpoint = partial.customEndpoint;
    if (partial.customKey !== undefined) custom.apiKey = partial.customKey;
  }
}
