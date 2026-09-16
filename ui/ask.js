/**
 * Ask, as a bento.
 *
 * Two columns. On the left, the question and, under it, the answer: Markdown rendered into the
 * same prose the notes use, the question echoed above it, every cited work item a chip that
 * opens the item. On the right, two panels that make the screen worth opening before you have
 * a question: "Worth asking" reads the sprint and the last week of activity and prepares
 * questions that fit what is actually going on - the story sitting still, the person who moved
 * the most, the biggest open story - and "Recently asked" keeps every answer in the app's
 * memory, so one click brings an earlier answer back without asking the player again.
 *
 * While the player is reading Azure DevOps the answer panel says so and counts the seconds,
 * because a wide question takes a minute and a blank box for a minute reads as broken.
 */
import { Panel, Health, List, ListRow } from './kit.js';

const CITE = /#(\d{3,7})\b/g;
const RECENT_KEY = 'sy.ado.ask.recent';
const RECENT_MAX = 20;

const readRecent = () => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {} };

/** Writes one answer into the app's memory and returns it. The same question replaces its earlier entry. */
export const rememberAnswer = (entry) => {
  const next = [entry, ...readRecent().filter((e) => e.question !== entry.question)].slice(0, RECENT_MAX);
  writeRecent(next);
  return entry;
};

const cited = (text) => [...new Set([...String(text || '').matchAll(CITE)].map((m) => Number(m[1])))];

const when = (at) => {
  const d = new Date(at);
  const days = Math.floor((Date.now() - d.setHours(0, 0, 0, 0)) / 86400000);
  const clock = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return days <= 0 ? `today ${clock}` : days === 1 ? `yesterday ${clock}` : `${days}d ago`;
};

const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

/**
 * Questions prepared from what is on screen and what moved this week. Each carries the reason
 * it is being suggested, so the list reads as an analysis rather than a menu.
 */
function prepare({ items, sprint, feed }) {
  const out = [];
  const open = items.filter((i) => i.state !== 'Closed' && i.state !== 'Removed');
  const stories = open.filter((i) => /story|feature|epic/i.test(i.type || ''));

  if (sprint) {
    out.push({ q: `What is left to finish before ${sprint.name} ends, and who is carrying the most of it?`, why: `${open.length} open in the sprint` });
  }

  const stale = open
    .filter((i) => i.state === 'Active' && i.changedDate)
    .sort((a, b) => new Date(a.changedDate) - new Date(b.changedDate))[0];
  if (stale) {
    const since = new Date(stale.changedDate).toLocaleDateString([], { month: 'short', day: 'numeric' });
    out.push({ q: `What has happened on #${stale.id} "${stale.title}" and what is blocking it?`, why: `active, untouched since ${since}` });
  }

  const biggest = stories.filter((i) => i.storyPoints).sort((a, b) => b.storyPoints - a.storyPoints)[0];
  if (biggest) out.push({ q: `Is #${biggest.id} "${biggest.title}" on track, and which of its tasks are still open?`, why: `${biggest.storyPoints} pts, the largest open story` });

  if (feed && feed.length) {
    const by = {};
    for (const i of feed) if (i.changedBy) by[i.changedBy] = (by[i.changedBy] || 0) + 1;
    const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push({ q: `What did ${top[0]} work on this week, and what did they finish?`, why: `${top[1]} changes in 7 days, the most` });
    const closed = feed.filter((i) => i.state === 'Closed').length;
    out.push({ q: 'What did the team close in the last 7 days, story by story?', why: `${closed} closed this week` });
  }

  const orphans = open.filter((i) => !i.assignedTo);
  if (orphans.length) out.push({ q: 'Which open items in the sprint have nobody assigned, and what are they about?', why: `${orphans.length} unassigned` });

  out.push({ q: 'What did we close last month, and who closed the most?', why: 'the month before this one' });
  out.push({ q: 'What was discussed in the comments over the last two weeks?', why: 'comments, 14 days' });

  return out.slice(0, 7);
}

export function Ask({ host, question, setQuestion, ask, asking, answer, setAnswer, items, sprint, onOpen, api }) {
  const { h, ui, react, tokens, icons } = host;
  const { useState, useEffect, useMemo, useRef } = react;

  // Seconds since the question went out, so a long wait is visibly a wait and not a hang.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!asking) { setElapsed(0); return undefined; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [asking]);

  // A week of activity, for the prepared questions only. Small, and read once per visit.
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    let live = true;
    api('/api/activity?days=7&top=100').then((d) => { if (live) setFeed(d.items || []); }).catch(() => { if (live) setFeed([]); });
    return () => { live = false; };
  }, []);

  // Recently asked is the app's memory, written by the shell the moment an answer lands
  // (rememberAnswer) and read back here whenever the answer on screen changes.
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => { setRecent(readRecent()); }, [answer]);
  const forget = () => { writeRecent([]); setRecent([]); };

  // The screen is sized to the space under the header, so the page never scrolls: the
  // question stays on top, the right column stays put, and only the answer body scrolls.
  const root = useRef(null);
  const [height, setHeight] = useState(null);
  useEffect(() => {
    const fit = () => {
      const el = root.current;
      if (!el) return;
      const scroller = el.closest('.plugin-surface') || document.documentElement;
      if (el.clientWidth < 800) { setHeight(null); return; }
      const top = el.getBoundingClientRect().top;
      const bottom = scroller.getBoundingClientRect().bottom;
      setHeight(Math.max(360, Math.floor(bottom - top - 68)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const suggestions = useMemo(() => prepare({ items: items || [], sprint, feed }), [items, sprint, feed]);

  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);

  const answerPanel = () => {
    if (asking) {
      return Panel(host, { title: 'Reading Azure DevOps', action: meta(`${elapsed}s`), style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI is querying the sprints, the timeline and the items the question needs, then writing the answer. A wide question takes a minute or two.'),
        h(ui.Skeleton, { count: 5, height: 16 }));
    }
    if (!answer) {
      // Before the first question: what the player has to read from, with live counts.
      const open = (items || []).filter((i) => i.state !== 'Closed' && i.state !== 'Removed').length;
      const people = feed ? new Set(feed.map((i) => i.changedBy).filter(Boolean)).size : 0;
      const strip = [
        Health(host, { label: sprint ? sprint.name.split(' - ')[0] : 'backlog', value: `${open} open`, hint: `of ${(items || []).length}` }),
        Health(host, { label: 'this week', value: feed ? `${feed.length} changes` : '...', tone: 'brass' }),
        Health(host, { label: 'closed', value: feed ? `${feed.filter((i) => i.state === 'Closed').length}` : '...', tone: 'moss', hint: '7 days' }),
        Health(host, { label: 'people', value: feed ? `${people}` : '...', hint: 'active this week' }),
        Health(host, { label: 'reach', value: 'a year', hint: 'sprints, history, comments' }),
      ];
      return Panel(host, { title: 'Answer', action: meta('nothing asked yet'), style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI reads Azure DevOps through this plugin for whatever period the question needs and answers from what it read, citing work items you can open. Ask something, or pick a prepared question on the right.'),
        h('div', { className: 'mhealth' }, ...strip));
    }
    const ids = cited(answer.answer);
    const keepAnswer = async () => { if (host.writeNote && await host.writeNote(`Azure DevOps - ${answer.question.slice(0, 60)}`, `# ${answer.question}\n\n_Asked ${new Date(answer.at).toLocaleString()}${sprint ? `, sprint ${sprint.name}` : ''}._\n\n${answer.answer}`)) host.notify('Saved as a note', 'moss'); };
    return Panel(host, { title: 'Answer', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: keepAnswer }, 'Save as note') : null, meta(`${when(answer.at)} - ${answer.seconds}s${ids.length ? ` - ${ids.length} item${ids.length === 1 ? '' : 's'} cited` : ''}`)) },
      h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, answer.question),
      h(ui.Markdown, { source: answer.answer }),
      ids.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'var(--sy-s3)', paddingTop: 'var(--sy-s3)', borderTop: `1px solid ${tokens('line')}` } },
        ids.map((id) => h(ui.Chip, { key: id, onClick: () => onOpen(id), title: `Open #${id}` }, `#${id}`))) : null);
  };

  const column = (...children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0, height: '100%' } }, ...children);

  return h('div', { ref: root, className: 'ado-ask', style: { height: height ? `${height}px` : 'auto' } },
    column(
      Panel(host, { title: 'Ask about the work', action: meta('any period - a week, a month, a year') },
        h('div', { style: { display: 'flex', gap: 8 } },
          h(ui.Input, {
            placeholder: '"what did we close in July?" or "who worked on the gallery last month?"',
            value: question,
            disabled: asking,
            onChange: (e) => setQuestion(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') ask(); },
          }),
          h(ui.Button, { variant: 'primary', disabled: asking || !question.trim(), onClick: () => ask() },
            asking ? `Asking... ${elapsed}s` : 'Ask'))),
      answerPanel(),
    ),
    column(
      Panel(host, { title: 'Worth asking', action: meta(feed ? 'from the sprint and this week' : 'reading this week...') },
        List(host, suggestions.map((s) => ListRow(host, {
          key: s.q,
          lead: h(icons.search, { size: 13, style: { opacity: 0.6, flex: 'none' } }),
          label: s.q,
          sub: s.why,
          onClick: asking ? undefined : () => { setQuestion(s.q); ask(s.q); },
        })))),
      Panel(host, {
        title: 'Recently asked',
        style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' },
        action: recent.length
          ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' }, onClick: forget, title: 'Forget every answer kept here' }, `${recent.length} kept - clear`)
          : meta('kept in the app'),
      },
        recent.length
          ? List(host, recent.map((e) => ListRow(host, {
            key: e.at,
            lead: h(icons.history, { size: 13, style: { opacity: 0.6, flex: 'none' } }),
            label: short(e.question),
            sub: `${when(e.at)} - ${e.seconds}s${cited(e.answer).length ? ` - ${cited(e.answer).length} items` : ''}`,
            onClick: () => { setQuestion(e.question); setAnswer(e); },
          })))
          : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing asked yet. Every answer is kept here, and one click brings it back without asking again.')),
    ),
  );
}
