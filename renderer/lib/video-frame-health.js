// Video can report "playing" while only its audio clock advances. Treat decoded frames as the truth.
export const ZERO_VIDEO_FRAMES = 'zero-video-frames';

export function classifyVideoFrameHealth(sample = {}) {
  if (!sample.isVideo || sample.paused || sample.ended || sample.errorCode) return null;
  if ((Number(sample.readyState) || 0) < 2 || (Number(sample.elapsedMs) || 0) < 3000) return null;
  if ((Number(sample.currentTimeDelta) || 0) < 0.5) return null;
  if ((Number(sample.frameDelta) || 0) > 0 || (Number(sample.frameCallbackDelta) || 0) > 0) return null;
  if ((Number(sample.videoWidth) || 0) === 0 || sample.qualityAvailable === true) return ZERO_VIDEO_FRAMES;
  return null;
}
