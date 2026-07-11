// Shared test-only helpers for tests/api-*.test.ts. These live OUTSIDE api/ on purpose: Vercel
// deploys every api/* file as a public function unless it is underscore-prefixed, so a *.test.ts
// there ships as a crashing public route (prod-verified: GET /api/live.test → 500).
export function fakeRes() {
  return {
    statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    json(b: unknown) { this.body = b; return this; },
  };
}
