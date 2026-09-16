/**
 * What the activity means, before the activity itself.
 *
 * A feed answers "what happened"; the questions a person opens it with are different - how
 * much got done today, how much is left before the sprint ends, who carried it, and what did
 * people actually say. So the numbers come first, as the Mind Overview draws them: stat
 * cards, a status strip, and a grid of titled panels with bars. The feed follows.
 *
 * Everything here is computed from data already on screen, so it costs nothing and cannot
 * disagree with the feed below it. "Done today" means closed or resolved with a last change
 * today - the closest the change feed gets to a close date, and the caveat is stated.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, Bars, List, ListRow } from './kit.js';

const DONE = /closed|done|resolved/i;
const TYPE_COLOUR = { Bug: 'var(--sy-rosin)', 'User Story': 'var(--sy-brass)', Feature: 'var(--sy-moss)', Epic: 'var(--sy-moss)', Task: 'var(--sy-slate)' };

export function Insights({ host, feed, comments, items, sprint, days }) {
  const { h, tokens } = host;
  if (!feed) return null;

  const dayKey = (iso) => localDay(new Date(iso));
  const today = localDay(new Date());

  // ---------------------------------------------------------------- the numbers
  const doneToday = feed.filter((i) => DONE.test(i.state) && dayKey(i.changedDate) === today);
  const doneInWindow = feed.filter((i) => DONE.test(i.state));

  const changesBy = {};
  const closedBy = {};
  const pointsBy = {};
  const typeBy = {};
  for (const i of feed) {
    const who = i.changedBy || 'unknown';
    changesBy[who] = (changesBy[who] || 0) + 1;
    typeBy[i.type || 'Other'] = (typeBy[i.type || 'Other'] || 0) + 1;
    if (DONE.test(i.state)) {
      const owner = i.assignedTo || who;
      closedBy[owner] = (closedBy[owner] || 0) + 1;
      pointsBy[owner] = (pointsBy[owner] || 0) + (Number(i.storyPoints) || 0);
    }
  }
  const top = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]);
  const mostActive = top(changesBy)[0];
  // The MVP is the person who closed the most points; items break a tie. Points are what the
  // sprint is measured in, so that is what "most valuable" has to mean here.
  const mvp = top(pointsBy).sort((a, b) => (b[1] - a[1]) || ((closedBy[b[0]] || 0) - (closedBy[a[0]] || 0)))[0];

  // Sprint remaining, from the sprint's own items rather than the feed.
  const sprintItems = sprint ? items : [];
  const left = sprintItems.filter((i) => !DONE.test(i.state) && !/removed/i.test(i.state));
  const leftPoints = left.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  const daysLeft = sprint && sprint.finishDate ? Math.max(0, Math.ceil((new Date(sprint.finishDate) - Date.now()) / 86400000)) : null;

  // ---------------------------------------------------------------- changes by day
  const perDay = new Map();
  for (let d = days - 1; d >= 0; d--) {
    const k = localDay(new Date(Date.now() - d * 86400000));
    perDay.set(k, { all: 0, done: 0 });
  }
  for (const i of feed) {
    const k = dayKey(i.changedDate);
    const slot = perDay.get(k);
    if (!slot) continue;
    slot.all += 1;
    if (DONE.test(i.state)) slot.done += 1;
  }

  const people = Object.keys(changesBy).length;
  const commentCount = comments ? comments.length : null;

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s4)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Done today', value: doneToday.length, tone: doneToday.length ? 'moss' : 'muted', hint: doneToday.length ? `${doneToday.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0)} pts` : 'nothing closed yet' }),
      Stat(host, {
        label: 'Left in sprint',
        value: sprint ? left.length : '-',
        tone: sprint && daysLeft !== null && daysLeft <= 2 && left.length ? 'rosin' : 'brass',
        hint: sprint ? `${leftPoints} pts${daysLeft !== null ? ` - ${daysLeft === 0 ? 'ends today' : `${daysLeft}d left`}` : ''}` : 'pick a sprint',
      }),
      Stat(host, { label: 'MVP', value: mvp ? mvp[0] : '-', tone: 'brass', hint: mvp ? `${mvp[1]} pts closed, ${closedBy[mvp[0]] || 0} items` : `nothing closed in ${days}d` }),
      Stat(host, { label: 'Most active', value: mostActive ? mostActive[0] : '-', hint: mostActive ? `${mostActive[1]} changes in ${days}d` : '' })),

    h('div', { className: 'mhealth', role: 'group', 'aria-label': 'Window' },
      Health(host, { label: 'Window', value: days === 1 ? 'today' : `${days} days` }),
      Health(host, { label: 'Changes', value: feed.length }),
      Health(host, { label: 'Closed', value: doneInWindow.length, tone: doneInWindow.length ? 'moss' : 'muted' }),
      Health(host, { label: 'People', value: people }),
      Health(host, { label: 'Comments', value: commentCount === null ? '...' : commentCount, tone: commentCount ? 'brass' : 'muted' })),

    Panel(host, { title: 'Changes by day', action: h('span', { className: 'mpanel__meta' }, 'closed in green') },
      DayChart(host, [...perDay.entries()])),

    // Always three across. The auto-fit grid dropped to two at a normal window width and
    // left a hole beside whichever panel wrapped - these are narrow bar lists and read fine
    // at a third of the width.
    h('div', { className: 'ado-row3' },
      Panel(host, { title: 'Who worked the most', action: h('span', { className: 'mpanel__meta' }, 'changes') },
        top(changesBy).length ? Bars(host, { rows: top(changesBy).slice(0, 8).map(([label, value]) => ({ label, value })) })
          : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody changed anything in this window.')),
      Panel(host, { title: 'Closed, by person', action: h('span', { className: 'mpanel__meta' }, 'points') },
        top(pointsBy).length ? Bars(host, { rows: top(pointsBy).slice(0, 8).map(([label, value]) => ({ label, value, hint: `${closedBy[label] || 0} items`, color: 'var(--sy-moss)' })) })
          : h('p', { className: 'mlead', style: { margin: 0 } }, `Nothing closed in ${days} days.`)),
      Panel(host, { title: 'What moved, by type', action: h('span', { className: 'mpanel__meta' }, 'changes') },
        Bars(host, { rows: top(typeBy).map(([label, value]) => ({ label, value, color: TYPE_COLOUR[label] })) }))));
}

/** YYYY-MM-DD in the user's own time zone. */
function localDay(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Changes per day as columns, all changes behind and closes in front. Plain SVG on the app's
 * tokens - a plugin has no chart library, and this is the whole of what one would be for.
 */
function DayChart(host, entries) {
  const { h, tokens } = host;
  const W = 720; const H = 120; const pad = 18;
  const n = Math.max(1, entries.length);
  const max = Math.max(1, ...entries.map(([, v]) => v.all));
  const slot = (W - pad * 2) / n;
  const bar = Math.max(4, Math.min(28, slot * 0.6));
  const label = (k) => { const d = new Date(`${k}T00:00:00`); return n <= 14 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.getDate(); };
  return h('svg', { viewBox: `0 0 ${W} ${H + 22}`, width: '100%', height: H + 22, role: 'img', 'aria-label': 'Changes per day' },
    h('line', { x1: pad, x2: W - pad, y1: H, y2: H, stroke: tokens('line'), strokeWidth: 1 }),
    entries.map(([k, v], i) => {
      const x = pad + i * slot + (slot - bar) / 2;
      const hAll = Math.round((v.all / max) * (H - 12));
      const hDone = Math.round((v.done / max) * (H - 12));
      return h('g', { key: k },
        h('rect', { x, y: H - hAll, width: bar, height: hAll, rx: 3, fill: tokens('raised'), stroke: tokens('line') }),
        hDone ? h('rect', { x, y: H - hDone, width: bar, height: hDone, rx: 3, fill: tokens('moss') }) : null,
        v.all ? h('text', { x: x + bar / 2, y: H - hAll - 4, textAnchor: 'middle', fontSize: 10, fill: tokens('text-3') }, String(v.all)) : null,
        (n <= 14 || i % Math.ceil(n / 10) === 0) ? h('text', { x: x + bar / 2, y: H + 15, textAnchor: 'middle', fontSize: 10, fill: tokens('text-3') }, String(label(k))) : null);
    }));
}

/* ------------------------------------------------------------------ comments */

/** What people said, across every item that moved. Each one opens its item. */
export function Comments({ host, comments, error, onOpen }) {
  const { h, ui } = host;
  const action = comments ? h('span', { className: 'mpanel__meta' }, `${comments.length}`) : null;
  return Panel(host, { title: 'Comments', action },
    error ? h('p', { className: 'mlead', style: { margin: 0 } }, error)
      : !comments ? h(ui.Skeleton, { count: 5, height: 40 })
        : !comments.length ? h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody commented on anything that moved in this window.')
          : List(host, comments.map((c) => ListRow(host, {
            key: `${c.workItemId}-${c.id}`,
            label: `${c.author || 'someone'} on #${c.workItemId}`,
            sub: `${c.text.length > 220 ? `${c.text.slice(0, 220)}...` : c.text} - ${ago(c.date)}`,
            onClick: () => onOpen(c.workItemId),
          }))));
}
