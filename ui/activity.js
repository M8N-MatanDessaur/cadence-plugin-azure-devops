/**
 * The project timeline, as a panel of rows.
 *
 * Only the feed lives here: the window chips are in the sidebar with the other pickers, so
 * they never scroll away. Every line opens the item it is about - a timeline you cannot click
 * is a wall - and each one says who, what happened, and when, which is what a timeline is for.
 */
import { ago } from './helpers.js';
import { Panel, List, ListRow } from './kit.js';

const TYPE_COLOUR = { Bug: 'var(--sy-rosin)', 'User Story': 'var(--sy-brass)', Feature: 'var(--sy-moss)', Epic: 'var(--sy-moss)', Task: 'var(--sy-slate)' };

export function Activity({ host, feed, error, onOpen }) {
  const { h, ui } = host;

  if (error) return h(ui.EmptyState, { title: 'Could not read the activity', body: error });
  if (!feed) return h(ui.Skeleton, { count: 10, height: 34 });
  if (!feed.length) return h(ui.EmptyState, { title: 'Nothing moved', body: 'No work items changed in this window.' });

  // A day heading between groups, so a week of changes reads as days rather than one wall.
  const groups = [];
  for (const i of feed) {
    const day = String(i.changedDate).slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(i); else groups.push({ day, items: [i] });
  }

  return h('div', { className: 'mgrid' },
    groups.map((g) => Panel(host, {
      key: g.day,
      title: dayLabel(g.day),
      wide: true,
      action: h('span', { className: 'mpanel__meta' }, `${g.items.length} change${g.items.length === 1 ? '' : 's'}`),
    },
      List(host, g.items.map((i) => ListRow(host, {
        key: `${i.id}-${i.changedDate}`,
        lead: h('span', { className: 'mind-dot', style: { background: TYPE_COLOUR[i.type] || 'var(--sy-text-3)' } }),
        label: `#${i.id} ${i.title}`,
        sub: `${i.isNew ? 'created' : 'updated'} ${ago(i.changedDate)} by ${i.changedBy || 'unknown'} - now ${i.state}${i.assignedTo ? `, with ${i.assignedTo}` : ''}`,
        meta: i.storyPoints ? `${i.storyPoints} pts` : null,
        onClick: () => onOpen(i.id),
      }))))));
}

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
