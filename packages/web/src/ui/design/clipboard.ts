/**
 * Copying, including when it does not work.
 *
 * `navigator.clipboard` is undefined outside a secure context, which is exactly
 * what a team serving this static app to each other over plain HTTP on a LAN
 * has — a realistic way to run a local-first tool, and one where the call used
 * to throw before it ever returned a promise. Where the API does exist it still
 * rejects on a denied permission or an unfocused document.
 *
 * All three used to fail the same way: nothing on the clipboard, no message,
 * and a button that flipped to "Copied" regardless. Whoever then pasted got
 * whatever they had copied before — which for a share link is a failure the
 * sender cannot see and the recipient cannot diagnose.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** What to tell someone whose browser would not let us copy for them. */
export const COPY_REFUSED = 'The browser would not let Kanbo copy. Select the text and copy it.'
