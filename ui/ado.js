/**
 * Azure DevOps in Cadence 3.0, built the way Notes and Mind are built.
 *
 * Three regions and a header, in the app's own vocabulary:
 *
 *   The sidebar is the plugin's own - a tracked title, a stats line, nav rows with icons and
 *   counts, the pickers (iteration, type, state, search) in a section beneath, and a footer
 *   hint. Everything you filter by lives here, so nothing that matters ever scrolls away.
 *
 *   The header is a title, a subtitle, and actions on the right. Nothing else.
 *
 *   The main area is panels. The right pane is panels. The Team screen is the Mind Overview's
 *   bento: stat cards, a status strip, and a grid of titled panels.
 *
 * Everything Azure DevOps is here rather than in the shell; the shell should not know what a
 * story point is.
 */
import { Board } from './board.js';
import { Activity } from './activity.js';
import { People } from './people.js';
import { WorkItem } from './workitem.js';
import { Insights, Comments } from './insights.js';
import { Overview, OverviewAside } from './overview.js';
import { Ask, rememberAnswer } from './ask.js';
import { usePipelines, useRun, Pipelines, PipelinesAside, PipelinePage, RunPage, RunAside } from './pipelines.js';
import { Releases, ReleasesAside } from './releases.js';
import { waitForTask } from './helpers.js';
import { Panel, Health, Bars, List, ListRow, NavItem, Section } from './kit.js';

const COLUMNS = ['New', 'Active', 'Resolved', 'Closed'];
const WINDOWS = [1, 7, 14, 30];

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'chart', hint: 'The sprint at a glance: done against the clock, who carries what, what needs attention, what moved.' },
  { id: 'backlog', label: 'Backlog', icon: 'list', hint: 'The sprint top to bottom, parents carrying their children.' },
  { id: 'board', label: 'Board', icon: 'chart', hint: 'The same items in columns. Drag one to change its state.' },
  { id: 'activity', label: 'Activity', icon: 'history', hint: 'What moved, who moved it, and when. Every line opens its item.' },
  { id: 'ask', label: 'Ask', icon: 'search', hint: 'A question about the work, over any period. The AI reads Azure DevOps for you.' },
  { id: 'people', label: 'Team', icon: 'people', hint: 'Pick someone on the right to see what they are carrying.' },
  { id: 'pipelines', label: 'Pipelines', icon: 'run', hint: 'Build pipelines and their runs. A failed run explains itself.' },
  { id: 'releases', label: 'Releases', icon: 'tag', hint: 'What is waiting to ship, and release notes between two runs.' },
];

function AzureDevOps({ host }) {
  const { h, ui, react, api, notify, icons } = host;
  const { useState, useEffect, useCallback, useRef } = react;

  const [tab, setTab] = useState('overview');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [iterations, setIterations] = useState([]);
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('');
  const [areas, setAreas] = useState([]);
  const [moreClosed, setMoreClosed] = useState(false);
  const [members, setMembers] = useState([]);
  const [filters, setFilters] = useState({ iteration: '', area: '', type: '', state: '', q: '' });
  const [openId, setOpenId] = useState(null);
  const [pipelineId, setPipelineId] = useState(() => { try { return localStorage.getItem('sy.ado.pipeline') || ''; } catch { return ''; } });
  const [openRun, setOpenRun] = useState(null);
  const [pipelineRuns, setPipelineRuns] = useState(null);
  const [pipelineHealth, setPipelineHealth] = useState(null);
  const [queuing, setQueuing] = useState(null);
  const [notesFor, setNotesFor] = useState(null);
  const [person, setPerson] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  // ---------------------------------------------------------------- opened AT something
  // "@ado 12345" in the palette, a work item a CLI resolved, a person from a question: the
  // app opens this surface with a target and says so again whenever it changes while the
  // screen is up. { workItem } lands on that item; { person } on that person's load;
  // { query } on the backlog filtered to those words.
  const landOn = useCallback((target) => {
    if (!target) return;
    if (target.workItem) { setOpenId(Number(target.workItem) || String(target.workItem)); return; }
    if (target.person) { setPerson(String(target.person)); setOpenId(null); setTab('people'); return; }
    if (target.query) { setFilters((f) => ({ ...f, q: String(target.query) })); setOpenId(null); setTab('backlog'); }
  }, []);
  useEffect(() => {
    if (!host.target || !host.onTarget) return;
    landOn(host.target());
    return host.onTarget(landOn);
  }, [host, landOn]);

  // ---------------------------------------------------------------- work items

  // Two loads race when the screen opens: one with no filters while the sprint list is still
  // arriving, and one for the current sprint the moment it does. Only the newest may write.
  const request = useRef(0);
  const load = useCallback(async (f, opts = {}) => {
    const mine = ++request.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams();
    if (f.iteration) query.set('iteration', f.iteration);
    if (f.area) query.set('area', f.area);
    if (f.type) query.set('type', f.type);
    if (f.state) query.set('state', f.state);
    // Without an iteration the server returns the team's OPEN items only, which is not a
    // backlog. Asking for closed as well brings the 200 most recently changed; the server
    // says whether there are more, and the header says so.
    if (!f.iteration && !f.state) query.set('closedTop', '200');
    if (opts.refresh) query.set('refresh', '1');
    try {
      const data = await api(`/api/workitems${query.toString() ? `?${query}` : ''}`);
      if (mine !== request.current) return;
      setItems(Array.isArray(data) ? data : (data.items || []));
      setMoreClosed(!Array.isArray(data) && !!data.hasMoreClosed);
    } catch (e) {
      if (mine === request.current) setError(e.message);
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [filters.iteration, filters.area, filters.type, filters.state]);

  // Iterations and areas belong to the team - Azure DevOps scopes both to it - so they are
  // fetched again whenever the team changes, and the current sprint is picked afresh.
  const loadTeamScope = useCallback(async (opts = {}) => {
    const q = opts.refresh ? '?refresh=1' : '';
    const [its, ars] = await Promise.all([
      api(`/api/iterations${q}`).catch(() => []),
      api('/api/areas').catch(() => []),
    ]);
    const list = Array.isArray(its) ? its : (its.iterations || []);
    setIterations(list);
    setAreas(Array.isArray(ars) ? ars : (ars.areas || []));
    const now = list.find((i) => i.isCurrent || i.timeFrame === 'current');
    setFilters((f) => ({ ...f, area: '', iteration: now ? (now.path || now.name) : '' }));
  }, []);

  const loadMembers = () => api('/api/team-members').then((d) => setMembers(Array.isArray(d) ? d : (d.members || []))).catch(() => {});

  useEffect(() => {
    api('/api/config').then((c) => setTeam(c.DefaultTeam || '')).catch(() => {});
    api('/api/teams').then((d) => setTeams(Array.isArray(d) ? d : (d.teams || []))).catch(() => {});
    loadMembers();
    loadTeamScope();
  }, []);

  // The Board dropdown is the team. It is a setting rather than a filter - the server reads
  // DefaultTeam for every team-scoped call - so it is written to the config, then everything
  // that depends on it is read again.
  const switchTeam = async (name) => {
    setTeam(name);
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify({ DefaultTeam: name }) });
      await loadTeamScope({ refresh: true });
      loadMembers();
      notify(`Board: ${name}`, 'moss');
    } catch (e) { notify(e.message, 'rosin'); }
  };

  const refresh = () => load(filters, { refresh: true });
  const applyState = (id, state) => setItems((list) => list.map((i) => (i.id === id ? { ...i, state } : i)));

  const setState = async (id, state) => {
    try {
      await api(`/api/workitems/${id}/state`, { method: 'PATCH', body: JSON.stringify({ state }) });
      applyState(id, state);
      notify(`#${id} is ${state}`, 'moss');
    } catch (e) { notify(e.message, 'rosin'); }
  };

  const startWorking = async (id, repoName) => {
    try {
      const r = await api('/api/start-working', { method: 'POST', body: JSON.stringify({ workItemId: id, repoName }) });
      notify(r && r.branch ? `On ${r.branch}` : `Started #${id}`, 'moss');
      applyState(id, 'Active');
      return r;
    } catch (e) { notify(e.message, 'rosin'); return null; }
  };

  // ---------------------------------------------------------------- timeline

  const [days, setDays] = useState(7);
  const [feed, setFeed] = useState(null);
  const [feedError, setFeedError] = useState(null);
  const [comments, setComments] = useState(null);
  const [commentsError, setCommentsError] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (tab !== 'activity' && tab !== 'overview') return;
    setFeed(null);
    setFeedError(null);
    setComments(null);
    setCommentsError(null);
    api(`/api/activity?days=${days}&top=150`)
      .then((d) => setFeed(d.items || []))
      .catch((e) => setFeedError(e.message));
    // Comments are a fan-out on the server (one call per changed item), so they arrive a
    // beat after the feed; the pane shows a placeholder until they do.
    api(`/api/comments?days=${days}&top=40`)
      .then((d) => setComments(d.comments || []))
      .catch((e) => setCommentsError(e.message));
  }, [tab, days]);

  // A prepared question arrives as text; the input's own question is the default.
  const ask = async (text) => {
    const asked = String(typeof text === 'string' ? text : question).trim();
    if (!asked) return;
    const started = Date.now();
    setQuestion(asked);
    setAsking(true);
    setAnswer(null);
    // The player's bootstrap tag is its own business; it does not belong in the answer.
    const finish = (text) => setAnswer(rememberAnswer({ question: asked, answer: String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').replace(/\n[^\n]*(save-result|bootstrap)[^\n]*$/i, '').trim(), seconds: Math.round((Date.now() - started) / 1000), at: Date.now() }));
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const today = new Date().toISOString().slice(0, 10);
      const base = window.location.origin;
      // The player reads Azure DevOps through this plugin's own read-only routes, for whatever
      // period the question implies. Reads only: the routes that change anything are not
      // listed, and it is told never to call them.
      const prompt = [
        `You are answering a question about the Azure DevOps project "${cfg.AzureDevOpsProject || ''}" for the team "${team || cfg.DefaultTeam || ''}". Today is ${today}.${sprint ? ` The current sprint is "${sprint.name}".` : ''}`,
        '',
        'Read the data you need from these READ-ONLY routes on the local Cadence server (plain GET with curl, no token needed, JSON back). Never call PATCH, POST or DELETE on anything.',
        `  ${base}/api/activity?days=N&top=200      work items changed in the last N days (N up to 365): id, title, type, state, assignedTo, changedBy, changedDate, storyPoints`,
        `  ${base}/api/workitems?iteration=PATH     the items in one sprint; ${base}/api/workitems?closedTop=200 for the backlog including closed`,
        `  ${base}/api/iterations                    the sprints, with startDate and finishDate`,
        `  ${base}/api/person?who=NAME&days=N        one person's items in the window`,
        `  ${base}/api/comments?days=N&top=40        comments written on items that changed in the window`,
        `  ${base}/api/workitems/ID                  one item with its comments; ${base}/api/workitems/ID/updates for its field history`,
        '',
        'Pick the window from the question: "last month" is about days=45, "this year" is days=365. Query as many times as you need.',
        '',
        `Question: ${asked}`,
        '',
        'Answer in Markdown from what you read only: a short lead, then bold labels, bullets or a table where they help. Write every work item as #ID (for example #98354) so it can be opened. State the window you used. Say plainly if the data does not cover it.',
        'This is a one-off answer, not a session: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the answer only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', {
        method: 'POST',
        body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'ado-ask', timeout: 240000, prompt }),
      });
      if (result.handledLocally) finish(result.answer || '(no answer)');
      else if (result.id) finish(await waitForTask(api, result.id, 240000));
      else finish(result.error || 'No answer came back.');
    } catch (e) { finish(e.message); } finally { setAsking(false); }
  };

  // ---------------------------------------------------------------- derived

  const sprint = iterations.find((i) => (i.path || i.name) === filters.iteration);
  const done = items.filter((i) => /closed|done|resolved/i.test(i.state));
  const points = items.reduce((sum, i) => sum + (Number(i.storyPoints) || 0), 0);
  const donePoints = done.reduce((sum, i) => sum + (Number(i.storyPoints) || 0), 0);
  const daysLeft = sprint && sprint.finishDate ? Math.ceil((new Date(sprint.finishDate) - Date.now()) / 86400000) : null;
  const isBoard = tab === 'backlog' || tab === 'board';
  const isCi = tab === 'pipelines' || tab === 'releases';
  const pipelines = usePipelines(host, isCi || tab === 'overview');
  const runData = useRun(host, openRun);
  useEffect(() => { try { if (pipelineId) localStorage.setItem('sy.ado.pipeline', pipelineId); } catch {} }, [pipelineId]);
  useEffect(() => {
    if (!isCi || !pipelineId) { setPipelineRuns(null); setPipelineHealth(null); return; }
    setPipelineRuns(null); setPipelineHealth(null);
    api(`/api/pipelines/runs?id=${pipelineId}&top=40`).then((d) => setPipelineRuns(d.runs || [])).catch(() => setPipelineRuns([]));
    api(`/api/pipelines/health?id=${pipelineId}`).then(setPipelineHealth).catch(() => setPipelineHealth(null));
  }, [isCi, pipelineId, pipelines.data]);
  const queuePipeline = async (p, branch) => {
    if (!p || !p.id) return;
    setQueuing(p.id);
    try { const r = await api('/api/pipelines/queue', { method: 'POST', body: JSON.stringify({ id: p.id, branch: branch || undefined }) }); notify(`Queued ${p.name || 'the pipeline'} ${r.run ? r.run.number : ''}`, 'moss'); pipelines.reload(); if (String(p.id) === String(pipelineId)) api(`/api/pipelines/runs?id=${pipelineId}&top=40`).then((d) => setPipelineRuns(d.runs || [])).catch(() => {}); }
    catch (e) { notify(e.message, 'rosin'); } finally { setQueuing(null); }
  };
  const currentPipeline = (pipelines.data || []).find((x) => String(x.id) === String(pipelineId)) || null;
  const q = (filters.q || '').trim().toLowerCase();
  // Which visible items carry children, for the Expand all button in the header.
  const visibleIds = new Set(items.map((i) => i.id));
  const parentIds = [...new Set(items.filter((i) => i.parentId && visibleIds.has(i.parentId)).map((i) => i.parentId))];
  const shown = q ? items.filter((i) => String(i.title).toLowerCase().includes(q) || String(i.id).includes(q) || String(i.tags || '').toLowerCase().includes(q)).length : items.length;
  const current = NAV.find((n) => n.id === tab) || NAV[0];

  // ---------------------------------------------------------------- sidebar

  const go = (id) => { setTab(id); setOpenId(null); setOpenRun(null); };

  const left = h('div', { className: 'sb' },
    h('div', { className: 'sb__head' }, h('span', { className: 'sb__title' }, 'Azure DevOps')),
    // The line under the title is what Mind puts there: the two or three numbers that frame
    // everything below. For a sprint that is how much is done and how long is left.
    h('div', { className: 'mind-stats' },
      loading ? h('span', null, 'loading the sprint...') : h('span', null, `${done.length}/${items.length} items`),
      loading ? null : h('span', null, `${donePoints}/${points} pts`),
      daysLeft === null ? null : h('span', null, daysLeft < 0 ? 'finished' : daysLeft === 0 ? 'ends today' : `${daysLeft}d left`)),

    h('ul', { className: 'sb__list', role: 'list' },
      NAV.map((n) => NavItem(host, {
        key: n.id, icon: icons[n.icon], label: n.label, active: tab === n.id && !openRun, onClick: () => go(n.id), title: n.hint,
        badge: n.id === 'backlog' ? (loading ? undefined : items.length) : n.id === 'people' ? (members.length || undefined) : n.id === 'activity' && feed ? feed.length : n.id === 'pipelines' && pipelines.data ? (pipelines.data.filter((x) => x.latestCompleted && x.latestCompleted.result === 'failed').length || undefined) : undefined,
      }))),

    // The pickers. They live here, where Notes keeps its notebook and search, so they are
    // always in reach and never in the way of the content.
    isCi
      ? h('div', { style: { padding: '0 var(--sy-s3) var(--sy-s3)', display: 'flex', flexDirection: 'column', gap: 'var(--sy-s2)' } },
        Section(host, 'Pipeline'),
        h(ui.Select, { value: pipelineId, onChange: (e) => { setPipelineId(e.target.value); setOpenRun(null); }, 'aria-label': 'Pipeline' },
          h('option', { value: '' }, tab === 'pipelines' ? 'All pipelines' : 'Choose a pipeline'),
          (pipelines.data || []).map((x) => h('option', { key: x.id, value: x.id }, x.name))),
        tab === 'pipelines' ? h(ui.Input, { placeholder: 'Search a pipeline or run', value: filters.q, onChange: (e) => setFilters({ ...filters, q: e.target.value }), 'aria-label': 'Search pipelines' }) : null)
      : isBoard || tab === 'activity'
      ? h('div', { style: { padding: '0 var(--sy-s3) var(--sy-s3)', display: 'flex', flexDirection: 'column', gap: 'var(--sy-s2)' } },
        Section(host, 'Filters'),
        // In Azure DevOps's own order: the board (team) scopes the areas and the iterations.
        isBoard ? h(ui.Select, { value: team, onChange: (e) => switchTeam(e.target.value), 'aria-label': 'Board' },
          teams.map((t) => h('option', { key: t.id || t.name, value: t.name }, t.name))) : null,
        isBoard ? h(ui.Select, { value: filters.area, onChange: (e) => setFilters({ ...filters, area: e.target.value }), 'aria-label': 'Area' },
          h('option', { value: '' }, 'Team default areas'),
          areas.map((a) => h('option', { key: a, value: a }, String(a).split(String.fromCharCode(92)).slice(-2).join(' / ')))) : null,
        isBoard ? h(ui.Select, { value: filters.iteration, onChange: (e) => setFilters({ ...filters, iteration: e.target.value }), 'aria-label': 'Iteration' },
          h('option', { value: '' }, 'All iterations'),
          iterations.map((i) => h('option', { key: i.path || i.name, value: i.path || i.name },
            `${i.name}${i.isCurrent || i.timeFrame === 'current' ? ' (current)' : ''}`))) : null,
        isBoard ? h(ui.Select, { value: filters.type, onChange: (e) => setFilters({ ...filters, type: e.target.value }), 'aria-label': 'Type' },
          h('option', { value: '' }, 'All types'),
          ['Bug', 'Task', 'User Story', 'Feature'].map((t) => h('option', { key: t, value: t }, t))) : null,
        isBoard ? h(ui.Select, { value: filters.state, onChange: (e) => setFilters({ ...filters, state: e.target.value }), 'aria-label': 'State' },
          h('option', { value: '' }, 'All states'),
          COLUMNS.map((t) => h('option', { key: t, value: t }, t))) : null,
        isBoard ? h(ui.Input, { placeholder: 'Search title, id or tag', value: filters.q, onChange: (e) => setFilters({ ...filters, q: e.target.value }), 'aria-label': 'Search work items' }) : null,
        !isBoard ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          WINDOWS.map((d) => h(ui.Chip, { key: d, on: days === d, onClick: () => setDays(d) }, d === 1 ? 'today' : `${d} days`))) : null)
      : null,

    h('div', { className: 'sb__foot' }, current.hint));

  // ---------------------------------------------------------------- header

  const head = h('div', { className: 'mind-view__head' },
    h('div', null,
      h('h1', { className: 'stage-title' }, openId ? `#${openId}` : openRun ? (runData.run ? `${runData.run.definition ? runData.run.definition.name : 'Run'} ${runData.run.number}` : 'Run') : tab === 'pipelines' && currentPipeline ? currentPipeline.name : current.label),
      h('p', { style: { margin: 0, color: 'var(--sy-text-3)', fontSize: 'var(--sy-fs-sm)' } },
        openId ? 'One work item, with its history.'
          : openRun ? (runData.run ? `${runData.run.branch || ''} - ${runData.run.result}` : 'reading the run...')
          : tab === 'pipelines' && currentPipeline ? `${currentPipeline.folder ? `${currentPipeline.folder.replace(/^\\/, '')} - ` : ''}runs and health.`
          : isBoard && sprint ? sprint.name
            : current.hint)),
    h('div', { className: 'mind-view__actions' },
      isBoard && !openId && !loading ? h('span', { className: 'mpanel__meta' }, `${shown} shown${moreClosed ? ' - 200 most recent closed' : ''}`) : null,
      openId ? h(ui.Button, { onClick: () => setOpenId(null) }, 'Back to the list') : null,
      openRun ? h(ui.Button, { onClick: () => setOpenRun(null) }, pipelineId ? 'Back to the pipeline' : 'Back to the pipelines') : null,
      tab === 'pipelines' && !openRun && pipelineId ? h(ui.Button, { onClick: () => setPipelineId('') }, 'All pipelines') : null,
      isCi && !openRun ? h(ui.Button, { onClick: () => pipelines.reload() }, 'Refresh') : null,
      tab === 'backlog' && !openId && parentIds.length
        ? h(ui.Button, { onClick: () => setExpanded(expanded.size ? new Set() : new Set(parentIds)) }, expanded.size ? 'Collapse all' : 'Expand all')
        : null,
      isBoard && !openId ? h(ui.Button, { onClick: refresh }, 'Refresh') : null));

  // ---------------------------------------------------------------- main + right

  // The surface pads its sides; this adds the top and bottom the Mind stage uses so the two
  // screens sit the same distance from the titlebar.
  const main = h('div', { className: 'ado-main', style: { padding: '32px 16px 48px' } },
    head,
    openId
      ? h(WorkItem, { host, id: openId, members, setState, startWorking, onClose: () => setOpenId(null) })
      : openRun
        ? h(RunPage, { host, data: runData, onChanged: () => runData.reload(), onQueue: queuePipeline, busy: queuing, onOpenItem: (id) => { setOpenRun(null); setOpenId(id); } })
      : tab === 'pipelines'
        ? (pipelineId && currentPipeline
          ? h(PipelinePage, { host, pipeline: currentPipeline, runs: pipelineRuns, health: pipelineHealth, q, onOpenRun: setOpenRun, onQueue: queuePipeline, busy: queuing === currentPipeline.id, onNotes: () => { setNotesFor(pipelineRuns && pipelineRuns.find((r) => r.result === 'succeeded') ? pipelineRuns.find((r) => r.result === 'succeeded').id : null); setTab('releases'); } })
          : h(Pipelines, { host, pipelines, q, onOpenRun: setOpenRun, onOpenPipeline: (id) => setPipelineId(String(id)), onQueue: queuePipeline, busy: queuing }))
      : tab === 'releases'
        ? h(Releases, { host, pipelines, pipelineId, setPipelineId, runs: pipelineRuns, onOpenRun: setOpenRun, onOpenItem: setOpenId, initialTo: notesFor })
      : isBoard
        ? h(Board, { host, columns: COLUMNS, items, loading, error, filters, setFilters, onOpen: setOpenId, onMoved: applyState, selectedId: openId, layout: tab, expanded, setExpanded })
        : tab === 'overview'
          ? h(Overview, { host, items, loading, sprint, daysLeft, members, feed, pipelines, onOpen: setOpenId, onAction: go, onPerson: (n) => { setPerson(n); go('people'); } })
        : tab === 'activity'
          ? h('div', null,
            h(Insights, { host, feed, comments, items, sprint, days }),
            h(Activity, { host, feed, error: feedError, onOpen: setOpenId }))
          : tab === 'ask'
            ? h(Ask, { host, api, question, setQuestion, ask, asking, answer, setAnswer, items, sprint, onOpen: setOpenId })
            : h(People, { host, selected: person, onOpen: setOpenId, items, members, onPick: (n) => { setPerson(n); setOpenId(null); } }));

  const right = openId ? null
    : openRun ? h(RunAside, { host, data: runData, onOpenItem: (id) => { setOpenRun(null); setOpenId(id); } })
    : tab === 'pipelines' ? h(PipelinesAside, { host, pipelines, onOpenRun: setOpenRun, onOpenPipeline: (id) => setPipelineId(String(id)) })
    : tab === 'releases' ? h(ReleasesAside, { host, pipelines, pipelineId, runs: pipelineRuns, onOpenRun: setOpenRun })
    : isBoard ? (loading ? Panel(host, { title: 'This sprint' }, h(ui.Skeleton, { count: 5, height: 18 })) : h(SprintAside, { host, items, sprint, daysLeft }))
      : tab === 'people' ? h(Roster, { host, members, selected: person, onSelect: (n) => { setPerson(n); setOpenId(null); } })
        : tab === 'activity' ? h(Comments, { host, comments, error: commentsError, onOpen: setOpenId })
        : tab === 'overview' ? h(OverviewAside, { host, items, sprint, daysLeft, feed, onOpen: setOpenId })
          : null;

  return h(ui.Regions, { left, right, paneId: `ado-${tab}`, paneLabel: openRun ? 'This run' : tab === 'overview' ? 'Attention' : tab === 'people' ? 'Team' : tab === 'activity' ? 'Comments' : tab === 'pipelines' ? 'Latest runs' : tab === 'releases' ? 'Successful runs' : 'This sprint' }, main);
}


/* ------------------------------------------------------------------ sprint pane */

function SprintAside({ host, items, sprint, daysLeft }) {
  const { h } = host;
  const done = items.filter((i) => /closed|done|resolved/i.test(i.state));
  const points = items.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  const donePoints = done.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  const pct = points ? Math.round((donePoints / points) * 100) : 0;
  const span = sprint && sprint.startDate && sprint.finishDate ? new Date(sprint.finishDate) - new Date(sprint.startDate) : 0;
  const elapsed = span > 0 ? Math.max(0, Math.min(1, (Date.now() - new Date(sprint.startDate)) / span)) : 0;
  // "Behind" is a real claim, so it needs room to be wrong.
  const behind = elapsed > 0 && (pct / 100) < elapsed - 0.15;

  const byState = {};
  const byPerson = {};
  for (const i of items) {
    byState[i.state] = (byState[i.state] || 0) + 1;
    if (!/closed|done|resolved|removed/i.test(i.state)) {
      const who = i.assignedTo || 'unassigned';
      byPerson[who] = (byPerson[who] || 0) + 1;
    }
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: sprint ? sprint.name : 'All iterations', action: daysLeft === null ? null : h('span', { className: 'mpanel__meta', style: { whiteSpace: 'nowrap' } }, daysLeft < 0 ? 'finished' : daysLeft === 0 ? 'ends today' : `${daysLeft} days left`) },
      h('div', { className: 'mhealth', style: { marginBottom: 'var(--sy-s3)' } },
        sprint ? Health(host, { label: 'Done', value: `${pct}%`, tone: behind ? 'rosin' : 'moss', hint: behind ? 'behind the clock' : 'on pace' }) : null,
        sprint ? Health(host, { label: 'Elapsed', value: `${Math.round(elapsed * 100)}%` }) : null,
        Health(host, { label: 'Items', value: `${done.length}/${items.length}` }),
        Health(host, { label: 'Points', value: `${donePoints}/${points}` })),
      Bars(host, { rows: ['New', 'Active', 'Resolved', 'Closed'].map((s) => ({ label: s, value: byState[s] || 0 })), max: items.length || 1 })),

    Panel(host, { title: 'Open, by person', action: h('span', { className: 'mpanel__meta' }, `${Object.keys(byPerson).length}`) },
      Bars(host, { rows: Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value })) })));
}

/* ------------------------------------------------------------------ roster */

function Roster({ host, members, selected, onSelect }) {
  const { h, ui, react } = host;
  const { useState } = react;
  const [q, setQ] = useState('');
  const shown = members.filter((m) => {
    const name = m.displayName || m.name || String(m);
    return !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase());
  });
  // The panel takes the column's height; the search stays put and only the names scroll.
  return Panel(host, {
    title: 'Team',
    action: h('span', { className: 'mpanel__meta' }, q.trim() ? `${shown.length} of ${members.length}` : `${members.length}`),
    style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
    bodyStyle: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sy-s2)' },
  },
    h(ui.Input, { placeholder: 'Find someone', value: q, onChange: (e) => setQ(e.target.value), 'aria-label': 'Find a team member' }),
    h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
      shown.length
        ? List(host, shown.map((m) => {
          const name = m.displayName || m.name || String(m);
          return ListRow(host, {
            key: name, label: name, sub: m.uniqueName || m.email || '',
            meta: selected === name ? 'shown' : null,
            onClick: () => onSelect(name),
          });
        }))
        : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody by that name.')));
}

AzureDevOps.cadenceComponent = true;
export default AzureDevOps;
