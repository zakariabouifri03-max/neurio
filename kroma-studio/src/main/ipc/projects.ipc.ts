import { IPC } from '../../shared/ipc'
import type { CreateProjectInput, SaveProjectInput } from '../../shared/types/project'
import { getProjectStore } from '../services/storage/project-store'
import { handle, arg } from './handle'

export function registerProjectHandlers(): void {
  const store = () => getProjectStore()

  handle(IPC.PROJECTS_LIST, () => store().list())

  handle(IPC.PROJECTS_CREATE, (_event, input) => store().create(arg<CreateProjectInput>(input, { width: 1080, height: 1080 })))

  handle(IPC.PROJECTS_READ, (_event, id) => store().read(String(id)))

  handle(IPC.PROJECTS_SAVE, (_event, input) => store().save(arg<SaveProjectInput>(input, { id: '', document: { version: 3, pages: [] } })))

  handle(IPC.PROJECTS_DUPLICATE, (_event, id) => store().duplicate(String(id)))

  handle(IPC.PROJECTS_DELETE, (_event, id) => {
    store().remove(String(id))
    return { ok: true }
  })

  handle(IPC.PROJECTS_RENAME, (_event, id, name) => store().rename(String(id), String(name)))
}
