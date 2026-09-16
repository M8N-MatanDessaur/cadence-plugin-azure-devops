/**
 * One work item, as a dashboard.
 *
 * The title is the headline and the numbers are the row under it, so the shape of the item is
 * clear before a word of the description is read. Two columns beneath: on the left, what the
 * item is (description, acceptance criteria) and what has been said and done about it
 * (comments, with the composer first, then the history); on the right, what you can do to it -
 * start working, which cuts the branch and hands you to the terminal, the state, the owner,
 * the tags, the details, and an AI-written plan if you want one.
 *
 * Everything that changes the item goes through the plugin's own routes, and the screen reads
 * the item again after each change so what is shown is what Azure DevOps has.
 */
import { ago, stripHtml, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

const STATES = ['New', 'Active', 'Resolved', 'Closed'];
const TYPE_COLOUR = { Bug: 'var(--sy-rosin)', 'User Story': 'var(--sy-brass)', Feature: 'var(--sy-moss)', Epic: 'var(--sy-moss)', Task: 'var(--sy-slate)' };
const leaf = (path) => String(path || '').split('\\').pop() || '-';
const REPO_KEY = 'sy.ado.work-repo';
const readRepo = () => { try { return localStorage.getItem(REPO_KEY) || ''; } catch { return ''; } };
const saveRepo = (name) => { try { localStorage.setItem(REPO_KEY, name); } catch {} };

const splitTags = (tags) => String(tags || '').split(';').map((t) => t.trim()).filter(Boolean);

export function WorkItem({ host, id, onClose, setState, startWorking, members }) {
  const { h, ui, react, api, tokens, notify, icons, navigate, context } = host;
  const { useState, useEffect, useRef } = react;

  const [item, setItem] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [tag, setTag] = useState('');
  const [sending, setSending] = useState(false);
  const [branch, setBranch] = useState(null);
  const [starting, setStarting] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [planWide, setPlanWide] = useState(false);
  useEffect(() => { if (!plan) setPlanWide(false); }, [plan]);

  // The plan, into the terminal (flattened to one line, ready to send) or into a note.
  const planToShell = async () => {
    if (!plan) return;
    const ok = host.sendToShell ? await host.sendToShell(`Plan for Azure DevOps #${id} "${item ? item.title : ''}":\n${plan}`, { target: repoTarget() }) : false;
    if (!ok && !host.sendToShell) notify('This app cannot type into a shell from a plugin', 'rosin');
  };
  const planToNote = async () => {
    if (!plan) return;
    const name = `AB#${id} plan`;
    const content = `# ${item ? item.title : `#${id}`}\n\nAzure DevOps #${id} - plan written ${new Date().toLocaleString()}\n\n${plan}`;
    try {
      // Through the app when it can: the note lands in the namespace Notes is showing and opens.
      if (host.writeNote) { if (await host.writeNote(name, content)) notify(`Saved and opened "${name}"`, 'moss'); return; }
      await api('/api/notes/save', { method: 'POST', body: JSON.stringify({ name, content }) });
      notify(`Saved as note "${name}"`, 'moss');
      navigate('notes');
    } catch (e) { notify(e.message, 'rosin'); }
  };

  // ---- the repo the branch is cut in: the last choice, else the app's active repo.
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState(() => readRepo() || ((context && context()) || {}).activeRepo || '');
  const [chooser, setChooser] = useState(false);
  const [repoPaths, setRepoPaths] = useState({});
  useEffect(() => { api('/api/repos').then((d) => { setRepoPaths(d || {}); setRepos(Object.keys(d || {}).sort((a, b) => a.localeCompare(b))); }).catch(() => setRepos([])); }, []);
  const repoTarget = () => (repo && repoPaths[repo] ? { repo, path: repoPaths[repo] } : null);
  // The terminal for this work: a shell on the chosen repo with the default AI started in it,
  // which bootstraps on that repo. Older hosts without openShell just show the terminal.
  const openWork = () => { const t = repoTarget(); if (host.openShell && t) return host.openShell(t, { launch: true, label: `AB#${id}` }); return navigate('terminal'); };
  const chooseRepo = (name) => { setRepo(name); if (name) saveRepo(name); };

  // ---- @mentions in the composer
  const people = (members || []).map((m) => ({ id: m.id, name: m.displayName || m.name || String(m), mail: m.uniqueName || m.email || '' })).filter((m) => m.name);
  const nameOf = (guid) => { const hit = people.find((m) => String(m.id || '').toLowerCase() === String(guid || '').toLowerCase()); return hit ? hit.name : 'someone'; };
  // Comments read back carry the identity as "@<id>"; the screen shows the name.
  const mentions = (text) => String(text || '').replace(/@<([^>]*)>/g, (_, g) => `@${nameOf(g)}`);
  const taRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const candidates = menu ? people.filter((m) => m.name.toLowerCase().includes(menu.query.toLowerCase())).slice(0, 6) : [];
  const detect = (el) => {
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos);
    const m = before.match(/(?:^|\s)@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/);
    if (!m) { setMenu(null); return; }
    setMenu({ query: m[1], start: pos - m[1].length - 1, index: 0 });
  };
  const pick = (m) => {
    const el = taRef.current;
    const pos = el ? el.selectionStart : comment.length;
    const before = comment.slice(0, menu.start);
    const after = comment.slice(pos);
    const next = `${before}@${m.name} ${after}`;
    setComment(next);
    setMenu(null);
    requestAnimationFrame(() => { if (!el) return; el.focus(); const p = before.length + m.name.length + 2; el.setSelectionRange(p, p); });
  };
  const onComposerKey = (e) => {
    if (menu && candidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % candidates.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + candidates.length) % candidates.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates[menu.index]); return; }
      if (e.key === 'Escape') { setMenu(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment();
  };
  const mentioned = people.filter((m) => comment.includes(`@${m.name}`));

  const load = () => {
    setError(null);
    api(`/api/workitems/${id}`).then(setItem).catch((e) => setError(e.message));
    api(`/api/workitems/${id}/updates`).then((d) => setUpdates(d.updates || [])).catch(() => setUpdates([]));
  };
  useEffect(() => { setItem(null); setBranch(null); setPlan(null); load(); }, [id]);

  const mutate = async (fn, done) => {
    setSending(true);
    try { await fn(); if (done) notify(done, 'moss'); load(); } catch (e) { notify(e.message, 'rosin'); } finally { setSending(false); }
  };
  const patch = (body) => api(`/api/workitems/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

  const addComment = () => {
    if (!comment.trim()) return;
    const named = (members || []).filter((m) => comment.includes(`@${m.displayName || m.name}`)).map((m) => ({ id: m.id, name: m.displayName || m.name }));
    mutate(async () => { await api(`/api/workitems/${id}/comments`, { method: 'POST', body: JSON.stringify({ text: comment, mentions: named }) }); setComment(''); setMenu(null); }, named.length ? `Comment added, ${named.map((m) => m.name.split(' ')[0]).join(' and ')} mentioned` : 'Comment added');
  };
  const addTag = () => {
    const next = tag.trim();
    if (!next) return;
    const existing = splitTags(item && item.tags);
    if (existing.some((t) => t.toLowerCase() === next.toLowerCase())) { setTag(''); return; }
    // Azure DevOps stores tags as one semicolon-joined string, so adding one means sending them all back.
    mutate(async () => { await patch({ tags: [...existing, next].join('; ') }); setTag(''); }, `Tagged ${next}`);
  };
  const removeTag = (drop) => mutate(() => patch({ tags: splitTags(item && item.tags).filter((t) => t.toLowerCase() !== drop.toLowerCase()).join('; ') }));
  const assign = (who) => mutate(() => patch({ assignedTo: who }), who ? `Assigned to ${who}` : 'Unassigned');
  const move = (s) => mutate(() => setState(id, s));

  // Start working: the shell moves it to Active and cuts a branch; the branch name comes back
  // here so the next step - the terminal - is one click away.
  const start = async (name = repo) => {
    if (!name) {
      if (host.pickTarget) {
        const t = await host.pickTarget({ title: 'Choose a repo to work with', detail: `The branch for #${id} is cut in a repo from your list. It is remembered for next time and can be changed beside the button.`, confirm: 'Use this repo and start' });
        if (!t) return;
        chooseRepo(t.repo);
        name = t.repo;
      } else { setChooser(true); return; }
    }
    setChooser(false);
    setStarting(true);
    try {
      const r = await startWorking(id, name);
      if (r && r.branch) setBranch(r.branch);
      load();
    } finally { setStarting(false); }
  };

  const repoSelect = (extra = {}) => h(ui.Select, {
    value: repo, disabled: starting || sending, 'aria-label': 'Repo to work in', title: 'The repo the branch is cut in',
    onChange: (e) => chooseRepo(e.target.value), ...extra,
  },
    h('option', { value: '' }, repos.length ? 'choose a repo...' : 'no repos configured'),
    repos.map((name) => h('option', { key: name, value: name }, name)));

  // With no repo chosen, Start working asks for one rather than failing.
  const chooserDialog = chooser ? h(ui.Modal, {
    title: 'Choose a repo to work with',
    onClose: () => setChooser(false),
    footer: h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
      h(ui.Button, { onClick: () => setChooser(false) }, 'Not now'),
      h(ui.Button, { variant: 'primary', disabled: !repo, onClick: () => start(repo) }, 'Use this repo and start')),
  },
    h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, `The branch for #${id} is cut in a repo from your list. Pick the one this work belongs to; it is remembered for next time and can be changed beside the button.`),
    h(ui.Field, { label: 'Repo' }, repoSelect({ autoFocus: true }))) : null;

  const planIt = async () => {
    setPlanning(true);
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const prompt = [
        `Read Azure DevOps work item #${id} and write a short working plan for it. Today is ${new Date().toISOString().slice(0, 10)}.`,
        '',
        'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call PATCH, POST or DELETE.',
        `  ${base}/api/workitems/${id}            the item: description, acceptance criteria, comments, linked items`,
        `  ${base}/api/workitems/${id}/updates    its field history`,
        `  ${base}/api/workitems/ID               any linked or parent item`,
        '',
        'Cover: what is actually being asked (in your own words), what is unclear or missing and who to ask, the steps to do it, how to verify it is done, and any risk. Be concrete and short.',
        'Answer in Markdown: a short lead, then bold labels and bullets. Write every work item as #ID. This is a one-off answer: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the plan only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'ado-item', timeout: 240000, prompt }) });
      const text = result.handledLocally ? (result.answer || '') : result.id ? await waitForTask(api, result.id, 240000) : (result.error || 'No plan came back.');
      setPlan(String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim());
    } catch (e) { notify(e.message, 'rosin'); } finally { setPlanning(false); }
  };

  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);

  if (error) return h(ui.EmptyState, { title: `Could not open #${id}`, body: error });
  if (!item) {
    return h('div', null,
      h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))),
      h('div', { className: 'ado-item', style: { marginTop: 'var(--sy-s3)' } },
        Panel(host, { title: 'Description' }, h(ui.Skeleton, { count: 6, height: 16 })),
        Panel(host, { title: 'Work on it' }, h(ui.Skeleton, { count: 4, height: 16 }))));
  }

  const tags = splitTags(item.tags);
  const comments = (item.comments || []).slice().sort((a, b) => String(b.date || b.createdDate).localeCompare(String(a.date || a.createdDate)));
  const lastHuman = comments.find((c) => c.author);
  const stateTone = item.state === 'Closed' ? 'moss' : item.state === 'Active' ? 'brass' : item.state === 'Resolved' ? 'moss' : 'muted';
  const sprint = leaf(item.iterationPath);
  const isDone = /closed|removed/i.test(item.state);
  const chip = (t) => h('span', {
    key: t,
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: tokens('text-2'), border: `1px solid ${tokens('line-strong')}`, borderRadius: 999, padding: '2px 6px 2px 9px' },
  }, t, h('button', { type: 'button', title: `Remove ${t}`, disabled: sending, onClick: () => removeTag(t), style: { background: 'none', border: 0, color: tokens('text-3'), cursor: 'pointer', padding: 0, lineHeight: 1 } }, h(icons.close, { size: 11 })));

  // One builder for both places the plan is shown: the right column (capped, scrolling) and
  // the whole middle (expanded).
  const planPanel = (wide) => Panel(host, {
    title: 'Plan',
    style: wide ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined,
    bodyStyle: wide ? { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } : undefined,
    action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      plan ? h(ui.Button, { size: 'sm', onClick: planToShell, title: 'Type the plan into the active shell, ready to send' }, 'Insert in terminal') : null,
      plan ? h(ui.Button, { size: 'sm', onClick: planToNote, title: `Save as the note "AB#${id} plan"` }, 'Save as note') : null,
      plan ? h(ui.Button, { size: 'sm', title: wide ? 'Back to the item' : 'Open the plan across the screen', onClick: () => setPlanWide(!wide) }, wide ? 'Close' : 'Expand') : null,
      !plan ? meta('optional') : null),
  },
    plan
      ? h('div', { style: wide ? undefined : { maxHeight: 360, overflow: 'auto', paddingRight: 4 } }, h(ui.Markdown, { source: plan }))
      : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Reads the item, its comments and its history, and writes what is being asked, what is unclear, the steps, and how to verify it.'),
    planning ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
    !wide ? h('div', { style: { marginTop: plan ? 'var(--sy-s3)' : 0 } },
      h(ui.Button, { size: 'sm', disabled: planning, onClick: planIt }, planning ? 'Reading...' : plan ? 'Plan it again' : 'Plan it')) : null);

  const historyRow = (u, i) => ListRow(host, {
    key: i,
    lead: h('span', { className: 'mind-dot', style: { background: u.changes.some((c) => c.field === 'State') ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }),
    label: u.changes.map((c) => `${c.field}: ${leaf(c.from) === '-' ? 'nothing' : leaf(c.from)} -> ${leaf(c.to) === '-' ? 'nothing' : leaf(c.to)}`).join(', '),
    sub: `${u.by || 'unknown'} - ${ago(u.at)}`,
  });

  return h('div', null,
    chooserDialog,
    // ---- headline
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h('span', { className: 'mind-dot', style: { background: TYPE_COLOUR[item.type] || 'var(--sy-text-3)' } }),
          h('span', { className: 'mpanel__title' }, `${item.type} #${id}`),
          h('span', { className: 'mpanel__meta' }, `${sprint} - ${leaf(item.areaPath)}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, item.title),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } },
          `${item.assignedTo ? `Assigned to ${item.assignedTo}` : 'Nobody is on it'} - opened by ${item.createdBy || 'unknown'} ${ago(item.createdDate)} - last change ${ago(item.changedDate)}${item.reason ? ` (${item.reason.toLowerCase()})` : ''}.`)),
      // "Back to the list" is the shell header's action; only the outward link lives here.
      item.webUrl ? h('a', { className: 'sy-btn sy-btn--sm', href: item.webUrl, target: '_blank', rel: 'noreferrer', title: 'Open in Azure DevOps', style: { flex: 'none' } }, 'Open in ADO') : null),

    planWide ? h('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: 420 } }, planPanel(true)) : null,

    // ---- the numbers
    planWide ? null : h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'State', value: item.state, tone: stateTone }),
      Stat(host, { label: 'Points', value: item.storyPoints || item.effort || '-' }),
      Stat(host, { label: 'Priority', value: item.priority ? `P${item.priority}` : '-', tone: item.priority === 1 ? 'rosin' : undefined, hint: item.severity || undefined }),
      Stat(host, { label: 'Comments', value: comments.length, hint: lastHuman ? `last ${ago(lastHuman.date || lastHuman.createdDate)}` : undefined })),

    planWide ? null : h('div', { className: 'mhealth', role: 'group', 'aria-label': 'Where it sits' },
      Health(host, { label: 'Sprint', value: sprint }),
      Health(host, { label: 'Area', value: leaf(item.areaPath) }),
      Health(host, { label: 'Linked', value: (item.linkedItems || []).length, hint: 'items' }),
      Health(host, { label: 'Attachments', value: (item.attachments || []).length }),
      tags.length ? Health(host, { label: 'Tags', value: tags.length, hint: tags.slice(0, 3).join(', ') }) : Health(host, { label: 'Tags', value: 'none' })),

    // ---- two columns
    planWide ? null : h('div', { className: 'ado-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Description', action: meta(item.type) },
          item.description ? h(ui.Markdown, { source: item.description }) : empty('No description was written.')),
        item.acceptanceCriteria ? Panel(host, { title: 'Acceptance criteria' }, h(ui.Markdown, { source: item.acceptanceCriteria })) : null,
        item.reproSteps ? Panel(host, { title: 'Steps to reproduce' }, h(ui.Markdown, { source: item.reproSteps })) : null,

        Panel(host, { title: 'Comments', action: meta(comments.length ? `${comments.length}` : 'none yet') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: comments.length ? 'var(--sy-s3)' : 0 } },
            h('div', { style: { position: 'relative' } },
              h(ui.Textarea, {
                ref: taRef, value: comment, placeholder: 'What did you find, decide, or need from someone? Type @ to mention a teammate.', disabled: sending,
                onChange: (e) => { setComment(e.target.value); detect(e.target); },
                onKeyDown: onComposerKey,
                onClick: (e) => detect(e.target),
                onBlur: () => setTimeout(() => setMenu(null), 150),
              }),
              menu && candidates.length ? h('div', {
                role: 'listbox',
                style: { position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 5, minWidth: 260, background: 'var(--sy-surface)', border: `1px solid ${tokens('line-strong')}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden' },
              }, candidates.map((m, i) => h('button', {
                key: m.id || m.name, type: 'button', role: 'option', 'aria-selected': i === menu.index,
                onMouseDown: (e) => { e.preventDefault(); pick(m); },
                onMouseEnter: () => setMenu({ ...menu, index: i }),
                style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, width: '100%', textAlign: 'left', padding: '7px 10px', border: 0, cursor: 'pointer', background: i === menu.index ? 'var(--sy-surface-2, rgba(255,255,255,0.06))' : 'transparent', color: 'var(--sy-text)', font: 'inherit' },
              },
                h('span', { style: { fontSize: 'var(--sy-fs-sm)', fontWeight: 600 } }, m.name),
                h('span', { className: 'mpanel__meta' }, m.mail)))) : null),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h(ui.Button, { variant: 'primary', disabled: sending || !comment.trim(), onClick: addComment }, sending ? 'Sending...' : mentioned.length ? `Comment and notify ${mentioned.length}` : 'Comment'),
              h('span', { className: 'mpanel__meta' }, mentioned.length ? `Mentions ${mentioned.map((m) => m.name).join(', ')}. Ctrl+Enter sends.` : 'Type @ to mention someone. Ctrl+Enter sends. Posted as you, on the item.'))),
          comments.length ? h('div', null, comments.map((c, i) => h('div', {
            key: c.id || i,
            style: { padding: 'var(--sy-s2) 0', borderTop: `1px solid ${tokens('line')}` },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
              h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }),
              h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, c.author || 'unknown'),
              h('span', { className: 'mpanel__meta' }, ago(c.date || c.createdDate))),
            h('p', { style: { margin: 0, fontSize: 'var(--sy-fs-sm)', lineHeight: 1.5, color: 'var(--sy-text-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, mentions(stripHtml(c.text)))))) : null),

        Panel(host, { title: 'History', action: meta(updates.length ? `${updates.length} revision${updates.length === 1 ? '' : 's'}` : 'nothing yet') },
          updates.length ? List(host, updates.slice(0, 20).map(historyRow)) : empty('No field has changed since it was created.'))),

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Work on it', action: meta(branch ? 'branch ready' : isDone ? 'done' : item.state === 'New' ? 'not started' : 'in progress') },
          branch
            ? h('div', null,
              h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, `You are on ${branch}. Open a shell in the repo and start; comment here as you go.`),
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                h(ui.Button, { variant: 'primary', onClick: () => void openWork() }, repo ? `Work on it in ${repo}` : 'Open the terminal'),
                h(ui.Button, { onClick: () => { navigator.clipboard && navigator.clipboard.writeText(`git checkout ${branch}`); notify('Copied', 'moss'); } }, 'Copy checkout')))
            : item.state === 'New'
              ? h('div', null,
                h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Moves it to Active, assigns it, and cuts a branch named after it in the active repo. Then the terminal is one click away.'),
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h(ui.Button, { variant: 'primary', disabled: starting || sending, onClick: () => start() }, starting ? 'Starting...' : 'Start working'),
                  h('span', { className: 'mpanel__meta' }, 'in'),
                  h('div', { style: { flex: '1 1 160px', minWidth: 160 } }, repoSelect())))
              : isDone
                ? h('p', { className: 'mlead', style: { margin: 0 } }, `This one is ${item.state.toLowerCase()}. Reopen it below if it is not.`)
                : h('div', null,
                  h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Already in progress. Pick up in the terminal, and leave a comment when something is worth knowing.'),
                  h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                    h(ui.Button, { variant: 'primary', onClick: () => void openWork() }, repo ? `Work on it in ${repo}` : 'Open the terminal'),
                    h(ui.Button, { disabled: starting || sending, onClick: () => start() }, starting ? 'Cutting...' : 'Cut a branch'),
                    h('div', { style: { flex: '1 1 160px', minWidth: 160 } }, repoSelect()))),
          h('div', { style: { marginTop: 'var(--sy-s3)', paddingTop: 'var(--sy-s3)', borderTop: `1px solid ${tokens('line')}` } },
            h(ui.Field, { label: 'State' },
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                STATES.map((s) => h(ui.Chip, { key: s, on: item.state === s, disabled: sending, onClick: () => { if (item.state !== s) move(s); } }, s)))),
            h(ui.Field, { label: 'Assigned to' },
              h(ui.Select, { value: item.assignedTo || '', disabled: sending, onChange: (e) => assign(e.target.value) },
                h('option', { value: '' }, 'nobody'),
                (members || []).map((m) => { const name = m.displayName || m.name || String(m); return h('option', { key: name, value: name }, name); }))))),

        planPanel(false),

        Panel(host, { title: 'Tags', action: meta(tags.length ? `${tags.length}` : 'none') },
          tags.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--sy-s2)' } }, tags.map(chip)) : null,
          h('div', { style: { display: 'flex', gap: 8 } },
            h(ui.Input, { value: tag, placeholder: 'add a tag', disabled: sending, onChange: (e) => setTag(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addTag(); } }),
            h(ui.Button, { disabled: sending || !tag.trim(), onClick: addTag }, 'Add'))),

        Panel(host, { title: 'Details' },
          h(ui.InfoGrid, { items: [
            { label: 'Created by', value: item.createdBy || '-' },
            { label: 'Created', value: new Date(item.createdDate).toLocaleDateString() },
            { label: 'Iteration', value: sprint },
            { label: 'Area', value: leaf(item.areaPath) },
            { label: 'Reason', value: item.reason || '-' },
            { label: 'Severity', value: item.severity || '-' },
          ] })),

        (item.linkedItems || []).length ? Panel(host, { title: 'Linked items', action: meta(`${item.linkedItems.length}`) },
          List(host, item.linkedItems.map((l, i) => ListRow(host, {
            key: l.id || i,
            label: `#${l.id} ${l.title || ''}`,
            sub: l.relation || l.type || '',
            onClick: l.id ? () => navigate(`azure-devops:ado`) : undefined,
          })))) : null,

        (item.attachments || []).length ? Panel(host, { title: 'Attachments', action: meta(`${item.attachments.length}`) },
          List(host, item.attachments.map((a, i) => ListRow(host, { key: a.id || i, label: a.name || a.url || 'attachment', sub: a.url ? String(a.url).slice(0, 80) : '' })))) : null)),
  );
}
