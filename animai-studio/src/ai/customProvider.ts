import { CloudProvider } from "./cloudProvider";

export class CustomProvider extends CloudProvider {
  id = "custom";
  name = "Custom endpoint";
  description = "Bring your own OpenAI-compatible or ANIMAI HTTP endpoint.";
}
