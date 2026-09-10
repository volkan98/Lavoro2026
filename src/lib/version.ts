export const BUILD_VERSION = '2026.03.10-v5.2-single-campaign-authority';
export const BUILD_TIMESTAMP = '2026-09-10T15:15:00Z';

export function logBuildVersionDiagnostics() {
  if (typeof window === 'undefined') return;
  console.info(`[APP VERSION] Build: ${BUILD_VERSION} (${BUILD_TIMESTAMP})`);
}
