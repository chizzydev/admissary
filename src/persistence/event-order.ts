/** Server-owned recording time, independent of caller/business occurrence time.
 * The process-wide clock also orders Product/Assurance appends in one host
 * process. Per-source append sequence persists order across restarts. Historical
 * records without these fields remain explicitly unproven across sources. */
let lastRecordedMs = 0;
export interface RecordedEventOrder { recordedAt?: string; appendSequence?: number; }
export function recordEventOrder(events: readonly RecordedEventOrder[]) {
  const previous = events.reduce((max, event) => Math.max(max, event.recordedAt ? Date.parse(event.recordedAt) : 0), 0);
  lastRecordedMs = Math.max(Date.now(), previous + 1, lastRecordedMs + 1);
  return { recordedAt: new Date(lastRecordedMs).toISOString(), appendSequence: events.length + 1 };
}
