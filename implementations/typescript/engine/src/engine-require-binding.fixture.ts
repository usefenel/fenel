// Test fixture (S1b): print the process-start replay epoch binding and exit
// (run under --hot / --watch by engine-body-replay-binding.test.ts).
import "./engine-body-host-install";
import { engineBodyReplaySourceEpochBinding } from "./engine-require";

console.log(JSON.stringify(engineBodyReplaySourceEpochBinding()));
process.exit(0);
