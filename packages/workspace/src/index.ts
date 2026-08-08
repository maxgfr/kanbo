/**
 * One Kanbo project on a filesystem: open it, read it, change it.
 *
 * `@kanbo/core` is the domain and does no I/O. `@kanbo/adapters-node` gives it
 * a disk. This package is the thin layer between them that a *program* needs
 * and the domain rightly refuses to have an opinion about: where the store is,
 * what "APL-12" refers to, and which operations "close this sprint" implies.
 *
 * It renders nothing. The CLI turns these values into text and the MCP server
 * turns them into JSON, and neither of them decides anything about a project —
 * which is what keeps "nothing is re-implemented for the terminal" true now
 * that the terminal is not the only thing out here.
 */
export { type Workspace, defaultRoot, openWorkspace, replaceLog } from './session.ts'

export {
  KanboError,
  resolveField,
  resolveItem,
  resolveLabel,
  resolveMember,
  resolveMilestone,
  resolveSprint,
  resolveStatus,
} from './resolve.ts'

export * from './patch.ts'
export * from './write.ts'
export * from './write-more.ts'
export * from './read.ts'
export * from './read-more.ts'
export * from './share.ts'
export * from './remote.ts'
