/**
 * Minimal structural types for `node:sqlite`. Declared locally so the codebase
 * keeps compiling on Node/Electron versions whose bundled @types/node does not
 * yet ship typings for the built-in SQLite module.
 */
export type SQLInputValue = null | number | bigint | string | Uint8Array
export type SQLOutputValue = null | number | bigint | string | Uint8Array
