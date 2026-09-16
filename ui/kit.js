// A value that is not known yet is a shape, not three dots: a stat tile and a health figure
// draw a skeleton the size of the number until the real one lands.
const pending = (v) => v === '\u2026' || v === '...';
/**
 * The app's own building blocks, reached from a plugin.
 *
 * A surface written as an `entry` module renders inside the app's document, so the classes the
 * Mind and Notes views are built from - mpanel, mstat, mbars, sb__item - apply to it directly.
 * These are those pieces as `h()` builders, mirroring apps/web/src/features/mind/shared.tsx
 * one for one, so a screen here is made of the same parts as the screens beside it and
 * inherits every theme the app has.
 *
 * Nothing in this file names a colour or a size. If the app changes what a panel looks like,
 * this changes with it, which is the entire point.
 */

const CSS = `
.ado-main { container-type: inline-size; }
.ado-row3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sy-s3); }
.ado-row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sy-s3); }
.ado-ask { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); grid-template-rows: minmax(0, 1fr); gap: var(--sy-s3); }
.ado-item { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: var(--sy-s3); align-items: start; }
@container (max-width: 620px) {
  .ado-ask { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; height: auto !important; }
}
@container (max-width: 700px) {
  .ado-row3 { grid-template-columns: minmax(0, 1fr); }
  .ado-item { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 640px) {
  .ado-row2 { grid-template-columns: minmax(0, 1fr); }
}
`;

/** The plugin's own layout rules, added to the document the first time a panel is drawn. */
export function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('ado-kit-css')) return;
  const el = document.createElement('style');
  el.id = 'ado-kit-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** A titled panel: uppercase tracked title, optional right-hand meta, bordered body. */
export function Panel(host, { title, action, wide, className = '', style, bodyStyle }, ...children) {
  const { h, ui } = host;
  ensureStyles();
  return h('section', { className: `mpanel${wide ? ' mpanel--wide' : ''} ${className}`.trim(), style },
    title !== undefined
      ? h('header', { className: 'mpanel__head' }, h('span', { className: 'mpanel__title' }, title), action || null)
      : null,
    h('div', { className: 'mpanel__body', style: bodyStyle }, ...children));
}

/** A number with a label under it. tone: brass | moss | rosin | muted */
export function Stat(host, { label, value, hint, tone }) {
  const { h, ui } = host;
  return h('div', { className: `mstat${tone ? ` mstat--${tone}` : ''}` },
    h('div', { className: 'mstat__value' }, pending(value) ? h(ui.Skeleton, { width: 64, height: 22 }) : value),
    h('div', { className: 'mstat__label' }, label),
    hint ? h('div', { className: 'mstat__hint' }, hint) : null);
}

/** One item of the thin status strip that sits under the stat cards. */
export function Health(host, { label, value, tone, hint }) {
  const { h, ui } = host;
  return h('span', { className: `mhealth__item${tone ? ` mhealth__item--${tone}` : ''}` },
    h('span', { className: 'mhealth__label' }, label),
    h('b', { className: 'mhealth__value' }, pending(value) ? h(ui.Skeleton, { width: 26, height: 11 }) : value),
    hint ? h('span', { className: 'mhealth__hint' }, hint) : null);
}

/** Label / bar / number rows, scaled to the largest unless a max is given. */
export function Bars(host, { rows, max }) {
  const { h, ui } = host;
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return h('div', { className: 'mbars' },
    rows.map((r) => h('div', { key: r.label, className: 'mbars__row', title: r.hint },
      h('span', { className: 'mbars__label' }, r.label),
      h('span', { className: 'mbars__track' },
        h('span', { className: 'mbars__fill', style: { width: `${Math.max(2, (r.value / top) * 100)}%`, background: r.color } })),
      h('span', { className: 'mbars__value' }, Number(r.value).toLocaleString()))));
}

/** A list row: optional leading node, label, optional sub line, optional trailing meta. */
export function ListRow(host, { key, lead, label, sub, meta, onClick, tall }) {
  const { h, ui } = host;
  const cls = `mlist__row${tall || sub ? ' mlist__row--tall' : ''}`;
  const inner = [
    lead || null,
    sub
      ? h('span', { className: 'mlist__main' }, h('span', { className: 'mlist__label' }, label), h('span', { className: 'mlist__sub' }, sub))
      : h('span', { className: 'mlist__label' }, label),
    meta ? h('span', { className: 'mlist__meta' }, meta) : null,
  ];
  return h('li', { key },
    onClick
      ? h('button', { type: 'button', className: cls, onClick }, ...inner)
      : h('div', { className: cls }, ...inner));
}

export function List(host, children) {
  return host.h('ul', { className: 'mlist', role: 'list' }, ...children);
}

/** A sidebar nav row, exactly as Mind's sidebar draws one. */
export function NavItem(host, { key, icon, label, active, badge, onClick, title }) {
  const { h, ui } = host;
  return h('li', { key },
    h('button', { type: 'button', className: `sb__item${active ? ' sb__item--active' : ''}`, onClick, title },
      icon ? h(icon, { size: 15, className: 'sb__icon' }) : null,
      h('span', { className: 'sb__item-label' }, label),
      badge !== undefined && badge !== null ? h(ui.Badge, null, String(badge)) : null));
}

/** The uppercase tracked section label a sidebar uses between groups. */
export function Section(host, title, right) {
  const { h, ui } = host;
  return h('div', { className: 'sb__section' }, h('span', { className: 'sb__title' }, title), right || null);
}

/** A panel that fills its column and scrolls inside, with a gutter so text never touches the scrollbar. */
export const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
