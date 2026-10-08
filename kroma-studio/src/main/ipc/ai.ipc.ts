import { IPC } from '../../shared/ipc'
import type {
  AiBackgroundRemovalRequest,
  AiImageRequest,
  AiTextRequest,
  AiUpscaleRequest,
  DesignGeneratorOptions
} from '../../shared/types/ai'
import { getAiService } from '../services/ai/AIService'
import { handle } from './handle'

export function registerAiHandlers(): void {
  const ai = () => getAiService()

  handle(IPC.AI_STATUS, () => ai().status())
  handle(IPC.AI_PROVIDERS, () => ai().providers())
  handle(IPC.AI_TEXT, (_event, request) => ai().text.generate(request as AiTextRequest))
  handle(IPC.AI_IMAGE, (_event, request) => ai().image.generate(request as AiImageRequest))
  handle(IPC.AI_REMOVE_BG, (_event, request) => {
    const payload = request as AiBackgroundRemovalRequest
    return ai().background.remove(payload.imageDataUrl)
  })
  handle(IPC.AI_UPSCALE, (_event, request) => ai().upscale.upscale(request as AiUpscaleRequest))
  handle(IPC.AI_DESIGN, (_event, options) => ai().design.generate(options as DesignGeneratorOptions))
}
