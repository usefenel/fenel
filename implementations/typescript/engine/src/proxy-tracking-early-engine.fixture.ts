// Test fixture (S1 proxy tracking): stands for an engine module that finished
// evaluating before the tracking install (it self-registers, as engine modules do).
import { registerEngineModule } from "./engine-require";

registerEngineModule("proxy-tracking-early-engine.fixture", {});
