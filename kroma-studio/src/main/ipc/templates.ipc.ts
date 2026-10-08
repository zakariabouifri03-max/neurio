import { IPC } from '../../shared/ipc'
import { getTemplateStore } from '../services/storage/template-store'
import { handle } from './handle'

export function registerTemplateHandlers(): void {
  const store = () => getTemplateStore()

  handle(IPC.TEMPLATES_LIST, () => store().list())
  handle(IPC.TEMPLATES_READ, (_event, id) => store().read(String(id)))
  handle(IPC.TEMPLATES_CREATE, (_event, input) => {
    const payload = input as { name: string; category: string; document: unknown; thumbnail?: string | null }
    return store().create(payload)
  })
  handle(IPC.TEMPLATES_DELETE, (_event, id) => {
    store().remove(String(id))
    return { ok: true }
  })
}
