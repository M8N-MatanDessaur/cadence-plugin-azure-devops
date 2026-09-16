/**
 * Small shared pieces.
 *
 * `ago` exists because "3 days ago" reads faster than a timestamp when you are scanning, and
 * scanning is what every list here is for.
 */

export function stripHtml(text) {
  return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function ago(iso) {
  if (!iso) return 'at some point';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export async function waitForTask(api, id, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = await api(`/api/orchestrator/task?id=${id}`).catch(() => null);
    if (!t) continue;
    if (t.state === 'completed') return t.result || '(finished with nothing to say)';
    if (['failed', 'cancelled', 'timeout'].includes(t.state)) return t.error || `The worker ${t.state}.`;
  }
  return 'It is taking too long; the answer will land in the orchestrator.';
}
