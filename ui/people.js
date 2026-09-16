/**
 * One person, as a report.
 *
 * Picking a name should read like a short brief someone wrote about them, not a pile of lists:
 * how they have been working (what they touched, week by week, and what they finished), what
 * they are carrying now, whether anything they hold has gone quiet, and - the thing nobody
 * checks by hand - whether a comment on one of their items is waiting for their reply.
 *
 * All of that is worked out here from the plugin's own routes: the person's items in the
 * window, the activity feed filtered to their changes, and the comments on each open item.
 * A fuller write-up can be asked of the player, which lands as Markdown under the brief.
 */
import { ago, waitForTask } from './helpers.js';
import { Panel, Stat, Health, Bars, List, ListRow } from './kit.js';

const TYPE_COLOUR = { Bug: 'var(--sy-rosin)', 'User Story': 'var(--sy-brass)', Feature: 'var(--sy-moss)', Epic: 'var(--sy-moss)', Task: 'var(--sy-slate)' };
const DONE = /closed|done|removed|resolved/i;
const FINISHED = /closed|done|resolved/i;
const DAY = 86400000;
const BOT = /^(github|azure devops|azure pipelines|microsoft\.|.*\bbot\b)/i;

const first = (name) => String(name || '').split(' ')[0];
const dateOf = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const list = (ids) => ids.map((i) => `#${i.id}`).join(', ');

/** Week buckets, oldest first, for the cadence bars. */
function weeks(feed, who, days) {
  const n = Math.max(1, Math.ceil(days / 7));
  const out = Array.from({ length: n }, (_, k) => {
    const end = Date.now() - (n - 1 - k) * 7 * DAY;
    return { label: `wk of ${dateOf(end - 6 * DAY)}`, value: 0, end };
  });
  for (const i of feed) {
    if (!same(i.changedBy, who)) continue;
    const t = new Date(i.changedDate).getTime();
    const slot = out.find((w) => t <= w.end + DAY && t > w.end - 7 * DAY);
    if (slot) slot.value += 1;
  }
  return out;
}

/** What the comments on the open items say about the person. */
function commentTrail(details, who, days) {
  const since = Date.now() - days * DAY;
  const mine = [];
  const waiting = [];
  const quiet = [];
  for (const d of details) {
    const cs = (d.comments || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    for (const c of cs) if (same(c.author, who) && new Date(c.date).getTime() >= since) mine.push({ ...c, item: d });
    if (!cs.length) { if (d.state === 'Active') quiet.push(d); continue; }
    // Integrations (GitHub, pipelines) leave comments too; nobody owes a bot a reply.
    const last = cs.find((c) => !BOT.test(c.author || '')) || cs[0];
    if (!same(last.author, who) && !BOT.test(last.author || '')) waiting.push({ item: d, from: last.author, date: last.date, text: last.text });
  }
  mine.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  waiting.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { mine, waiting, quiet };
}

/** Before anyone is picked: the team at a glance, from the sprint items. Every row picks that person. */
function TeamGlance({ host, items, members, onPick, onOpen }) {
  const { h, ui } = host;
  const list = items || [];
  const open = list.filter((i) => !/closed|done|removed/i.test(i.state));
  const done = list.filter((i) => /closed|done|resolved/i.test(i.state));
  const by = {};
  for (const i of open) { const who = i.assignedTo || 'unassigned'; by[who] = by[who] || { open: 0, active: 0, pts: 0 }; by[who].open++; if (/active/i.test(i.state)) by[who].active++; by[who].pts += Number(i.storyPoints) || 0; }
  const doneBy = {};
  for (const i of done) { const who = i.assignedTo || 'unassigned'; doneBy[who] = (doneBy[who] || 0) + 1; }
  const people = Object.entries(by).filter(([n]) => n !== 'unassigned').sort((a, b) => b[1].pts - a[1].pts || b[1].open - a[1].open);
  const unassigned = by.unassigned ? by.unassigned.open : 0;
  const idle = (members || []).map((m) => m.displayName || m.name || m).filter((n) => n && !by[n] && !doneBy[n]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Carrying work', value: people.length, tone: 'brass', hint: `of ${(members || []).length} on the team` }),
      Stat(host, { label: 'Unassigned', value: unassigned, tone: unassigned ? 'rosin' : 'muted', hint: unassigned ? 'open items nobody holds' : undefined }),
      Stat(host, { label: 'Heaviest load', value: people[0] ? people[0][0].split(' ')[0] : '-', tone: 'muted', hint: people[0] ? `${people[0][1].pts} pts, ${people[0][1].open} open` : undefined }),
      Stat(host, { label: 'Closed this sprint', value: done.length, tone: done.length ? 'moss' : 'muted' })),
    Panel(host, { title: 'Who carries what', wide: true, action: meta('click a name for the full picture') },
      people.length ? List(host, people.map(([name, v]) => ListRow(host, { key: name, lead: h('span', { className: 'mind-dot', style: { background: v.active ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: name, sub: `${v.open} open - ${v.active} active - ${v.pts} pts${doneBy[name] ? ` - ${doneBy[name]} closed` : ''}`, meta: h('span', { className: 'mbars__track', style: { display: 'inline-block', width: 120 } }, h('span', { className: 'mbars__fill', style: { width: `${Math.max(4, (v.pts / (people[0][1].pts || 1)) * 100)}%` } })), onClick: () => onPick(name) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody holds an open item in this sprint.')),
    h('div', { className: 'ado-row2' },
      Panel(host, { title: 'Closed lately', action: meta(`${done.length}`) },
        done.length ? List(host, done.slice(0, 8).map((i) => ListRow(host, { key: i.id, label: `#${i.id} ${i.title}`, sub: `${i.assignedTo || 'unassigned'} - ${i.type}`, onClick: () => onOpen(i.id) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing closed yet.')),
      Panel(host, { title: 'Nothing this sprint', action: meta(`${idle.length}`) },
        idle.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, idle.slice(0, 20).map((n) => h(ui.Chip, { key: n, onClick: () => onPick(n) }, n))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Everyone on the team holds or closed something.'))));
}

export function People({ host, selected, onOpen, items: sprintItems, members, onPick }) {
  const { h, ui, react, api, notify } = host;
  const { useState, useEffect } = react;

  const [detail, setDetail] = useState(null);
  const [feed, setFeed] = useState(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(60);
  const [report, setReport] = useState(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (!selected) return undefined;
    let live = true;
    setDetail(null); setFeed(null); setDetails(null); setError(null); setReport(null);
    api(`/api/person?who=${encodeURIComponent(selected)}&days=${days}`)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        // The comments live on each item; read the open ones, a handful at a time.
        const open = (d.items || []).filter((i) => !DONE.test(i.state)).slice(0, 24);
        return Promise.all(open.map((i) => api(`/api/workitems/${i.id}`).catch(() => null)))
          .then((ds) => { if (live) setDetails(ds.filter(Boolean)); });
      })
      .catch((e) => { if (live) setError(e.message); });
    api(`/api/activity?days=${days}&top=200`).then((d) => { if (live) setFeed(d.items || []); }).catch(() => { if (live) setFeed([]); });
    return () => { live = false; };
  }, [selected, days]);

  if (!selected) {
    return h(TeamGlance, { host, items: sprintItems, members, onPick: onPick || (() => {}), onOpen });
  }
  if (error) return h(ui.EmptyState, { title: `Could not read ${selected}'s work`, body: error });
  if (!detail) return h(ui.Skeleton, { count: 8, height: 30 });

  const items = detail.items || [];
  const open = items.filter((i) => !DONE.test(i.state));
  const finished = items.filter((i) => FINISHED.test(i.state));
  const byState = {};
  const byType = {};
  for (const i of open) {
    byState[i.state] = (byState[i.state] || 0) + 1;
    byType[i.type] = (byType[i.type] || 0) + 1;
  }
  const stale = open.filter((i) => (Date.now() - new Date(i.changedDate)) > 14 * DAY);
  const points = open.reduce((sum, i) => sum + (Number(i.storyPoints) || 0), 0);
  const donePoints = finished.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  const bugs = open.filter((i) => i.type === 'Bug').length;
  const latest = items.slice().sort((a, b) => String(b.changedDate).localeCompare(String(a.changedDate)))[0];
  const biggest = open.filter((i) => Number(i.storyPoints)).sort((a, b) => Number(b.storyPoints) - Number(a.storyPoints))[0];

  const finishedByType = {};
  for (const i of finished) finishedByType[i.type] = (finishedByType[i.type] || 0) + 1;
  const bySprint = {};
  for (const i of items) { const k = i.iterationPath ? String(i.iterationPath).split('\\').pop() : 'no sprint'; bySprint[k] = (bySprint[k] || 0) + 1; }
  const sprintRows = Object.entries(bySprint).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label: label.replace(/^(Sprint \d+).*$/, '$1'), value, hint: label }));
  const cadence = feed ? weeks(feed, selected, days) : null;
  const busiest = cadence ? cadence.reduce((a, b) => (b.value > a.value ? b : a), cadence[0]) : null;
  const touchedByThem = feed ? feed.filter((i) => same(i.changedBy, selected)).length : null;
  const trail = details ? commentTrail(details, selected, days) : null;
  const name = first(selected);

  // ---- the brief, written from the numbers
  const rhythm = [
    `${selected} touched ${items.length} item${items.length === 1 ? '' : 's'} assigned to them in the last ${days} days and finished ${finished.length}${donePoints ? ` (${donePoints} pts)` : ''}.`,
    touchedByThem !== null ? ` Across the whole board they made the last change on ${touchedByThem} item${touchedByThem === 1 ? '' : 's'}${busiest && busiest.value ? `, most of it in the ${busiest.label}` : ''}.` : '',
    latest ? ` Last seen ${ago(latest.changedDate)} on #${latest.id}.` : ` Nothing of theirs has moved in the window.`,
  ].join('');

  const load = open.length
    ? `Right now ${name} carries ${open.length} open item${open.length === 1 ? '' : 's'}${points ? ` worth ${points} pts` : ''}: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t.toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}.`
      + (stale.length ? ` ${stale.length} of ${stale.length === 1 ? 'them has' : 'them have'} not moved in two weeks (${list(stale.slice(0, 4))}${stale.length > 4 ? ', ...' : ''}).` : ' All of it has moved in the last two weeks.')
      + (bugs && bugs < open.length ? ` ${bugs} of ${bugs === 1 ? 'those is a bug' : 'those are bugs'}.` : '')
      + (biggest ? ` The largest is #${biggest.id} "${biggest.title}" at ${biggest.storyPoints} pts.` : '')
    : `${name} has nothing open right now.`;

  const comments = !trail
    ? 'Reading the comments on their open items...'
    : [
      trail.mine.length
        ? `${name} wrote ${trail.mine.length} comment${trail.mine.length === 1 ? '' : 's'} on their open items in the window, the last one ${ago(trail.mine[0].date)} on #${trail.mine[0].item.id}.`
        : `${name} has not written a comment on any of their open items in the last ${days} days.`,
      trail.waiting.length
        ? ` ${trail.waiting.length} item${trail.waiting.length === 1 ? ' has' : 's have'} a comment from someone else as the latest word, with no reply from ${name}: ${trail.waiting.slice(0, 3).map((w) => `#${w.item.id} (${first(w.from)}, ${ago(w.date)})`).join(', ')}${trail.waiting.length > 3 ? ', ...' : ''}.`
        : ` Nothing is waiting on a reply from ${name}.`,
      trail.quiet.length ? ` ${trail.quiet.length} active item${trail.quiet.length === 1 ? ' has' : 's have'} no comments at all.` : '',
    ].join('');

  // ---- a fuller write-up from the player, on request
  const write = async () => {
    setWriting(true);
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const prompt = [
        `Write a short, honest report about ${selected}'s work on the Azure DevOps project "${cfg.AzureDevOpsProject || ''}" over the last ${days} days. Today is ${new Date().toISOString().slice(0, 10)}.`,
        '',
        'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call PATCH, POST or DELETE.',
        `  ${base}/api/person?who=${encodeURIComponent(selected)}&days=${days}   their items in the window`,
        `  ${base}/api/activity?days=${days}&top=200                       everything that changed, with changedBy`,
        `  ${base}/api/workitems/ID                                          one item with its comments`,
        `  ${base}/api/workitems/ID/updates                                  one item's field history (state changes with dates)`,
        `  ${base}/api/comments?days=${Math.min(days, 90)}&top=60             comments across the board`,
        '',
        'Cover: how they have been working (rhythm, what they finish, what they start), what they carry now and whether it is on track, anything sitting still, comments they owe a reply to, and one or two things worth raising with them. Be specific and fair: say what the data shows and no more.',
        'Answer in Markdown: a short lead, then bold labels and bullets. Write every work item as #ID. This is a one-off answer: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the report only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'ado-person', timeout: 240000, prompt }) });
      const text = result.handledLocally ? (result.answer || '') : result.id ? await waitForTask(api, result.id, 240000) : (result.error || 'No report came back.');
      setReport(String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim());
    } catch (e) { notify(e.message, 'rosin'); } finally { setWriting(false); }
  };

  const row = (i) => ListRow(host, {
    key: i.id,
    lead: h('span', { className: 'mind-dot', style: { background: TYPE_COLOUR[i.type] || 'var(--sy-text-3)' } }),
    label: `#${i.id} ${i.title}`,
    sub: `${i.state} - touched ${ago(i.changedDate)}${i.iterationPath ? ` - ${String(i.iterationPath).split('\\').pop()}` : ''}`,
    meta: i.storyPoints ? `${i.storyPoints} pts` : null,
    onClick: () => onOpen(i.id),
  });
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const row3 = (...panels) => h('div', { className: 'ado-row3' }, ...panels);
  const para = (text) => h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, text);

  return h('div', null,
    h('div', { className: 'mind-view__actions', style: { marginBottom: 'var(--sy-s3)' } },
      h('span', { className: 'mpanel__meta' }, selected),
      h('span', { style: { flex: 1 } }),
      [30, 60, 90].map((d) => h(ui.Chip, { key: d, on: days === d, onClick: () => setDays(d) }, `${d} days`)),
      h(ui.Button, { size: 'sm', disabled: writing, onClick: write }, writing ? 'Writing...' : report ? 'Write it again' : 'AI report')),

    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Open', value: open.length, tone: 'brass' }),
      Stat(host, { label: 'Points open', value: points }),
      Stat(host, { label: 'Untouched 14d', value: stale.length, tone: stale.length ? 'rosin' : 'muted', hint: stale.length ? 'assigned and silent' : undefined }),
      Stat(host, { label: 'Owes a reply', value: trail ? trail.waiting.length : '...', tone: trail && trail.waiting.length ? 'rosin' : 'muted', hint: trail && trail.waiting.length ? 'latest comment is not theirs' : undefined })),

    h('div', { className: 'mhealth', role: 'group', 'aria-label': 'Recent' },
      Health(host, { label: `Finished (${days}d)`, value: finished.length, tone: 'moss' }),
      Health(host, { label: 'Points finished', value: donePoints }),
      Health(host, { label: 'Open bugs', value: bugs, tone: bugs ? 'rosin' : undefined }),
      Health(host, { label: 'Last activity', value: latest ? ago(latest.changedDate) : '-' }),
      Health(host, { label: 'Comments written', value: trail ? trail.mine.length : '...', hint: `${days}d` })),

    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
      Panel(host, { title: `About ${name}`, wide: true, action: meta(report ? 'brief, then the AI report' : `from the last ${days} days`) },
        para(rhythm),
        para(load),
        para(comments),
        writing ? h('div', { style: { marginTop: 'var(--sy-s3)' } }, h(ui.Skeleton, { count: 4, height: 16 })) : null,
        report ? h('div', { style: { marginTop: 'var(--sy-s3)', paddingTop: 'var(--sy-s3)', borderTop: '1px solid var(--sy-line)' } }, h(ui.Markdown, { source: report })) : null),

      row3(
      Panel(host, { title: 'Working rhythm', action: meta(cadence ? 'changes they made, by week' : 'reading...') },
        cadence ? Bars(host, { rows: cadence.map(({ label, value }) => ({ label, value })) }) : h(ui.Skeleton, { count: 4, height: 14 })),

      Panel(host, { title: 'Owes a reply', action: meta(trail ? (trail.waiting.length ? `${trail.waiting.length}` : 'none') : '...') },
        !trail ? h(ui.Skeleton, { count: 3, height: 18 })
          : trail.waiting.length ? List(host, trail.waiting.map((w) => ListRow(host, {
            key: w.item.id,
            lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)' } }),
            label: `#${w.item.id} ${w.item.title}`,
            sub: `${w.from}, ${ago(w.date)}: ${String(w.text || '').replace(/@<[^>]*>/g, '@').slice(0, 90)}`,
            onClick: () => onOpen(w.item.id),
          })))
            : empty(`Nothing is waiting on a reply from ${name}.`)),
      Panel(host, { title: 'Sitting still', action: meta(stale.length ? `${stale.length} for 14d+` : 'none') },
        stale.length ? List(host, stale.map(row)) : empty('Everything assigned has moved in the last two weeks.')),
      ),

      row3(
      Panel(host, { title: 'Open, by type', action: meta(`${open.length}`) },
        open.length ? Bars(host, { rows: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: TYPE_COLOUR[label] })) }) : empty('Nothing open.')),
      Panel(host, { title: 'Finished, by type', action: meta(`${finished.length} in ${days}d`) },
        finished.length ? Bars(host, { rows: Object.entries(finishedByType).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: TYPE_COLOUR[label] })) }) : empty('Nothing finished in the window.')),
      Panel(host, { title: 'By sprint', action: meta(`${Object.keys(bySprint).length} sprint${Object.keys(bySprint).length === 1 ? '' : 's'}`) },
        sprintRows.length ? Bars(host, { rows: sprintRows }) : empty('No sprint on any of it.')),
      ),

      Panel(host, { title: 'Carrying', wide: true, action: meta(`${open.length} open`) },
        open.length ? List(host, open.map(row)) : empty(`${selected} has no active work assigned right now.`)),

      finished.length ? Panel(host, { title: `Finished in the last ${days} days`, wide: true, action: meta(`${finished.length}`) },
        List(host, finished.slice(0, 12).map(row))) : null));
}
