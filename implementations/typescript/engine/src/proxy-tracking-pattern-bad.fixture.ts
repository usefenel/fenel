// Test fixture (S1b worker-entry pattern, BROKEN): engine code evaluates before
// the install import, as when a bundler hoists a shared chunk above it.
import "./engine-require";
import "./proxy-tracking-install";

await import("./proxy-tracking-pattern-real.fixture");
