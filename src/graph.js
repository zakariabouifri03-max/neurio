export const GRAPH_EVENTS = [
  { value: 'proximity', label: 'Player enters radius' },
];
export const GRAPH_CONDITIONS = [
  { value: 'always', label: 'Always' },
  { value: 'night', label: 'Only at night' },
];
export const GRAPH_ACTIONS = [
  { value: 'message', label: 'Show a message' },
  { value: 'open_door', label: 'Open target object' },
  { value: 'toggle_object', label: 'Toggle target visibility' },
  { value: 'heal_player', label: 'Restore player health' },
];

const makeId = () => globalThis.crypto?.randomUUID?.() || `graph-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createGraph({ name = 'New Event Chain', triggerObject = 'Driftwood Cabin', action = 'message', message = 'You reached the shelter.' } = {}) {
  return {
    id: makeId(),
    name,
    enabled: true,
    event: 'proximity',
    triggerObject,
    radius: 4,
    condition: 'always',
    action,
    targetObject: triggerObject,
    message,
    healAmount: 25,
  };
}

export function createDefaultGraphs() {
  return [createGraph({ name: 'Shelter discovered', triggerObject: 'Driftwood Cabin', action: 'message', message: 'Shelter found — the cabin is safe.' })];
}
