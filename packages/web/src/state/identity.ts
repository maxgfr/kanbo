import { type Member, type Project, memberById } from '@kanbo/core'

/**
 * Who is sitting at this machine.
 *
 * Deliberately not in the operation log. "I am Ada" is true of a browser, not
 * of a project: syncing it would tell every other device that they are Ada
 * too, and the next person to open the board on a shared screen would inherit
 * a claim they never made. It lives beside the theme and the sync mode, in
 * localStorage, for the same reason — a preference of this device, holding
 * nothing secret and nothing anyone else needs.
 *
 * Without it `assignee:@me` could never match: the palette and the CLI both
 * passed a null id, so a qualifier the README offers as an example of the
 * query language quietly returned nothing at all.
 */
const KEY = 'kanbo.me'

export function readMeId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // Storage blocked. Nobody is claimed, which is the honest answer.
    return null
  }
}

export function writeMeId(memberId: string | null): void {
  try {
    if (memberId === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, memberId)
  } catch {
    // The screen still updates; only the preference fails to persist.
  }
}

/**
 * The member this device is, resolved against the project as it stands now.
 *
 * A stored id whose person has since been removed — or a project replaced by
 * an import from somewhere else — names nobody, rather than a ghost that no
 * item can ever be assigned to.
 */
export function meIn(project: Project): Member | null {
  return memberById(project, readMeId())
}
