/** Opt-in browser diagnostics used by the responsiveness smoke. Labels contain
 * no user data, and ordinary sessions do not allocate performance entries. */
export function measureAuthoringWork<T>(label: string, work: () => T): T {
  if (!(globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings) return work();
  const start = performance.now();
  try { return work(); }
  finally { performance.measure(`fenel:${label}`, { start, end: performance.now() }); }
}
