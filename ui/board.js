/**
 * The backlog and the board.
 *
 * Two views of the same items because they answer different questions: the backlog is for
 * reading a sprint top to bottom with its parents and children in place, and the board is for
 * moving something. Both are here rather than in Cadence itself, because a work item is an
 * Azure DevOps idea and the shell should not have opinions about story points.
 *
 * Parents carry their children: 24 of the 34 items in a sprint here are children, so a flat
 * list is mostly noise and a board that hides the relationship makes a story look like six
 * unrelated tasks.
 */

const STATE_TONE = { New: 'default', Active: 'brass', Resolved: 'moss', Closed: 'default' };

/**
 * The type, as a chip you recognise before you read it.
 *
 * Colour carries the type and the icon repeats it, because colour alone is not something to
 * rely on. Uppercase and fixed width so a column of them lines up.
 */
const TYPE_LOOK = {
  Bug: { colour: 'rosin', icon: 'bug', short: 'BUG' },
  'User Story': { colour: 'brass', icon: 'story', short: 'STORY' },
  Feature: { colour: 'moss', icon: 'feature', short: 'FEATURE' },
  Epic: { colour: 'moss', icon: 'epic', short: 'EPIC' },
  Task: { colour: 'slate', icon: 'task', short: 'TASK' },
};

function typeChip(host, type) {
  const { h, tokens, icons } = host;
  const look = TYPE_LOOK[type] || { colour: 'text-3', icon: 'task', short: String(type || '?').toUpperCase() };
  const Icon = icons[look.icon] || icons.task;
  return h('span', {
    title: type,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap',
      fontSize: 10, letterSpacing: '0.06em', fontWeight: 600,
      color: tokens(look.colour),
      border: `1px solid ${tokens(look.colour)}`,
      background: look.colour === 'slate' ? 'transparent' : tokens(`${look.colour}-soft`),
    },
  }, h(Icon, { size: 11, strokeWidth: 2 }), look.short);
}

/** P1 reads as urgent, P4 as noise; the number alone does not say which. */
function priorityChip(host, priority) {
  const { h, tokens } = host;
  if (!priority) return h('span', { style: { color: tokens('text-3'), fontSize: 12 } }, '-');
  const colour = priority <= 1 ? 'rosin' : priority === 2 ? 'text-2' : 'text-3';
  return h('span', { style: { color: tokens(colour), fontSize: 12, fontVariantNumeric: 'tabular-nums' } }, `P${priority}`);
}

// The middle container is the container. The list and the columns sit in it directly - a
// panel around them was a box inside the box, and read as one.
export function Board({ host, columns, items, loading, error, onOpen, onMoved, filters, setFilters, selectedId, layout = 'backlog', expanded, setExpanded }) {
  const { h, ui, react, api, tokens, notify } = host;
  const { useState, useMemo } = react;

  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);

  // ---------------------------------------------------------------- shaping

  const visible = useMemo(() => {
    const q = (filters.q || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => String(i.title).toLowerCase().includes(q)
      || String(i.id).includes(q)
      || String(i.tags || '').toLowerCase().includes(q));
  }, [items, filters.q]);

  /** Children by parent, and the items that are nobody's child. */
  const { childrenOf, roots } = useMemo(() => {
    const byParent = new Map();
    const ids = new Set(visible.map((i) => i.id));
    const top = [];
    for (const item of visible) {
      // A child whose parent is filtered out would otherwise disappear entirely, so it is
      // promoted to the top rather than hidden inside a parent that is not on screen.
      if (item.parentId && ids.has(item.parentId)) {
        if (!byParent.has(item.parentId)) byParent.set(item.parentId, []);
        byParent.get(item.parentId).push(item);
      } else {
        top.push(item);
      }
    }
    return { childrenOf: byParent, roots: top };
  }, [visible]);

  const toggle = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const move = async (id, state) => {
    setDragging(null);
    setOver(null);
    const item = items.find((i) => i.id === id);
    if (!item || item.state === state) return;
    onMoved(id, state); // optimistic, so the card lands where it was dropped
    try {
      await api(`/api/workitems/${id}/state`, { method: 'PATCH', body: JSON.stringify({ state }) });
      notify(`#${id} is ${state}`, 'moss');
    } catch (e) {
      onMoved(id, item.state); // put it back rather than leave the board telling a lie
      notify(e.message, 'rosin');
    }
  };

  // ---------------------------------------------------------------- pieces

  const doneOf = (item) => {
    const kids = childrenOf.get(item.id) || [];
    if (!kids.length) return null;
    const done = kids.filter((k) => /closed|done|resolved|removed/i.test(k.state)).length;
    return { done, total: kids.length };
  };

  const progress = (item) => {
    const p = doneOf(item);
    if (!p) return null;
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 74 } },
      h('span', {
        style: {
          width: 44, height: 4, borderRadius: 999, background: tokens('line'), overflow: 'hidden', display: 'inline-block',
        },
      }, h('span', {
        style: {
          display: 'block', height: '100%', width: `${Math.round((p.done / p.total) * 100)}%`,
          background: p.done === p.total ? tokens('moss') : tokens('brass'),
        },
      })),
      h('span', { style: { fontSize: 11, color: tokens('text-3') } }, `${p.done}/${p.total}`));
  };

  const dragProps = (item) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragging(item.id);
      e.dataTransfer.effectAllowed = 'move';
      // The id travels on the drag, so the drop does not depend on a re-render having landed.
      e.dataTransfer.setData('application/x-ado-id', String(item.id));
      e.dataTransfer.setData('text/plain', `#${item.id} ${item.title}`);
    },
    onDragEnd: () => { setDragging(null); setOver(null); },
  });

  // ---------------------------------------------------------------- backlog

  const backlogRow = (item, depth) => {
    const kids = childrenOf.get(item.id) || [];
    const open = expanded.has(item.id);
    return [
      h('div', {
        key: item.id,
        ...dragProps(item),
        onClick: () => onOpen(item.id),
        style: {
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          paddingLeft: 14 + depth * 20,
          background: selectedId === item.id ? tokens('brass-soft') : depth === 0 && kids.length ? tokens('raised') : 'transparent',
          boxShadow: selectedId === item.id ? `inset 2px 0 0 ${tokens('brass')}` : 'none',
          borderBottom: `1px solid ${tokens('line')}`,
          cursor: 'pointer', opacity: dragging === item.id ? 0.4 : 1, minWidth: 0,
        },
      },
        kids.length
          ? h('button', {
            type: 'button',
            title: open ? 'Collapse' : 'Expand',
            onClick: (e) => { e.stopPropagation(); toggle(item.id); },
            style: { background: 'none', border: 0, color: tokens('text-3'), cursor: 'pointer', width: 16, padding: 0 },
          }, open ? '⌄' : '›')
          : h('span', { style: { width: 16 } }),
        // The corner glyph and the indent together are what make the tree readable; either one
        // alone leaves you counting pixels to see whose child this is.
        depth > 0
          ? h('span', { style: { color: tokens('text-3'), fontSize: 12, width: 14, flex: '0 0 auto' } }, '\u2514')
          : null,
        h('span', { style: { color: tokens('text-3'), fontSize: 12, width: 62, flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' } }, `#${item.id}`),
        // A fixed lane for the type: 'User Story' wrapping to two lines made every third row
        // taller than the others and the list read as ragged.
        h('span', { style: { width: 80, flex: '0 0 auto', display: 'flex' } }, typeChip(host, item.type)),
        h('span', {
          style: {
            flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: kids.length ? 600 : 400,
            color: /closed|done|removed/i.test(item.state) ? tokens('text-3') : tokens('text'),
          },
        }, item.title),
        progress(item),
        h('span', { style: { width: 78, flex: '0 0 auto', display: 'flex' } },
          h(ui.Badge, { tone: STATE_TONE[item.state] || 'default' }, item.state)),
        h('span', { style: { width: 104, flex: '0 0 auto', fontSize: 12, color: tokens('text-3'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          item.assignedTo || 'unassigned'),
        h('span', { style: { width: 30, flex: '0 0 auto', textAlign: 'right' } }, priorityChip(host, item.priority)),
        h('span', { style: { width: 34, flex: '0 0 auto', textAlign: 'right', fontSize: 12, color: tokens('text-3'), fontVariantNumeric: 'tabular-nums' } },
          item.storyPoints ? `${item.storyPoints}` : '-')),
      ...(open ? kids.flatMap((k) => backlogRow(k, depth + 1)) : []),
    ];
  };

  const backlog = h('div', { style: { border: `1px solid ${tokens('line')}`, borderRadius: 10, overflow: 'hidden' } },
    h('div', {
      style: {
        display: 'flex', gap: 10, padding: '8px 12px', fontSize: 11, color: tokens('text-3'),
        textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${tokens('line')}`,
        background: tokens('raised'),
      },
    },
      h('span', { style: { width: 16 } }), h('span', { style: { width: 62 } }, 'id'),
      h('span', { style: { width: 80 } }, 'type'),
      h('span', { style: { flex: '1 1 auto' } }, 'title'),
      h('span', { style: { width: 74 } }, 'children'),
      h('span', { style: { width: 78 } }, 'state'),
      h('span', { style: { width: 104 } }, 'assigned'),
      h('span', { style: { width: 30, textAlign: 'right' } }, 'pri'),
      h('span', { style: { width: 34, textAlign: 'right' } }, 'pts')),
    roots.flatMap((item) => backlogRow(item, 0)));

  // ---------------------------------------------------------------- kanban

  const card = (item) => {
    const p = doneOf(item);
    return h('div', {
      key: item.id,
      ...dragProps(item),
      onClick: () => onOpen(item.id),
      style: {
        background: tokens('raised'), border: `1px solid ${tokens('line')}`, borderRadius: 8,
        padding: 12, display: 'flex', flexDirection: 'column', gap: 7, cursor: 'pointer',
        minWidth: 0, overflow: 'hidden',
        opacity: dragging === item.id ? 0.4 : 1,
        outline: selectedId === item.id ? `1px solid ${tokens('brass')}` : 'none',
      },
    },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 } },
        typeChip(host, item.type),
        h('span', { style: { color: tokens('text-3'), fontSize: 12, fontVariantNumeric: 'tabular-nums' } }, `#${item.id}`),
        priorityChip(host, item.priority),
        item.storyPoints ? h('span', { style: { marginLeft: 'auto', color: tokens('text-3'), fontSize: 12 } }, `${item.storyPoints} pts`) : null),
      h('div', { style: { fontSize: 13, lineHeight: 1.35 } }, item.title),
      p ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, progress(item),
        h('span', { style: { fontSize: 11, color: tokens('text-3') } }, 'children')) : null,
      item.tags ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
        String(item.tags).split(';').filter(Boolean).slice(0, 3).map((t) =>
          h('span', {
            key: t,
            style: { fontSize: 11, color: tokens('text-3'), border: `1px solid ${tokens('line')}`, borderRadius: 999, padding: '1px 7px' },
          }, t.trim()))) : null,
      h('div', { style: { fontSize: 11, color: tokens('text-3') } }, item.assignedTo || 'unassigned'));
  };

  const kanban = h('div', {
    style: { display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: 0, alignItems: 'stretch' },
  },
    columns.map((state, index) => {
      const bucket = visible.filter((i) => i.state === state);
      return h('div', {
        key: state,
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== state) setOver(state); },
        onDragLeave: () => { if (over === state) setOver(null); },
        onDrop: (e) => {
          e.preventDefault();
          const carried = Number(e.dataTransfer.getData('application/x-ado-id')) || dragging;
          if (carried) move(carried, state);
        },
        style: {
          display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, padding: '0 10px 6px', borderRadius: 0,
          borderLeft: index === 0 ? '1px solid transparent' : '1px solid color-mix(in srgb, var(--sy-line) 60%, transparent)',
          outline: over === state && dragging ? `1px dashed ${tokens('brass')}` : '1px dashed transparent',
          background: over === state && dragging ? tokens('brass-soft') : 'transparent',
        },
      },
        h('div', {
          style: {
            position: 'sticky', top: 0, zIndex: 2,
            display: 'flex', gap: 8, alignItems: 'center',
            padding: '8px 0 10px', margin: '0 0 2px',
            background: tokens('bg'),
            color: tokens('text-3'), fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em',
          },
        }, state, h('span', null, bucket.length)),
        bucket.map(card),
        bucket.length === 0 ? h('div', { style: { color: tokens('text-3'), fontSize: 12, padding: 8 } }, 'nothing here') : null);
    }));

  // ---------------------------------------------------------------- view

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    error ? h(ui.EmptyState, { title: 'Azure DevOps did not answer', body: error })
      : loading ? h(ui.Skeleton, { count: 8, height: 34 })
        : !visible.length ? h(ui.EmptyState, { title: 'Nothing matches', body: 'Loosen a filter, or pick another sprint.' })
          : layout === 'backlog' ? backlog : kanban);
}
