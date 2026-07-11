// Shared Flashscore feed constants for the api/* functions. The leading underscore keeps
// Vercel from deploying this file as a route. The x-fsign token has been stable for ~a
// decade; if it ever rotates, this is the single place to fix (see the design spec's
// token-rotation note in docs/superpowers/specs/2026-07-10-pbp-live-points-design.md).
export const FEED_HOST = "https://global.flashscore.ninja/2/x/feed";
export const X_FSIGN = "SW9D1eZo";
export const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";
