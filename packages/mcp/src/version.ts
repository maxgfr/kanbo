/**
 * What this server calls itself when a client asks.
 *
 * Kept in its own file because `scripts/sync-version.mjs` rewrites it on every
 * release, and a generated line buried in `main.ts` is a line somebody edits by
 * hand once and then wonders why the release changed it back.
 */
export const VERSION = '0.2.0'
