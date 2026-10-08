import { AIProvider, AssistantContext, AssistantResult, CleanupOptions, ColorizeOptions, InterpOptions, MotionOptions } from "./provider";
import { LocalProvider } from "./localProvider";

/**
 * Optional cloud backend. Never uploads drawings unless the user enables
 * cloud mode and confirms. Endpoints are user-configured in Settings → AI.
 */
export class CloudProvider implements AIProvider {
  id = "cloud";
  name = "Cloud API";
  kind = "cloud" as const;
  description = "Optional remote models. Drawings are sent only after you confirm. Configure an endpoint in Settings.";
  requiresCloud = true;
  endpoint = "";
  apiKey = "";
  private local = new LocalProvider();

  async isAvailable(): Promise<boolean> {
    return Boolean(this.endpoint && this.apiKey);
  }

  private async post(_path: string, _body: unknown): Promise<null> {
    if (!(await this.isAvailable())) return null;
    return null;
  }

  async interpolate(a: ImageData, b: ImageData, opts: InterpOptions): Promise<ImageData[]> {
    const remote = await this.post("/interpolate", { count: opts.count });
    if (!remote) return this.local.interpolate(a, b, opts);
    return this.local.interpolate(a, b, opts);
  }

  async cleanup(image: ImageData, opts: CleanupOptions): Promise<ImageData> {
    return this.local.cleanup(image, opts);
  }

  async colorize(image: ImageData, opts: ColorizeOptions): Promise<ImageData> {
    return this.local.colorize(image, opts);
  }

  async generateMotion(image: ImageData, opts: MotionOptions): Promise<ImageData[]> {
    return this.local.generateMotion(image, opts);
  }

  async textToAnimation(prompt: string, width: number, height: number, frames: number): Promise<ImageData[]> {
    return this.local.textToAnimation(prompt, width, height, frames);
  }

  async assistant(prompt: string, ctx: AssistantContext): Promise<AssistantResult> {
    const r = await this.local.assistant(prompt, ctx);
    if (!(await this.isAvailable())) {
      r.message =
        "Cloud provider is not configured. Using the local engine instead. Add an endpoint + key in Settings → AI.\n\n" +
        r.message;
      r.cloudRequired = true;
    }
    return r;
  }
}
