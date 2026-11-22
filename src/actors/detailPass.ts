/**
 * Switch for the detail pass (per-character-motion, task 5.6): finger and twist solving and trunk distribution. `?detail=0`
 * turns it off so it can be compared with and without, and as a fallback.
 */
export const detailPass = { enabled: true };

/** Read `?detail=0|1` from a query string. */
export function readDetailFlag(search: string): void {
  const v = new URLSearchParams(search).get('detail');
  if (v !== null) detailPass.enabled = v !== '0' && v !== 'off';
}
