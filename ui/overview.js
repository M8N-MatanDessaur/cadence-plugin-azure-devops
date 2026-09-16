/**
 * Overview: the sprint as a bento. How much is done against the clock, who carries what,
 * what needs attention (unassigned, open bugs, unsized stories, failing pipelines), what
 * moved lately, and the doors to every other screen.
 */
import { Panel, Stat, Health, Bars, List, ListRow, FILL } from './kit.js';

const isDone = (i) => /closed|done|resolved|removed/i.test(i.state || '');
const ago = (iso) => { if (!iso) return ''; const d = (Date.now() - new Date(iso).getTime()) / 86400000; return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)}d ago`; };
const typeColour = (t) => (/bug/i.test(t) ? 'var(--sy-rosin)' : /feature|epic/i.test(t) ? 'var(--sy-brass)' : /story/i.test(t) ? 'var(--sy-moss)' : 'var(--sy-text-3)');

export function itemRow(host, i, onOpen, meta) {
  const { h } = host;
  return ListRow(host, { key: i.id, lead: h('span', { className: 'mind-dot', style: { background: typeColour(i.type) } }), label: `#${i.id} ${i.title}`, sub: `${i.type || 'item'} - ${i.state}${i.assignedTo ? ` - ${i.assignedTo}` : ' - unassigned'}${i.storyPoints ? ` - ${i.storyPoints} pts` : ''}`, meta: meta || '', onClick: () => onOpen(i.id) });
}

export function Overview({ host, items, loading, sprint, daysLeft, members, feed, pipelines, onOpen, onAction, onPerson }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const open = items.filter((i) => !isDone(i));
  const done = items.filter(isDone);
  const points = items.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  const donePoints = done.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  const pct = points ? Math.round((donePoints / points) * 100) : items.length ? Math.round((done.length / items.length) * 100) : 0;
  const span = sprint && sprint.startDate && sprint.finishDate ? new Date(sprint.finishDate) - new Date(sprint.startDate) : 0;
  const elapsed = span > 0 ? Math.max(0, Math.min(1, (Date.now() - new Date(sprint.startDate)) / span)) : 0;
  const behind = elapsed > 0 && pct / 100 < elapsed - 0.15;
  const unassigned = open.filter((i) => !i.assignedTo);
  const bugs = open.filter((i) => /bug/i.test(i.type || ''));
  const unsized = open.filter((i) => /story|feature/i.test(i.type || '') && !Number(i.storyPoints));
  const failed = (pipelines.data || []).filter((x) => x.latestCompleted && x.latestCompleted.result === 'failed');
  const byPerson = {}; for (const i of open) { const who = i.assignedTo || 'unassigned'; byPerson[who] = (byPerson[who] || 0) + 1; }
  const byType = {}; for (const i of items) byType[i.type || 'item'] = (byType[i.type || 'item'] || 0) + 1;
  const issues = [];
  if (behind) issues.push({ level: 'warn', text: `The sprint is ${Math.round(elapsed * 100)}% through and ${pct}% done.`, action: 'board' });
  if (unassigned.length) issues.push({ level: 'warn', text: `${unassigned.length} open item${unassigned.length === 1 ? ' has' : 's have'} nobody assigned.`, action: 'backlog' });
  if (bugs.length) issues.push({ level: bugs.length > 5 ? 'warn' : 'info', text: `${bugs.length} open bug${bugs.length === 1 ? '' : 's'} in the sprint.`, action: 'backlog' });
  if (unsized.length) issues.push({ level: 'info', text: `${unsized.length} stor${unsized.length === 1 ? 'y has' : 'ies have'} no points.`, action: 'backlog' });
  for (const p of failed) issues.push({ level: 'error', text: `Pipeline ${p.name} failed on its last run.`, action: 'pipelines' });
  const recent = (feed || []).slice(0, 10);
  const keep = async () => { if (!host.writeNote) return; const md = [`# ${sprint ? sprint.name : 'Sprint'} - status ${new Date().toISOString().slice(0, 10)}`, '', `**Done:** ${pct}% (${done.length} of ${items.length} items, ${donePoints} of ${points} points)${sprint && daysLeft !== null ? `, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left, ${Math.round(elapsed * 100)}% elapsed` : ''}`, `**Open bugs:** ${bugs.length}. **Unassigned:** ${unassigned.length}. **Failing pipelines:** ${failed.length}.`, '', '## Needs attention', ...(issues.length ? issues.map((i) => `- ${i.text}`) : ['- Nothing.']), '', '## Open, by person', ...Object.entries(byPerson).sort((a, b) => b[1] - a[1]).map(([n, c]) => `- ${n}: ${c}`), '', '## Unassigned', ...(unassigned.length ? unassigned.map((i) => `- #${i.id} ${i.title} (${i.type}${i.storyPoints ? `, ${i.storyPoints} pts` : ''})`) : ['- None.']), '', '## Changed lately', ...(recent.length ? recent.map((e) => `- #${e.id} ${e.title} - ${e.state}${e.changedBy ? ` - ${e.changedBy}` : ''}`) : ['- Nothing in the window.'])].join('\n'); if (await host.writeNote(`${sprint ? sprint.name : 'Sprint'} status ${new Date().toISOString().slice(0, 10)}`, md)) host.notify('Saved as a note', 'moss'); };
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: sprint ? sprint.name : 'All iterations', value: loading ? '...' : `${pct}%`, tone: behind ? 'rosin' : 'moss', hint: loading ? undefined : sprint ? (daysLeft === null ? 'no dates' : daysLeft < 0 ? 'finished' : daysLeft === 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left, ${Math.round(elapsed * 100)}% elapsed`) : `${done.length} of ${items.length} done` }),
      Stat(host, { label: 'Open items', value: loading ? '...' : open.length, tone: 'brass', hint: loading ? undefined : `${done.length} done of ${items.length}` }),
      Stat(host, { label: 'Points', value: loading ? '...' : `${donePoints}/${points}`, tone: 'muted', hint: 'done of planned' }),
      Stat(host, { label: 'Bugs open', value: loading ? '...' : bugs.length, tone: bugs.length ? 'rosin' : 'moss', hint: loading ? undefined : `${unassigned.length} unassigned in all` })),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'team', value: members.length || '...' }),
      Health(host, { label: 'carrying work', value: loading ? '...' : Object.keys(byPerson).filter((k) => k !== 'unassigned').length }),
      Health(host, { label: 'pipelines', value: pipelines.data ? `${pipelines.data.length}${failed.length ? `, ${failed.length} failing` : ''}` : '...', tone: failed.length ? 'rosin' : undefined }),
      Health(host, { label: 'changed this week', value: feed ? feed.length : '...' })),
    Panel(host, { title: 'Do', wide: true, action: h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, host.writeNote && !loading ? h(ui.Button, { className: 'sy-btn--sm', onClick: keep }, 'Save status as note') : null, meta('everything Azure DevOps, from here')) },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        h(ui.Button, { variant: 'primary', onClick: () => onAction('board') }, 'The board'),
        h(ui.Button, { onClick: () => onAction('backlog') }, 'The backlog'),
        h(ui.Button, { onClick: () => onAction('activity') }, 'What moved'),
        h(ui.Button, { onClick: () => onAction('people') }, 'Who carries what'),
        h(ui.Button, { onClick: () => onAction('pipelines') }, 'Pipelines'),
        h(ui.Button, { onClick: () => onAction('releases') }, 'Release notes'),
        h(ui.Button, { onClick: () => onAction('ask') }, 'Ask the AI'))),
    Panel(host, { title: 'Needs attention', wide: true, action: meta(loading ? '' : `${issues.length}`) },
      loading ? h(ui.Skeleton, { count: 3, height: 18 }) : issues.length ? List(host, issues.map((i, k) => ListRow(host, { key: k, lead: h('span', { className: 'mind-dot', style: { background: i.level === 'error' ? 'var(--sy-rosin)' : i.level === 'warn' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: i.text, sub: i.action === 'pipelines' ? 'Pipelines' : i.action === 'board' ? 'Board' : 'Backlog', onClick: () => onAction(i.action) }))) : empty('On pace, everything assigned, nothing failing.')),
    h('div', { className: 'ado-row2' },
      Panel(host, { title: 'Unassigned', action: meta(loading ? '' : `${unassigned.length}`), bodyStyle: { maxHeight: 380, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : unassigned.length ? List(host, unassigned.slice(0, 12).map((i) => itemRow(host, i, onOpen, i.storyPoints ? `${i.storyPoints} pts` : ''))) : empty('Every open item has someone.')),
      Panel(host, { title: 'Changed lately', action: meta(feed ? `last ${Math.min(feed.length, 10)} of ${feed.length}` : ''), bodyStyle: { maxHeight: 380, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        !feed ? h(ui.Skeleton, { count: 5, height: 18 }) : recent.length ? List(host, recent.map((e) => ListRow(host, { key: `${e.id}-${e.changedDate}`, lead: h('span', { className: 'mind-dot', style: { background: typeColour(e.type) } }), label: `#${e.id} ${e.title}`, sub: `${e.state}${e.changedBy ? ` - ${e.changedBy}` : ''}`, meta: ago(e.changedDate), onClick: () => onOpen(e.id) }))) : empty('Nothing changed in the window.'))),
    h('div', { className: 'ado-row2' },
      Panel(host, { title: 'Open, by person', action: meta('click a name for their items') },
        loading ? h(ui.Skeleton, { count: 5, height: 14 }) : Object.keys(byPerson).length ? Bars(host, { rows: Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value, color: label === 'unassigned' ? 'var(--sy-rosin)' : 'var(--sy-moss)' })) }) : empty('Nothing open.')),
      Panel(host, { title: 'By type', action: meta(`${items.length} items`) },
        loading ? h(ui.Skeleton, { count: 4, height: 14 }) : Bars(host, { rows: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: typeColour(label) })) }))));
}

export function OverviewAside({ host, items, sprint, daysLeft, feed, onOpen }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const open = items.filter((i) => !isDone(i));
  const byState = {}; for (const i of items) byState[i.state] = (byState[i.state] || 0) + 1;
  const first = [...open.filter((i) => /bug/i.test(i.type || '') && /1|critical|high/i.test(String(i.priority || i.severity || ''))), ...open.filter((i) => !i.assignedTo)].filter((x, k, arr) => arr.findIndex((y) => y.id === x.id) === k).slice(0, 8);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'By state', action: meta(`${items.length}`) }, Bars(host, { rows: ['New', 'Active', 'Resolved', 'Closed'].map((s) => ({ label: s, value: byState[s] || 0, color: s === 'Closed' || s === 'Resolved' ? 'var(--sy-moss)' : s === 'Active' ? 'var(--sy-brass)' : 'var(--sy-text-3)' })), max: items.length || 1 })),
    Panel(host, { title: 'Fix first', ...FILL, action: meta(`${first.length}`) }, first.length ? List(host, first.map((i) => itemRow(host, i, onOpen))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No urgent bug, nothing unassigned.')));
}
