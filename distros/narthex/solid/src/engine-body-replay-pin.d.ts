// The production build plugin's pin for the authoring worker's engine-body
// replay artifact (engine-body-replay-plugin.mjs); undefined without a current
// admissible artifact in production or dev.
declare module "virtual:fenel-engine-body-replay" {
  const pin: import("./lib/expression-runner/engine-body-replay-boot").EngineBodyReplayPin | undefined;
  export default pin;
}
