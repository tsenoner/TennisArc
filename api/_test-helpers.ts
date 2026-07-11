// Shared test-only helpers for api/*.test.ts. The leading underscore keeps Vercel from deploying
// this file as a route (same convention as _flashscore.ts).
export function fakeRes() {
  return {
    statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    json(b: unknown) { this.body = b; return this; },
  };
}
