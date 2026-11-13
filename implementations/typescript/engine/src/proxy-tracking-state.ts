// Import-free host observation shared by the entry installer and engine root.
// A separate copy starts uninstalled; it cannot recover another copy's state.
export type ProxyTrackingDetector = (value: unknown) => boolean;

let detector: ProxyTrackingDetector | null = null;

export function getProxyTrackingDetector(): ProxyTrackingDetector | null {
  return detector;
}

export function installProxyTrackingDetector(installed: ProxyTrackingDetector): void {
  if (detector !== null) throw new Error("Proxy tracking detector is already installed");
  detector = installed;
}
