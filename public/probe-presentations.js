export const creepJsPresentation = {
  title: "messages.browserFingerprintCapture",
  scope: "messages.localCheck",
  success: "messages.fingerprintSubmitted",
  steps: [
    ["messages.captureFingerprint", "messages.runTheCreepjsChecks"],
    ["messages.additionalChecks", "messages.readThePageIframeAndWorker"],
    ["messages.submitResults", "messages.sendFingerprintReadingsToPrism"],
  ],
};

export const fingerprintJsPresentation = {
  title: "messages.fingerprintjsCapture",
  scope: "messages.localCheck",
  steps: [
    ["messages.captureFingerprint", "messages.readFingerprintjsComponents"],
    ["messages.submitResults", "messages.sendFingerprintReadingsToPrism"],
  ],
};

export function networkPresentation({ hasIp, hasDns, hasWebrtc }) {
  return {
    title: "messages.browserNetworkCheck",
    scope: "messages.networkCheck",
    success: "messages.resultsSubmitted",
    steps: [
      ...(hasIp ? [["messages.httpsEgress", "messages.readWebEgressFromIpify"]] : []),
      ...(hasDns ? [['DNS', "messages.observeResolversWithDnscheckTools"]] : []),
      ...(hasWebrtc ? [['WebRTC', "messages.checkTheMappedAddressUsingStuntmanStun"]] : []),
      ["messages.submitResults", "messages.sendTheResultsToPrism"],
    ],
  };
}
export function moduleStep(name, result) {
  return {
    name,
    state: { ok: 'done', unavailable: 'warning', error: 'error', running: 'running' }[result.status],
    elapsedMs: result.elapsedMs ?? result.duration,
    detail: result.error ?? (result.status === 'unavailable' ? "messages.unavailable" : undefined),
  };
}

