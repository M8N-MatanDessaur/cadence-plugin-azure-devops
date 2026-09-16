/**
 * Releases, inside the Azure DevOps plugin: what the next run of a pipeline would ship, and
 * release notes between two runs - written from the linked work items and commits, polished
 * by the AI, kept as a note or dropped into a terminal.
 */
import { ago, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';
import { tone, dur } from './pipelines.js';

export function Releases({ host, pipelines, pipelineId, setPipelineId, runs, onOpenRun, onOpenItem, initialTo }) {
  const { h, ui, api, notify } = host;
  const { useState, useEffect } = host.react;
  const [unreleased, setUnreleased] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(initialTo ? String(initialTo) : '');
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(null);
  const [polished, setPolished] = useState(null);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const list = pipelines.data || [];
  const current = list.find((p) => String(p.id) === String(pipelineId));
  useEffect(() => { setUnreleased(null); setNotes(null); setPolished(null); api(`/api/pipelines/unreleased${pipelineId ? `?id=${pipelineId}` : ''}`).then(setUnreleased).catch((e) => setUnreleased({ error: e.message, items: [] })); }, [pipelineId]);
  useEffect(() => { if (!to && runs && runs.length) { const ok = runs.find((r) => r.result === 'succeeded'); if (ok) setTo(String(ok.id)); } }, [runs]);
  const generate = async () => {
    if (!pipelineId || !to) return;
    setBusy('notes'); setPolished(null);
    try { setNotes(await api(`/api/pipelines/notes?id=${pipelineId}&to=${to}${from ? `&from=${from}` : ''}`)); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const polish = async () => {
    if (!notes) return;
    setBusy('polish');
    try {
      const system = 'You write release notes for the people who use the product and the engineers who ship it. Plain, grouped, no fluff, no emoji. Markdown only.';
      const prompt = `Rewrite these generated release notes into something a product owner can send: a two-line summary on top, then grouped headings that fit (Features, Fixes, Changes, Internal), one line per item, keep every AB#N reference and every commit hash, drop noise like merge commits and version bumps, never invent work that is not listed.\n\n${notes.markdown}`;
      let text = '';
      try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 1200 }) })).text || '').trim(); } catch (_) {}
      if (!text) {
        const cfg = await api('/api/config').catch(() => ({}));
        const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'ado-release', timeout: 180000, prompt: `${system}\n\n${prompt}\n\nThis is a one-off answer: do not run any bootstrap, do not save anything. Reply with the notes only.` }) });
        text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 180000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
      }
      if (text) setPolished(text); else notify('Nothing came back', 'rosin');
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const text = polished || (notes ? notes.markdown : '');
  const keep = async () => { if (host.writeNote && await host.writeNote(`Release notes ${current ? current.name : ''} ${notes && notes.to ? notes.to.number : ''}`.trim(), text)) notify('Saved and opened', 'moss'); };
  const items = unreleased ? unreleased.items || [] : [];
  const byType = {}; for (const w of items) byType[w.type] = (byType[w.type] || 0) + 1;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Waiting to ship', value: unreleased === null ? '...' : items.length, tone: items.length ? 'brass' : 'muted', hint: unreleased && unreleased.lastSuccessful ? `since ${unreleased.lastSuccessful.number}, ${ago(unreleased.since)}` : unreleased && pipelineId ? 'no successful run yet' : 'last 30 days, no pipeline chosen' }),
      Stat(host, { label: 'Last shipped', value: unreleased && unreleased.lastSuccessful ? unreleased.lastSuccessful.number : '-', tone: unreleased && unreleased.lastSuccessful ? 'moss' : 'muted', hint: unreleased && unreleased.lastSuccessful ? unreleased.lastSuccessful.branch : undefined }),
      Stat(host, { label: 'Notes cover', value: notes ? `${notes.runs.length} run${notes.runs.length === 1 ? '' : 's'}` : '-', tone: 'muted', hint: notes ? `${notes.workItems.length} items, ${notes.commits.length} commits` : undefined }),
      Stat(host, { label: 'Pipeline', value: current ? current.name : 'none', tone: 'muted' })),
    Object.keys(byType).length ? h('div', { className: 'mhealth' }, ...Object.entries(byType).map(([t, n]) => Health(host, { label: t, value: n }))) : null,
    h('div', { className: 'ado-row2' },
      Panel(host, { title: 'Release notes', action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        text && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => host.sendToShell(text) }, 'Insert in terminal') : null,
        text && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: keep }, 'Save as note') : null,
        text ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => navigator.clipboard.writeText(text).then(() => notify('Copied', 'moss')).catch(() => {}) }, 'Copy') : null) },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h(ui.Field, { label: 'Pipeline' }, h(ui.Select, { value: pipelineId || '', onChange: (e) => { setPipelineId(e.target.value); setTo(''); setFrom(''); }, 'aria-label': 'Pipeline' }, h('option', { value: '' }, 'Choose a pipeline'), list.map((p) => h('option', { key: p.id, value: p.id }, p.name)))),
          h('div', { className: 'ado-row2' },
            h(ui.Field, { label: 'From (previous release)', hint: 'blank: the previous successful run' }, h(ui.Select, { value: from, onChange: (e) => setFrom(e.target.value), 'aria-label': 'From run' }, h('option', { value: '' }, 'previous successful run'), (runs || []).map((r) => h('option', { key: r.id, value: r.id }, `${r.number} - ${r.result} - ${r.branch || ''}`)))),
            h(ui.Field, { label: 'To (this release)' }, h(ui.Select, { value: to, onChange: (e) => setTo(e.target.value), 'aria-label': 'To run' }, h('option', { value: '' }, 'choose a run'), (runs || []).map((r) => h('option', { key: r.id, value: r.id }, `${r.number} - ${r.result} - ${r.branch || ''}`))))),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h(ui.Button, { variant: 'primary', disabled: !!busy || !pipelineId || !to, onClick: generate }, busy === 'notes' ? 'Reading the runs...' : 'Write the notes'),
            notes ? h(ui.Button, { disabled: !!busy, onClick: polish }, busy === 'polish' ? 'Polishing...' : polished ? 'Polish again' : 'Polish with AI') : null,
            polished ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPolished(null) }, 'Back to the raw notes') : null),
          text ? h('div', { style: { maxHeight: 520, overflow: 'auto', paddingTop: 'var(--sy-s2)', paddingRight: 14, scrollbarGutter: 'stable' } }, h(ui.Markdown, { source: text })) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Pick the run you shipped; the notes list every work item and commit since the previous successful run, grouped by type. Polish turns them into something to send.'))),
      Panel(host, { title: 'Waiting to ship', action: meta(unreleased === null ? 'reading...' : `${items.length}`) },
        unreleased === null ? h(ui.Skeleton, { count: 5, height: 18 }) : unreleased.error ? empty(unreleased.error) : items.length ? h('div', { style: { maxHeight: 560, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, items.map((w) => ListRow(host, { key: w.id, lead: h('span', { className: 'mind-dot', style: { background: w.state === 'Closed' || w.state === 'Done' ? 'var(--sy-moss)' : 'var(--sy-brass)' } }), label: `AB#${w.id} ${w.title}`, sub: `${w.type} - ${w.state}${w.assignedTo ? ` - ${w.assignedTo}` : ''} - ${ago(w.changedAt)}`, onClick: () => onOpenItem(w.id) })))) : empty(pipelineId ? 'Nothing resolved since the last successful run.' : 'Nothing resolved or closed in the last 30 days.'))));
}

export function ReleasesAside({ host, pipelines, pipelineId, runs, onOpenRun }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const shipped = (runs || []).filter((r) => r.result === 'succeeded');
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Successful runs', ...FILL, action: meta(!pipelineId ? 'choose a pipeline' : runs ? `${shipped.length}` : '...') },
      !pipelineId ? h('p', { className: 'mlead', style: { margin: 0 } }, 'Each one is a release candidate for the notes.') : !runs ? h(ui.Skeleton, { count: 4, height: 16 }) : shipped.length ? List(host, shipped.slice(0, 25).map((r) => ListRow(host, { key: r.id, lead: h('span', { className: 'mind-dot', style: { background: tone(r.result) } }), label: r.number, sub: `${r.branch || ''}${r.requestedBy ? ` - ${r.requestedBy}` : ''}${r.durationMs ? ` - ${dur(r.durationMs)}` : ''}`, meta: ago(r.finishedAt), onClick: () => onOpenRun(r.id) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No successful run yet.')));
}
