// Pin the test timezone to UTC so date/time-formatting tests (e.g. formatScheduled) are
// deterministic regardless of the host's local zone or how vitest is launched — the npm
// script, an IDE runner, a bare `vitest`, or a subagent. Node re-reads process.env.TZ on the
// next Date operation, and setupFiles run before any test's Date calls, so this is enough on
// its own; the `TZ=UTC` in the "test" script is kept only as a belt-and-suspenders for tooling
// that reads the zone before this file runs.
process.env.TZ = "UTC";
