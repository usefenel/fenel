// Test fixture (S1 proxy tracking): an engine module completed BEFORE the
// install module evaluated (late installation). Prints the encoder verdicts.
import "./proxy-tracking-early-engine.fixture";
import "./proxy-tracking-install";
import { snapshotEngineBodyArguments } from "./engine-body-memo";

const s = snapshotEngineBodyArguments([{ plain: 1 }]);
console.log(JSON.stringify({ plain: s.ok ? "ok" : s.reason }));
