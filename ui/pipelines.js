/**
 * Pipelines, as a bento, inside the Azure DevOps plugin.
 *
 * The pipelines with their latest run, the ones failing or running, then one run: stages,
 * jobs and tasks, the failed tasks with their log tail and the AI's explanation, the
 * commits and work items it carried, and Run again.
 */
import { ago, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export const tone = (r) => (!r ? 'var(--sy-text-3)' : r === 'succeeded' ? 'var(--sy-moss)' : r === 'failed' ? 'var(--sy-rosin)' : r === 'partial' ? 'var(--sy-brass)' : r === 'running' || r === 'queued' || r === 'inProgress' ? 'var(--sy-brass)' : 'var(--sy-text-3)');
export const dur = (ms) => (!ms ? '' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
const state = (r) => (r ? r.result : 'never ran');

export function usePipelines(host, enabled) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => { if (!enabled) return; setError(null); api('/api/pipelines').then((d) => setData(d.pipelines || [])).catch((e) => { setData([]); setError(e.message); }); }, [enabled]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

export function useRun(host, id) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => { if (!id) return; setError(null); api(`/api/pipelines/run?id=${id}`).then(setRun).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => { setRun(null); reload(); }, [reload]);
  return { run, error, reload };
}

const runRow = (host, r, onOpen, name) => ListRow(host, { key: r.id, lead: host.h('span', { className: 'mind-dot', style: { background: tone(r.result) } }), label: `${name ? `${name} ` : ''}${r.number}`, sub: `${r.result}${r.branch ? ` - ${r.branch}` : ''}${r.commit ? ` ${r.commit}` : ''}${r.requestedBy ? ` - ${r.requestedBy}` : ''}${r.reason ? ` - ${r.reason}` : ''}${r.durationMs ? ` - ${dur(r.durationMs)}` : ''}`, meta: ago(r.finishedAt || r.startedAt || r.queuedAt), onClick: () => onOpen(r.id) });

export function Pipelines({ host, pipelines, q, onOpenRun, onOpenPipeline, onQueue, busy }) {
  const { h, ui } = host;
  const { data, error } = pipelines;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = (data || []).filter((p) => !q || p.name.toLowerCase().includes(q));
  const failing = list.filter((p) => p.latestCompleted && p.latestCompleted.result === 'failed');
  const running = list.filter((p) => p.latest && (p.latest.result === 'running' || p.latest.result === 'queued'));
  const green = list.filter((p) => p.latestCompleted && p.latestCompleted.result === 'succeeded');
  const row = (p) => ListRow(host, { key: p.id, lead: h('span', { className: 'mind-dot', style: { background: tone(p.latest ? p.latest.result : null) } }), label: `${p.folder ? `${p.folder.replace(/^\\/, '')} / ` : ''}${p.name}`, sub: p.latest ? `${p.latest.number} - ${p.latest.result}${p.latest.branch ? ` - ${p.latest.branch}` : ''}${p.latest.requestedBy ? ` - ${p.latest.requestedBy}` : ''}${p.latest.durationMs ? ` - ${dur(p.latest.durationMs)}` : ''}` : 'never ran', meta: h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, h('span', { className: 'mpanel__meta' }, p.latest ? ago(p.latest.finishedAt || p.latest.startedAt || p.latest.queuedAt) : ''), h('button', { type: 'button', className: 'sy-btn sy-btn--sm', disabled: busy === p.id, title: 'Queue a run on the default branch', onClick: (e) => { e.stopPropagation(); onQueue(p); } }, busy === p.id ? '...' : 'Run')), onClick: () => onOpenPipeline(p.id) });
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Pipelines', value: data ? list.length : '...', tone: 'brass' }),
      Stat(host, { label: 'Failing', value: data ? failing.length : '...', tone: failing.length ? 'rosin' : 'muted', hint: failing.length ? 'latest completed run failed' : undefined }),
      Stat(host, { label: 'Running', value: data ? running.length : '...', tone: running.length ? 'brass' : 'muted' }),
      Stat(host, { label: 'Green', value: data ? green.length : '...', tone: green.length ? 'moss' : 'muted' })),
    h('div', { className: 'mhealth' }, ...list.slice(0, 5).map((p) => Health(host, { label: p.name, value: state(p.latest) }))),
    error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, error) : null,
    failing.length ? Panel(host, { title: 'Failing', wide: true, action: meta(`${failing.length} - click one to see why`) }, List(host, failing.map(row))) : null,
    running.length ? Panel(host, { title: 'Running now', wide: true, action: meta(`${running.length}`) }, List(host, running.map(row))) : null,
    Panel(host, { title: 'All pipelines', wide: true, action: meta(data ? `${list.length}` : '') }, !data ? h(ui.Skeleton, { count: 5, height: 18 }) : list.length ? List(host, list.map(row)) : empty('No build pipeline in this project.')));
}

export function PipelinesAside({ host, pipelines, onOpenRun, onOpenPipeline }) {
  const { h, ui } = host;
  const { data } = pipelines;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const latest = (data || []).filter((p) => p.latest).map((p) => ({ ...p.latest, name: p.name })).sort((a, b) => new Date(b.queuedAt) - new Date(a.queuedAt));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Latest runs', ...FILL, action: meta(data ? `${latest.length}` : '...') },
      !data ? h(ui.Skeleton, { count: 4, height: 16 }) : latest.length ? List(host, latest.slice(0, 20).map((r) => runRow(host, r, onOpenRun, r.name))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing ran yet.')));
}

export function PipelinePage({ host, pipeline, runs, health, q, onOpenRun, onQueue, busy, onNotes }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = (runs || []).filter((r) => !q || `${r.number} ${r.branch} ${r.requestedBy}`.toLowerCase().includes(q));
  const hv = health;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Success rate', value: !hv ? '...' : hv.successRate === null ? '-' : `${hv.successRate}%`, tone: !hv || hv.successRate === null ? 'muted' : hv.successRate >= 80 ? 'moss' : hv.successRate >= 50 ? 'brass' : 'rosin', hint: hv && hv.recentRate !== null && hv.olderRate !== null ? `${hv.recentRate}% lately, ${hv.olderRate}% before` : 'last 50 runs' }),
      Stat(host, { label: 'Failed', value: !hv ? '...' : hv.failed, tone: hv && hv.failed ? 'rosin' : 'muted', hint: hv && hv.partial ? `${hv.partial} partial` : undefined }),
      Stat(host, { label: 'Average', value: !hv ? '...' : dur(hv.avgDurationMs) || '-', tone: 'muted' }),
      Stat(host, { label: 'Latest', value: !runs ? '...' : runs[0] ? runs[0].result : '-', tone: runs && runs[0] ? (runs[0].result === 'succeeded' ? 'moss' : runs[0].result === 'failed' ? 'rosin' : 'brass') : 'muted', hint: runs && runs[0] ? `${runs[0].number} - ${ago(runs[0].finishedAt || runs[0].queuedAt)}` : undefined })),
    hv && hv.last && hv.last.length ? h('div', { className: 'mhealth' }, ...hv.last.slice(0, 12).map((r) => Health(host, { label: r.number, value: r.result === 'succeeded' ? 'ok' : r.result }))) : null,
    Panel(host, { title: 'Runs', wide: true, action: h('div', { style: { display: 'flex', gap: 6 } }, h(ui.Button, { className: 'sy-btn--sm', onClick: onNotes }, 'Release notes'), h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !!busy, onClick: () => onQueue(pipeline) }, busy ? 'Queuing...' : 'Run')) },
      !runs ? h(ui.Skeleton, { count: 6, height: 18 }) : list.length ? List(host, list.map((r) => runRow(host, r, onOpenRun))) : empty('No run.')));
}

export function RunPage({ host, data, onChanged, onQueue, busy, onOpenItem }) {
  const { h, ui, api, notify, tokens } = host;
  const { useState } = host.react;
  const { run, error } = data;
  const [why, setWhy] = useState(null);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(null);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: 'Could not open the run', body: error });
  if (!run) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'ado-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Stages' }, h(ui.Skeleton, { count: 5, height: 16 })), Panel(host, { title: 'Why it failed' }, h(ui.Skeleton, { count: 4, height: 16 }))));
  const failed = run.failedTasks || [];
  const explain = async () => {
    setAsking(true);
    try {
      const logs = failed.map((f) => `### ${f.stage} / ${f.job} / ${f.task}\n${(f.issues || []).map((i) => `${i.type}: ${i.message}`).join('\n')}\n\n${f.logTail}`).join('\n\n').slice(0, 14000);
      const system = 'You explain CI failures to a busy engineer. Plain, specific, no fluff. Return Markdown only.';
      const prompt = `Azure DevOps pipeline "${run.definition ? run.definition.name : ''}" run ${run.number} on branch ${run.branch || '?'} (${run.commit || ''}) failed.${run.message ? ` Commit message: "${run.message.split('\n')[0]}".` : ''}\n\nFrom the failed tasks below, say in this order: **What failed** (one line), **Why** (the actual error, quoted briefly), **Fix** (concrete steps or the command), **Flaky or real** (your read). Keep it short.\n\n${logs || '(no logs were available)'}`;
      let text = '';
      try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 900 }) })).text || '').trim(); } catch (_) {}
      if (!text) {
        const cfg = await api('/api/config').catch(() => ({}));
        const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'ado-pipeline', timeout: 180000, prompt: `${system}\n\n${prompt}\n\nThis is a one-off answer: do not run any bootstrap, do not save to Mind or any memory. Reply with the explanation only.` }) });
        text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 180000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
      }
      setWhy(text || 'Nothing came back.');
    } catch (e) { notify(e.message, 'rosin'); } finally { setAsking(false); }
  };
  const pre = (text) => h(ui.CodeEditor, { value: text, language: 'plaintext', height: 360, readOnly: true });
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, h('span', { className: 'mind-dot', style: { background: tone(run.result) } }), h('span', { className: 'mpanel__title' }, `${run.definition ? run.definition.name : 'Pipeline'} - ${run.number} - ${run.result}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, run.message ? run.message.split('\n')[0] : `${run.branch || ''} ${run.commit || ''}`),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, `${run.branch || ''}${run.commit ? ` at ${run.commit}` : ''} - ${run.reason || ''}${run.requestedBy ? ` by ${run.requestedBy}` : ''} - ${ago(run.queuedAt)}.`)),
      run.url ? h('a', { className: 'sy-btn sy-btn--sm', href: run.url, target: '_blank', rel: 'noreferrer', style: { flex: 'none' } }, 'Open in Azure DevOps') : null),
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Result', value: run.result, tone: run.result === 'succeeded' ? 'moss' : run.result === 'failed' ? 'rosin' : 'brass' }),
      Stat(host, { label: 'Stages', value: (run.stages || []).length }),
      Stat(host, { label: 'Failed tasks', value: failed.length, tone: failed.length ? 'rosin' : 'muted' }),
      Stat(host, { label: 'Took', value: dur(run.durationMs) || '-', tone: 'muted' })),
    h('div', { className: 'ado-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Stages', action: meta(`${(run.stages || []).length}`) },
          (run.stages || []).length ? List(host, run.stages.map((st, i) => ListRow(host, { key: i, lead: h('span', { className: 'mind-dot', style: { background: tone(st.result || (st.state === 'inProgress' ? 'running' : null)) } }), label: st.name, sub: `${st.result || st.state}${st.durationMs ? ` - ${dur(st.durationMs)}` : ''} - ${st.jobs.length} job${st.jobs.length === 1 ? '' : 's'}${st.jobs.some((j) => j.result === 'failed') ? ` - failed: ${st.jobs.filter((j) => j.result === 'failed').map((j) => j.name).join(', ')}` : ''}`, onClick: () => setOpen(open === i ? null : i) }))) : empty('No timeline yet.'),
          open !== null && run.stages[open] ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, run.stages[open].jobs.map((j, ji) => h('div', { key: ji, style: { marginBottom: 6 } }, h('div', { className: 'mpanel__meta', style: { marginBottom: 4 } }, `${j.name} - ${j.result || j.state}`), List(host, j.tasks.map((t, ti) => ListRow(host, { key: ti, lead: h('span', { className: 'mind-dot', style: { background: tone(t.result || (t.state === 'inProgress' ? 'running' : null)), width: 7, height: 7 } }), label: t.name, sub: (t.issues || []).map((x) => x.message).join(' ').slice(0, 200), meta: `${t.result || t.state}${t.durationMs ? ` - ${dur(t.durationMs)}` : ''}` })))))) : null),
        failed.length ? Panel(host, { title: 'Failing log', action: meta(`${failed[0].stage} / ${failed[0].task}`) }, pre(failed[0].logTail || (failed[0].issues || []).map((x) => x.message).join('\n') || '(no log)')) : null,
        (run.changes || []).length ? Panel(host, { title: 'Commits', action: meta(`${run.changes.length}`) }, List(host, run.changes.slice(0, 40).map((c, i) => ListRow(host, { key: i, lead: h('code', { className: 'mpanel__meta' }, c.short), label: c.message, sub: `${c.author || ''}${c.at ? ` - ${ago(c.at)}` : ''}`, onClick: c.url ? () => window.open(c.url, '_blank') : undefined })))) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Why it failed', action: h('div', { style: { display: 'flex', gap: 6 } },
          why && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => host.sendToShell(`Pipeline failure ${run.definition ? run.definition.name : ''} ${run.number} on ${run.branch}:\n${why}`) }, 'Insert in terminal') : null,
          why && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: async () => { if (await host.writeNote(`Pipeline ${run.number}`, `# ${run.definition ? run.definition.name : 'Pipeline'} ${run.number} on ${run.branch}\n\n${why}`)) notify('Saved and opened', 'moss'); } }, 'Save as note') : null,
          !why ? meta(failed.length ? 'the AI reads the logs' : 'nothing failed') : null) },
          why ? h('div', { style: { maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, h(ui.Markdown, { source: why })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, failed.length ? 'Reads the failed tasks and their logs and says what broke, why, how to fix it, and whether it looks flaky.' : 'This run did not fail.'),
          asking ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
          failed.length ? h('div', { style: { marginTop: why ? 'var(--sy-s3)' : 0 } }, h(ui.Button, { className: 'sy-btn--sm', disabled: asking, onClick: explain }, asking ? 'Reading the logs...' : why ? 'Explain it again' : 'Explain the failure')) : null),
        Panel(host, { title: 'Run again', action: meta(run.result === 'running' || run.result === 'queued' ? 'still running' : '') },
          run.result === 'running' || run.result === 'queued' ? empty('Wait for it to finish.') : h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: () => onQueue({ id: run.definition ? run.definition.id : null, name: run.definition ? run.definition.name : '' }, run.branch) }, busy ? 'Queuing...' : `Run again on ${run.branch || 'the default branch'}`)),
        Panel(host, { title: 'Work items', action: meta((run.workItems || []).length ? `${run.workItems.length}` : 'none linked') },
          (run.workItems || []).length ? List(host, run.workItems.map((w) => ListRow(host, { key: w.id, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }), label: `AB#${w.id} ${w.title}`, sub: `${w.type} - ${w.state}${w.assignedTo ? ` - ${w.assignedTo}` : ''}`, onClick: () => onOpenItem(w.id) }))) : empty('No work item is linked to the commits of this run.')),
        Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [{ label: 'Pipeline', value: run.definition ? run.definition.name : '-' }, { label: 'Branch', value: run.branch || '-' }, { label: 'Commit', value: run.commit || '-' }, { label: 'Trigger', value: run.reason || '-' }, { label: 'By', value: run.requestedBy || '-' }, { label: 'Queued', value: run.queuedAt ? new Date(run.queuedAt).toLocaleString() : '-' }] })))));
}

export function RunAside({ host, data, onOpenItem }) {
  const { h, ui } = host;
  const { run } = data;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Stages', action: meta(run ? `${(run.stages || []).length}` : '...') },
      !run ? h(ui.Skeleton, { count: 3, height: 16 }) : (run.stages || []).length ? List(host, run.stages.map((s, i) => ListRow(host, { key: i, lead: h('span', { className: 'mind-dot', style: { background: tone(s.result || (s.state === 'inProgress' ? 'running' : null)) } }), label: s.name, sub: s.result || s.state }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No stages.')),
    run && (run.workItems || []).length ? Panel(host, { title: 'Ships', action: meta(`${run.workItems.length}`) }, List(host, run.workItems.map((w) => ListRow(host, { key: w.id, label: `AB#${w.id} ${w.title}`, sub: w.type, onClick: () => onOpenItem(w.id) })))) : null);
}
