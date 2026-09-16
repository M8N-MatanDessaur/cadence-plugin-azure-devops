// Azure DevOps plugin -- owns every /api/workitems/*, /api/iterations,
// /api/teams, /api/areas, /api/velocity, /api/burndown, /api/team-members,
// /api/start-working route.
//
// Registers at absolute paths via the new ctx.addAbsoluteRoute SDK so the
// URL contracts the core frontend and AI already use keep working after
// extraction. When the plugin is uninstalled / unconfigured the routes
// 404 naturally (no handler registered).


// ---- Attention: what the Plugins home shows on this app's tile. Reads the plugin's own
// routes over loopback (they carry their caches), never writes, answers within a minute.
const __attention = { value: null, until: 0 };
function __selfGet(req, path, timeoutMs) {
  return new Promise((resolve) => {
    const host = req.headers.host || `127.0.0.1:${process.env.CADENCE_PORT || 3801}`;
    const lib = require('http');
    const r = lib.get({ host: host.split(':')[0], port: Number(host.split(':')[1] || 80), path, headers: { 'x-cadence-internal': '1' } }, (resp) => { let d = ''; resp.on('data', (c) => { d += c; }); resp.on('end', () => { try { resolve(resp.statusCode < 400 ? JSON.parse(d) : null); } catch (_) { resolve(null); } }); });
    r.on('error', () => resolve(null));
    r.setTimeout(timeoutMs || 45000, () => { r.destroy(); resolve(null); });
  });
}
function __attentionOut(items) {
  const rank = { error: 3, warn: 2, warning: 2, info: 1 };
  const list = (items || []).filter((i) => i && i.text).map((i) => ({ level: i.level === 'warning' ? 'warn' : (i.level || 'info'), text: String(i.text) }));
  const level = list.reduce((top, i) => (rank[i.level] > rank[top] ? i.level : top), list.length ? 'info' : 'ok');
  return { count: list.length, level, items: list, readAt: new Date().toISOString() };
}
async function __attentionHandler(req, res, url, compute) {
  if (__attention.value && __attention.until > Date.now() && url.searchParams.get('refresh') !== '1') return __json(res, __attention.value);
  let out;
  try { out = __attentionOut(await compute(req)); } catch (e) { out = { count: 0, level: 'ok', items: [], error: e.message, readAt: new Date().toISOString() }; }
  __attention.value = out; __attention.until = Date.now() + 60000;
  return __json(res, out);
}
function __json(res, data) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }

module.exports = function register(ctx) {
  ctx.addRoute('GET', '/search', (req, res, url) => handleSearch(req, res, url));
  ctx.addRoute('GET', '/attention', (req, res, url) => __attentionHandler(req, res, url, async (req) => { const out = []; const its = await __selfGet(req, '/api/iterations', 60000); const list = Array.isArray(its) ? its : (its && its.iterations) || []; const now = list.find((i) => i.isCurrent || i.timeFrame === 'current'); if (now) { const w = await __selfGet(req, `/api/workitems?iteration=${encodeURIComponent(now.path || now.name)}`, 60000); const items = Array.isArray(w) ? w : (w && w.items) || []; const open = items.filter((i) => !/closed|done|resolved|removed/i.test(i.state || '')); const un = open.filter((i) => !i.assignedTo).length; const bugs = open.filter((i) => /bug/i.test(i.type || '')).length; if (un) out.push({ level: 'warn', text: `${un} open item${un === 1 ? ' has' : 's have'} nobody assigned in ${now.name}.` }); if (bugs > 5) out.push({ level: 'warn', text: `${bugs} open bugs in ${now.name}.` }); } const p = await __selfGet(req, '/api/pipelines', 60000); const failed = (Array.isArray(p) ? p : (p && p.pipelines) || []).filter((x) => x.latestCompleted && x.latestCompleted.result === 'failed'); for (const f of failed) out.push({ level: 'error', text: `Pipeline ${f.name} failed on its last run.` }); return out; }));
  const { shell } = ctx;
  const {
    https, fs,
    gitExec, sanitizeText, permGate,
    getRepoPath, spawnSync, SWRCache, broadcast,
  } = shell;

  const json = (res, data, status) => {
    res.writeHead(status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // --- ADO HTTP helpers ----------------------------------------------------

  function adoRequest(method, apiPath, body, contentType, _skipTeam) {
    return new Promise((resolve, reject) => {
      const cfg = ctx.getConfig();
      const org = cfg.AzureDevOpsOrg;
      const project = cfg.AzureDevOpsProject;
      const pat = cfg.AzureDevOpsPAT;
      const team = cfg.DefaultTeam;
      if (!org || !project || !pat) {
        return reject(new Error('Azure DevOps not configured. Set Org, Project, and PAT in Settings > Plugins > Azure DevOps.'));
      }
      const useTeam = !_skipTeam && team && apiPath.startsWith('/work/');
      const teamSegment = useTeam ? `/${encodeURIComponent(team)}` : '';
      const url = new URL(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}${teamSegment}/_apis${apiPath}`);
      const payload = body ? JSON.stringify(body) : null;
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': 'Basic ' + Buffer.from(':' + pat).toString('base64'),
          'Content-Type': contentType || 'application/json',
          'Accept': 'application/json',
        },
      };
      if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => { data += c; });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (_) { resolve(data); }
          } else if (resp.statusCode === 404 && useTeam && !_skipTeam) {
            adoRequest(method, apiPath, body, contentType, true).then(resolve, reject);
          } else {
            const msg = resp.statusCode === 401
              ? 'Authentication failed -- PAT may be expired or invalid'
              : `Azure DevOps API error (${resp.statusCode}): ${data.slice(0, 200)}`;
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  function adoOrgRequest(method, apiPath) {
    return new Promise((resolve, reject) => {
      const cfg = ctx.getConfig();
      const org = cfg.AzureDevOpsOrg;
      const pat = cfg.AzureDevOpsPAT;
      if (!org || !pat) return reject(new Error('Azure DevOps not configured.'));
      const url = new URL(`https://dev.azure.com/${encodeURIComponent(org)}/_apis${apiPath}`);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': 'Basic ' + Buffer.from(':' + pat).toString('base64'),
          'Accept': 'application/json',
        },
      };
      const req = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => { data += c; });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (_) { resolve(data); }
          } else {
            reject(new Error(`ADO org API error (${resp.statusCode})`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  // Full ADO REST URL of a work item, used as the target of a Hierarchy relation.
  function parentWorkItemUrl(parentId) {
    const cfg = ctx.getConfig();
    return `https://dev.azure.com/${encodeURIComponent(cfg.AzureDevOpsOrg)}/_apis/wit/workItems/${parseInt(parentId, 10)}`;
  }

  // Set (or re-parent) a work item's parent. A work item can have only one
  // parent, so any existing Hierarchy-Reverse relation is removed first.
  // Removing in reverse index order keeps the remaining indices valid.
  async function setWorkItemParent(id, parentId) {
    const wi = await adoRequest('GET', `/wit/workitems/${id}?$expand=relations&api-version=7.1`);
    const rels = wi.relations || [];
    const patch = [];
    for (let i = rels.length - 1; i >= 0; i--) {
      if (rels[i].rel === 'System.LinkTypes.Hierarchy-Reverse') {
        patch.push({ op: 'remove', path: `/relations/${i}` });
      }
    }
    patch.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentWorkItemUrl(parentId) } });
    return adoRequest('PATCH', `/wit/workitems/${id}?api-version=7.1`, patch, 'application/json-patch+json');
  }

  function proxyHtmlImages(html) {
    if (!html) return html;
    return html.replace(/<img([^>]+)src=["']([^"']+)["']/gi, (match, before, url) => {
      if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) {
        return `<img${before}src="/api/image-proxy?url=${encodeURIComponent(url)}"`;
      }
      return match;
    });
  }

  // --- SWR caches ----------------------------------------------------------

  const swrIterations = SWRCache ? new SWRCache({ staleTTL: 60000, maxAge: 300000, onRevalidate: (key, data) => broadcast && broadcast({ type: 'cache-updated', cache: 'iterations', data }) }) : null;
  const swrWorkItems  = SWRCache ? new SWRCache({ staleTTL: 15000, maxAge: 60000,  onRevalidate: (key, data) => broadcast && broadcast({ type: 'cache-updated', cache: 'workitems', key, data }) }) : null;
  const swrTeamAreas  = SWRCache ? new SWRCache({ staleTTL: 300000, maxAge: 600000 }) : null;
  const swrAreas      = SWRCache ? new SWRCache({ staleTTL: 300000, maxAge: 600000 }) : null;

  async function getTeamAreaPaths() {
    const cfg = ctx.getConfig();
    const team = cfg.DefaultTeam;
    if (!team) return null;
    try {
      const fetcher = async () => {
        const data = await adoRequest('GET', `/work/teamsettings/teamfieldvalues?api-version=7.1`);
        return (data.values || []).map(v => v.value).filter(Boolean);
      };
      return swrTeamAreas ? await swrTeamAreas.get('teamAreas:' + team, fetcher) : await fetcher();
    } catch (_) { return null; }
  }

  // --- Handlers ------------------------------------------------------------

  async function fetchIterations() {
    const data = await adoRequest('GET', '/work/teamsettings/iterations?api-version=7.1');
    const now = new Date();
    const iterations = (data.value || []).map(it => {
      const startDate = it.attributes && it.attributes.startDate ? new Date(it.attributes.startDate) : null;
      const finishDate = it.attributes && it.attributes.finishDate ? new Date(it.attributes.finishDate) : null;
      const isCurrent = startDate && finishDate && now >= startDate && now <= finishDate;
      return {
        id: it.id, name: it.name, path: it.path,
        startDate: (it.attributes && it.attributes.startDate) || null,
        finishDate: (it.attributes && it.attributes.finishDate) || null,
        timeFrame: (it.attributes && it.attributes.timeFrame) || null,
        isCurrent,
      };
    });
    iterations.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      const da = a.startDate ? new Date(a.startDate) : new Date(0);
      const db = b.startDate ? new Date(b.startDate) : new Date(0);
      return db - da;
    });
    return iterations;
  }

  async function handleIterations(req, res, url) {
    try {
      const forceRefresh = url && url.searchParams.get('refresh') === '1';
      const iterations = swrIterations
        ? await swrIterations.get('iterations', fetchIterations, { forceRefresh })
        : await fetchIterations();
      json(res, iterations);
    } catch (e) {
      json(res, { error: e.message }, e.message.includes('not configured') ? 400 : 502);
    }
  }

  async function fetchWorkItemsData(iterationPath, state, type, assignedTo, areaPath, closedTop, fetchClosedSeparately, noClosedFilter) {
    let areaClause = '';
    if (areaPath) {
      areaClause = ` AND [System.AreaPath] UNDER '${areaPath}'`;
    } else {
      const teamAreas = await getTeamAreaPaths();
      if (teamAreas && teamAreas.length > 0) {
        const areaConditions = teamAreas.map(a => `[System.AreaPath] UNDER '${a}'`).join(' OR ');
        areaClause = ` AND (${areaConditions})`;
      }
    }
    let wiqlQuery = `SELECT [System.Id] FROM WorkItems WHERE [System.State] NOT IN ('Removed')`;
    if (noClosedFilter) wiqlQuery += ` AND [System.State] NOT IN ('Closed', 'Done')`;
    wiqlQuery += areaClause;
    if (iterationPath) wiqlQuery += ` AND [System.IterationPath] = '${iterationPath}'`;
    if (state)         wiqlQuery += ` AND [System.State] = '${state}'`;
    if (type)          wiqlQuery += ` AND [System.WorkItemType] = '${type}'`;
    if (assignedTo)    wiqlQuery += ` AND [System.AssignedTo] = '${assignedTo}'`;
    wiqlQuery += ` ORDER BY [System.ChangedDate] DESC`;

    const mainPromise = adoRequest('POST', '/wit/wiql?$top=200&api-version=7.1', { query: wiqlQuery });
    let closedPromise = null;
    if (fetchClosedSeparately) {
      let closedQuery = `SELECT [System.Id] FROM WorkItems WHERE [System.State] IN ('Closed', 'Done') AND [System.State] NOT IN ('Removed')`;
      closedQuery += areaClause;
      if (type)       closedQuery += ` AND [System.WorkItemType] = '${type}'`;
      if (assignedTo) closedQuery += ` AND [System.AssignedTo] = '${assignedTo}'`;
      closedQuery += ` ORDER BY [System.ChangedDate] DESC`;
      const closedCap = Math.max(closedTop, 200) + 1;
      closedPromise = adoRequest('POST', `/wit/wiql?$top=${closedCap}&api-version=7.1`, { query: closedQuery });
    }
    const [wiql, closedWiql] = await Promise.all([mainPromise, closedPromise]);
    const mainIds = (wiql.workItems || []).map(w => w.id).slice(0, 200);
    let closedIds = [];
    let hasMoreClosed = false;
    let totalClosed = 0;
    let totalClosedCapped = false;
    if (closedWiql) {
      const returnedClosedIds = (closedWiql.workItems || []).map(w => w.id);
      const closedCap = Math.max(closedTop, 200);
      totalClosedCapped = returnedClosedIds.length > closedCap;
      hasMoreClosed = returnedClosedIds.length > closedTop;
      closedIds = returnedClosedIds.slice(0, closedTop);
      totalClosed = totalClosedCapped ? closedCap : returnedClosedIds.length;
    }
    const allIds = [...new Set([...mainIds, ...closedIds])];
    if (allIds.length === 0) {
      return fetchClosedSeparately ? { items: [], hasMoreClosed: false, totalClosed: 0, totalClosedCapped: false } : [];
    }
    const batches = [];
    for (let i = 0; i < allIds.length; i += 200) batches.push(allIds.slice(i, i + 200));
    const detailResults = await Promise.all(batches.map(batch =>
      adoRequest('GET',
        `/wit/workitems?ids=${batch.join(',')}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,System.Tags,System.CreatedDate,System.ChangedDate,Microsoft.VSTS.Common.Priority,System.IterationPath,Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.Effort,System.Parent&api-version=7.1`
      )
    ));
    const items = detailResults.flatMap(d => (d.value || []).map(wi => {
      const f = wi.fields;
      return {
        id: wi.id,
        title: f['System.Title'],
        state: f['System.State'],
        type: f['System.WorkItemType'],
        assignedTo: f['System.AssignedTo'] ? f['System.AssignedTo'].displayName : '',
        tags: f['System.Tags'] || '',
        changedDate: f['System.ChangedDate'],
        priority: f['Microsoft.VSTS.Common.Priority'] || 0,
        iterationPath: f['System.IterationPath'] || '',
        storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || f['Microsoft.VSTS.Scheduling.Effort'] || '',
        createdDate: f['System.CreatedDate'] || '',
        parentId: f['System.Parent'] || null,
      };
    }));
    return fetchClosedSeparately ? { items, hasMoreClosed, totalClosed, totalClosedCapped } : items;
  }

  async function handleWorkItems(req, res, url) {
    try {
      const refresh = url.searchParams.get('refresh') === '1';
      const iterationPath = url.searchParams.get('iteration') || '';
      const state = url.searchParams.get('state') || '';
      const type = url.searchParams.get('type') || '';
      const assignedTo = url.searchParams.get('assignedTo') || '';
      const areaPath = url.searchParams.get('area') || '';
      const closedTopParam = url.searchParams.get('closedTop');
      const closedTop = Math.min(parseInt(closedTopParam || '10', 10) || 10, 200);
      const noClosedFilter = !iterationPath && !state;
      const fetchClosedSeparately = noClosedFilter && closedTopParam !== null;
      const cacheKey = `${iterationPath}|${state}|${type}|${assignedTo}|${areaPath}|ct${closedTopParam !== null ? closedTop : '-'}`;
      const fetcher = () => fetchWorkItemsData(iterationPath, state, type, assignedTo, areaPath, closedTop, fetchClosedSeparately, noClosedFilter);
      const result = swrWorkItems
        ? await swrWorkItems.get('wi:' + cacheKey, fetcher, { forceRefresh: refresh })
        : await fetcher();
      json(res, result);
    } catch (e) {
      json(res, { error: e.message }, e.message.includes('not configured') ? 400 : 502);
    }
  }

  async function handleWorkItemDetail(req, res, id) {
    try {
      const cfg = ctx.getConfig();
      const org = cfg.AzureDevOpsOrg;
      const project = cfg.AzureDevOpsProject;
      const [wi, commentsData] = await Promise.all([
        adoRequest('GET', `/wit/workitems/${id}?$expand=all&api-version=7.1`),
        adoRequest('GET', `/wit/workitems/${id}/comments?api-version=7.1-preview.4`).catch(() => ({ comments: [] })),
      ]);
      const f = wi.fields;
      const attachments = [];
      const linkedItems = [];
      (wi.relations || []).forEach(rel => {
        if (rel.rel === 'AttachedFile') {
          attachments.push({ name: (rel.attributes && rel.attributes.name) || 'attachment', url: rel.url, comment: (rel.attributes && rel.attributes.comment) || '' });
        } else {
          const idMatch = rel.url && rel.url.match(/workItems\/(\d+)/i);
          linkedItems.push({ rel: rel.rel, title: (rel.attributes && rel.attributes.name) || '', comment: (rel.attributes && rel.attributes.comment) || '', id: idMatch ? parseInt(idMatch[1]) : null, url: rel.url });
        }
      });
      const comments = (commentsData.comments || []).map(c => ({
        id: c.id, text: proxyHtmlImages(c.text || ''),
        author: c.createdBy ? c.createdBy.displayName : '',
        date: c.createdDate || '',
      }));
      json(res, {
        id: wi.id, title: f['System.Title'], state: f['System.State'],
        type: f['System.WorkItemType'],
        assignedTo: f['System.AssignedTo'] ? f['System.AssignedTo'].displayName : '',
        createdBy: f['System.CreatedBy'] ? f['System.CreatedBy'].displayName : '',
        tags: f['System.Tags'] || '',
        createdDate: f['System.CreatedDate'] || '',
        changedDate: f['System.ChangedDate'],
        priority: f['Microsoft.VSTS.Common.Priority'] || 0,
        severity: f['Microsoft.VSTS.Common.Severity'] || '',
        storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || '',
        effort: f['Microsoft.VSTS.Scheduling.Effort'] || '',
        reason: f['System.Reason'] || '',
        description: proxyHtmlImages(f['System.Description'] || ''),
        acceptanceCriteria: proxyHtmlImages(f['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
        reproSteps: proxyHtmlImages(f['Microsoft.VSTS.TCM.ReproSteps'] || ''),
        areaPath: f['System.AreaPath'] || '',
        iterationPath: f['System.IterationPath'] || '',
        attachments, linkedItems, comments,
        webUrl: org && project ? `https://dev.azure.com/${org}/${project}/_workitems/edit/${wi.id}` : '',
      });
    } catch (e) {
      json(res, { error: e.message }, e.message.includes('not configured') ? 400 : 502);
    }
  }

  async function handleUpdateWorkItem(req, res, id) {
    try {
      if (permGate && !(await permGate(res, 'api', `PATCH /api/workitems/${id}`, `Update work item #${id}`))) return;
      const body = await ctx.readBody(req);
      const patchDoc = [];
      const fieldMap = {
        title: '/fields/System.Title',
        description: '/fields/System.Description',
        state: '/fields/System.State',
        assignedTo: '/fields/System.AssignedTo',
        priority: '/fields/Microsoft.VSTS.Common.Priority',
        tags: '/fields/System.Tags',
        iterationPath: '/fields/System.IterationPath',
        areaPath: '/fields/System.AreaPath',
        storyPoints: '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
        acceptanceCriteria: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
      };
      const textFields = ['title', 'description', 'tags', 'acceptanceCriteria'];
      for (const [key, path] of Object.entries(fieldMap)) {
        if (body[key] !== undefined) {
          const val = textFields.includes(key) ? sanitizeText(body[key]) : body[key];
          patchDoc.push({ op: 'replace', path, value: val });
        }
      }
      const hasParent = body.parent !== undefined && body.parent !== null && body.parent !== '';
      if (patchDoc.length === 0 && !hasParent) return json(res, { error: 'No fields to update' }, 400);
      let result;
      if (patchDoc.length > 0) {
        result = await adoRequest('PATCH', `/wit/workitems/${id}?api-version=7.1`, patchDoc, 'application/json-patch+json');
      }
      // Parent linking goes through setWorkItemParent so an existing parent is
      // replaced rather than rejected (a work item can have only one parent).
      if (hasParent) result = await setWorkItemParent(id, body.parent);
      if (swrWorkItems) swrWorkItems.invalidate('wi:');
      if (broadcast) broadcast({ type: 'ui-action', action: 'refresh-workitems' });
      json(res, { ok: true, id: (result && result.id) || parseInt(id, 10) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleSetParent(req, res, id) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'set work item parent')) return;
      if (permGate && !(await permGate(res, 'api', `POST /api/workitems/${id}/parent`, `Set parent of work item #${id}`))) return;
      const { parent } = await ctx.readBody(req);
      if (parent === undefined || parent === null || parent === '') return json(res, { error: 'parent (work item id) is required' }, 400);
      const result = await setWorkItemParent(id, parent);
      if (swrWorkItems) swrWorkItems.invalidate('wi:');
      if (broadcast) broadcast({ type: 'ui-action', action: 'refresh-workitems' });
      json(res, { ok: true, id: result.id, parent: parseInt(parent, 10) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleWorkItemState(req, res, id) {
    try {
      if (permGate && !(await permGate(res, 'api', `PATCH /api/workitems/${id}/state`, `Change state of work item #${id}`))) return;
      const { state } = await ctx.readBody(req);
      if (!state) return json(res, { error: 'state is required' }, 400);
      const result = await adoRequest('PATCH', `/wit/workitems/${id}?api-version=7.1`,
        [{ op: 'replace', path: '/fields/System.State', value: state }],
        'application/json-patch+json');
      if (swrWorkItems) swrWorkItems.invalidate('wi:');
      if (broadcast) broadcast({ type: 'ui-action', action: 'refresh-workitems' });
      json(res, { ok: true, id: result.id, state: result.fields['System.State'] });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleAddWorkItemComment(req, res, id) {
    try {
      if (permGate && !(await permGate(res, 'api', `POST /api/workitems/${id}/comments`, `Comment on work item #${id}`))) return;
      const { text, mentions } = await ctx.readBody(req);
      if (!text) return json(res, { error: 'text is required' }, 400);
      // A mention is only a mention to Azure DevOps as an identity anchor; "@Name" alone is
      // text. With people named, the comment goes as HTML with each "@Name" wrapped.
      const people = Array.isArray(mentions) ? mentions.filter((m) => m && m.id && m.name) : [];
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let payload = sanitizeText(text);
      if (people.length) {
        payload = esc(payload).replace(/\r?\n/g, '<br>');
        for (const m of people) {
          const name = esc(m.name);
          const safeId = String(m.id).replace(/[^0-9a-fA-F-]/g, '');
          payload = payload.split(`@${name}`).join(`<a href="#" data-vss-mention="version:2.0,${safeId}">@${name}</a>`);
        }
      }
      const result = await adoRequest('POST',
        `/wit/workitems/${id}/comments?api-version=7.1-preview.4`,
        { text: payload });
      json(res, { ok: true, id: result.id, text: result.text, author: (result.createdBy && result.createdBy.displayName) || '', date: result.createdDate || '' });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleCreateWorkItem(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/workitems/create', 'Create work item'))) return;
      const { type, title, description, priority, tags, assignedTo, iterationPath, areaPath, storyPoints, acceptanceCriteria, parent } = await ctx.readBody(req);
      if (!type || !title) return json(res, { error: 'type and title are required' }, 400);
      const patchDoc = [{ op: 'add', path: '/fields/System.Title', value: sanitizeText(title) }];
      if (description)       patchDoc.push({ op: 'add', path: '/fields/System.Description', value: sanitizeText(description) });
      if (priority)          patchDoc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: parseInt(priority, 10) || 2 });
      if (tags)              patchDoc.push({ op: 'add', path: '/fields/System.Tags', value: sanitizeText(tags) });
      if (assignedTo)        patchDoc.push({ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo });
      if (iterationPath)     patchDoc.push({ op: 'add', path: '/fields/System.IterationPath', value: iterationPath });
      if (areaPath)          patchDoc.push({ op: 'add', path: '/fields/System.AreaPath', value: areaPath });
      if (storyPoints)       patchDoc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: parseFloat(storyPoints) });
      if (acceptanceCriteria) patchDoc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: sanitizeText(acceptanceCriteria) });
      if (parent)            patchDoc.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentWorkItemUrl(parent) } });
      const wiType = encodeURIComponent(type);
      const result = await adoRequest('POST', `/wit/workitems/$${wiType}?api-version=7.1`, patchDoc, 'application/json-patch+json');
      if (broadcast) broadcast({ type: 'ui-action', action: 'refresh-workitems' });
      const cfg = ctx.getConfig();
      json(res, {
        ok: true, id: result.id, title: result.fields['System.Title'],
        url: cfg.AzureDevOpsOrg && cfg.AzureDevOpsProject
          ? `https://dev.azure.com/${cfg.AzureDevOpsOrg}/${cfg.AzureDevOpsProject}/_workitems/edit/${result.id}`
          : null,
      });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleVelocity(req, res) {
    try {
      const iterData = await adoRequest('GET', '/work/teamsettings/iterations?api-version=7.1');
      const now = new Date();
      const pastIterations = (iterData.value || [])
        .filter(it => {
          const finish = it.attributes && it.attributes.finishDate ? new Date(it.attributes.finishDate) : null;
          return finish && finish < now;
        })
        .sort((a, b) => new Date(a.attributes.startDate) - new Date(b.attributes.startDate))
        .slice(-10);
      const velocity = [];
      for (const it of pastIterations) {
        const wiql = await adoRequest('POST', '/wit/wiql?$top=200&api-version=7.1', {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '${it.path}' AND [System.State] IN ('Closed', 'Resolved', 'Done') ORDER BY [System.Id]`,
        });
        const ids = (wiql.workItems || []).map(w => w.id).slice(0, 200);
        let totalPoints = 0;
        let completedCount = 0;
        if (ids.length > 0) {
          const details = await adoRequest('GET',
            `/wit/workitems?ids=${ids.join(',')}&fields=Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.Effort&api-version=7.1`);
          for (const wi of (details.value || [])) {
            const pts = wi.fields['Microsoft.VSTS.Scheduling.StoryPoints'] || wi.fields['Microsoft.VSTS.Scheduling.Effort'] || 0;
            totalPoints += pts;
            completedCount++;
          }
        }
        velocity.push({
          iteration: it.name, path: it.path,
          startDate: it.attributes && it.attributes.startDate,
          finishDate: it.attributes && it.attributes.finishDate,
          completedPoints: totalPoints, completedCount,
        });
      }
      const avg = velocity.length > 0
        ? velocity.reduce((sum, v) => sum + v.completedPoints, 0) / velocity.length
        : 0;
      json(res, { velocity, averageVelocity: Math.round(avg * 10) / 10 });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleBurndown(req, res, url) {
    try {
      const iterationPath = url.searchParams.get('iteration') || '';
      if (!iterationPath) return json(res, { error: 'iteration parameter required' }, 400);
      const iterData = await adoRequest('GET', '/work/teamsettings/iterations?api-version=7.1');
      const iteration = (iterData.value || []).find(it => it.path === iterationPath);
      if (!iteration) return json(res, { error: 'Iteration not found' }, 404);
      const wiql = await adoRequest('POST', '/wit/wiql?$top=200&api-version=7.1', {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '${iterationPath}' AND [System.State] NOT IN ('Removed') ORDER BY [System.Id]`,
      });
      const ids = (wiql.workItems || []).map(w => w.id).slice(0, 200);
      let totalPoints = 0, completedPoints = 0, items = [];
      if (ids.length > 0) {
        const details = await adoRequest('GET',
          `/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State,Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.Effort,System.ChangedDate&api-version=7.1`);
        items = (details.value || []).map(wi => {
          const pts = wi.fields['Microsoft.VSTS.Scheduling.StoryPoints'] || wi.fields['Microsoft.VSTS.Scheduling.Effort'] || 0;
          const state = wi.fields['System.State'];
          const isDone = ['Closed', 'Resolved', 'Done'].includes(state);
          totalPoints += pts;
          if (isDone) completedPoints += pts;
          return { id: wi.id, title: wi.fields['System.Title'], state, points: pts, isDone, changedDate: wi.fields['System.ChangedDate'] };
        });
      }
      json(res, {
        iteration: iteration.name,
        startDate: iteration.attributes && iteration.attributes.startDate,
        finishDate: iteration.attributes && iteration.attributes.finishDate,
        totalPoints, completedPoints,
        remainingPoints: totalPoints - completedPoints,
        totalItems: items.length,
        completedItems: items.filter(i => i.isDone).length,
        items,
      });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleTeams(req, res) {
    try {
      const cfg = ctx.getConfig();
      const project = cfg.AzureDevOpsProject;
      const data = await adoOrgRequest('GET', `/projects/${encodeURIComponent(project)}/teams?api-version=7.1`);
      const teams = (data.value || []).map(t => ({ id: t.id, name: t.name, description: t.description || '' }));
      json(res, teams);
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleAreas(req, res) {
    try {
      const fetcher = async () => {
        const data = await adoRequest('GET', `/wit/classificationnodes/Areas?$depth=10&api-version=7.1`, null, null, true);
        const result = [];
        (function walk(node, prefix) {
          const p = prefix ? `${prefix}\\${node.name}` : node.name;
          result.push(p);
          if (node.children) for (const child of node.children) walk(child, p);
        })(data, '');
        return result;
      };
      const areas = swrAreas ? await swrAreas.get('areas', fetcher) : await fetcher();
      json(res, areas);
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleTeamMembers(req, res) {
    try {
      const cfg = ctx.getConfig();
      const project = cfg.AzureDevOpsProject;
      const teamsData = await adoOrgRequest('GET', `/projects/${encodeURIComponent(project)}/teams?api-version=7.1`);
      const memberMap = new Map();
      const fetches = (teamsData.value || []).map(t =>
        adoOrgRequest('GET', `/projects/${encodeURIComponent(project)}/teams/${encodeURIComponent(t.name)}/members?api-version=7.1`).catch(() => ({ value: [] }))
      );
      const results = await Promise.all(fetches);
      for (const data of results) {
        for (const m of (data.value || [])) {
          const id = m.identity && m.identity.id;
          if (id && !memberMap.has(id)) {
            memberMap.set(id, {
              id,
              displayName: (m.identity && m.identity.displayName) || '',
              uniqueName: (m.identity && m.identity.uniqueName) || '',
              imageUrl: (m.identity && m.identity.imageUrl) || '',
            });
          }
        }
      }
      const members = [...memberMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
      json(res, members);
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // The @ado handle's search: what "@ado login bug" or a plain question about a person asks.
  // Answers in the shape every handle shares - label, detail, kind, and where it opens - so
  // the palette, Ask Cadence and every CLI can use it without knowing anything about ADO.
  // GET /api/plugins/azure-devops/search?q=<text>&limit=8&kinds=work-item,person
  async function handleSearch(req, res, url) {
    try {
      const q = String(url.searchParams.get('q') || '').trim();
      const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit')) || 8));
      const kinds = String(url.searchParams.get('kinds') || '').split(',').map(s => s.trim()).filter(Boolean);
      const wants = (k) => !kinds.length || kinds.includes(k);
      if (!q) return json(res, { items: [] });
      const items = [];
      const work = [];
      if (wants('work-item')) {
        work.push((async () => {
          // A number is an id, whatever else it might be; words look at the title.
          const asId = /^(?:AB#|#)?(\d{3,})$/i.exec(q);
          const safe = q.replace(/'/g, "''");
          const where = asId ? `[System.Id] = ${asId[1]}` : `[System.Title] CONTAINS '${safe}' AND [System.State] NOT IN ('Removed')`;
          const wiql = await adoRequest('POST', `/wit/wiql?$top=${limit}&api-version=7.1`, { query: `SELECT [System.Id] FROM WorkItems WHERE ${where} ORDER BY [System.ChangedDate] DESC` });
          const ids = (wiql.workItems || []).map(w => w.id).slice(0, limit);
          if (!ids.length) return;
          const detail = await adoRequest('GET', `/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo&api-version=7.1`);
          for (const wi of (detail.value || [])) {
            const f = wi.fields || {};
            items.push({
              kind: 'work-item', id: String(wi.id),
              label: `#${wi.id} ${f['System.Title'] || ''}`.trim(),
              detail: [f['System.WorkItemType'], f['System.State'], f['System.AssignedTo'] && f['System.AssignedTo'].displayName].filter(Boolean).join(' - '),
              open: { surface: 'ado', target: { workItem: String(wi.id) } },
              score: asId ? 1 : 0.7,
            });
          }
        })());
      }
      if (wants('person') && !/^\d+$/.test(q)) {
        work.push((async () => {
          const cfg = ctx.getConfig();
          const project = cfg.AzureDevOpsProject;
          const teamsData = await adoOrgRequest('GET', `/projects/${encodeURIComponent(project)}/teams?api-version=7.1`);
          const results = await Promise.all((teamsData.value || []).map(t =>
            adoOrgRequest('GET', `/projects/${encodeURIComponent(project)}/teams/${encodeURIComponent(t.name)}/members?api-version=7.1`).catch(() => ({ value: [] }))
          ));
          const seen = new Set();
          const needle = q.toLowerCase();
          for (const data of results) {
            for (const m of (data.value || [])) {
              const id = m.identity && m.identity.id;
              const name = (m.identity && m.identity.displayName) || '';
              const mail = (m.identity && m.identity.uniqueName) || '';
              if (!id || seen.has(id)) continue;
              const hit = name.toLowerCase().includes(needle) || needle.includes(name.toLowerCase()) || mail.toLowerCase().startsWith(needle.replace(/\s+/g, '.'));
              if (!hit) continue;
              seen.add(id);
              const org = mail.split('@')[1] ? mail.split('@')[1].split('.')[0] : '';
              items.push({
                kind: 'person', id,
                label: name || mail,
                detail: [mail, org ? `works at ${org}` : ''].filter(Boolean).join(' - '),
                open: { surface: 'ado', target: { person: mail || name } },
                score: name.toLowerCase() === needle ? 1 : 0.6,
              });
            }
          }
        })());
      }
      await Promise.all(work);
      items.sort((a, b) => (b.score || 0) - (a.score || 0));
      json(res, { items: items.slice(0, limit) });
    } catch (e) { json(res, { error: e.message }, e.message.includes('not configured') ? 400 : 502); }
  }

  async function handleStartWorking(req, res) {
    try {
      const { workItemId, repoName } = await ctx.readBody(req);
      const cfg = ctx.getConfig();
      if (!repoName) return json(res, { error: 'Choose a repo to work in first.', code: 'no-repo', repos: Object.keys(cfg.Repos || {}) }, 400);
      const repoPath = cfg.Repos && cfg.Repos[repoName];
      if (!repoPath) return json(res, { error: `Repo "${repoName}" is not in the repo list.`, code: 'no-repo', repos: Object.keys(cfg.Repos || {}) }, 400);
      if (!fs.existsSync(repoPath)) return json(res, { error: `Path does not exist: ${repoPath}` }, 400);
      const wi = await adoRequest('GET', `/wit/workitems/${workItemId}?fields=System.Title,System.WorkItemType,System.Description&api-version=7.1`);
      const title = wi.fields['System.Title'] || 'work';
      const description = (wi.fields['System.Description'] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const wiType = wi.fields['System.WorkItemType'] || 'feature';
      const prefix = wiType.toLowerCase() === 'bug' ? 'bugfix' : 'feature';
      const fallbackSlug = () => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const sanitizeSlug = (s) => String(s || '').trim().split('\n')[0].trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      const looksLikeQuestion = (s) => /\?|^(which|what|can|could|should|how|who|where|why)\b/i.test(String(s || '').trim());
      let slug;
      if (spawnSync) {
        try {
          const prompt = `Generate a short git branch slug (2 to 5 words, lowercase, hyphen-separated, no special chars) that clearly describes this work item. Reply with ONLY the slug, nothing else. Do not ask questions. Do not add quotes or commentary.\n\nTitle: ${title}\nType: ${wiType}${description ? `\nDescription: ${description}` : ''}`;
          const result = spawnSync('claude', ['--print'], { input: prompt, encoding: 'utf8', timeout: 20000, windowsHide: true, shell: true });
          const raw = (result.stdout || '').trim();
          if (result.status === 0 && raw && !looksLikeQuestion(raw)) slug = sanitizeSlug(raw);
        } catch (_) {}
      }
      if (!slug) slug = fallbackSlug();
      const branchName = `${prefix}/AB#${workItemId}-${slug}`;
      try {
        await adoRequest('PATCH', `/wit/workitems/${workItemId}?api-version=7.1`,
          [{ op: 'replace', path: '/fields/System.State', value: 'Active' }],
          'application/json-patch+json');
        if (swrWorkItems) swrWorkItems.invalidate('wi:');
      } catch (_) {}
      const gitSteps = [];
      try {
        let baseBranch = 'main';
        try { gitExec(repoPath, 'checkout main'); } catch (_) {
          baseBranch = 'master'; gitExec(repoPath, 'checkout master');
        }
        gitSteps.push(`checked out ${baseBranch}`);
        try { gitExec(repoPath, 'fetch origin'); gitSteps.push('fetched origin'); } catch (e) { gitSteps.push(`fetch failed: ${e.message}`); }
        try { gitExec(repoPath, 'pull'); gitSteps.push('pulled'); } catch (e) { gitSteps.push(`pull failed: ${e.message}`); }
        gitExec(repoPath, `checkout -b ${branchName}`);
        gitSteps.push(`created branch ${branchName}`);
      } catch (e) {
        return json(res, { error: `Git operation failed: ${e.message}`, steps: gitSteps }, 500);
      }
      json(res, { ok: true, branchName, repoPath, steps: gitSteps });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  // --- Route registration --------------------------------------------------

  // Dynamic paths: the SDK's addAbsoluteRoute takes exact URLs. For /api/workitems/<id>
  // variants we use addAbsolutePrefixRoute to match /api/workitems/* and pattern-match
  // inside the handler.
  // --- Pipelines and releases ---------------------------------------------------
  const runOf = (b) => ({
    id: b.id, number: b.buildNumber, status: b.status,
    result: b.result ? (b.result === 'partiallySucceeded' ? 'partial' : b.result) : (b.status === 'inProgress' ? 'running' : b.status === 'notStarted' ? 'queued' : b.status),
    branch: b.sourceBranch ? b.sourceBranch.replace('refs/heads/', '') : null, commit: b.sourceVersion ? b.sourceVersion.slice(0, 8) : null,
    reason: b.reason, requestedBy: b.requestedFor ? b.requestedFor.displayName : (b.requestedBy ? b.requestedBy.displayName : null),
    queuedAt: b.queueTime, startedAt: b.startTime, finishedAt: b.finishTime,
    durationMs: b.startTime && b.finishTime ? new Date(b.finishTime) - new Date(b.startTime) : null,
    url: b._links && b._links.web ? b._links.web.href : null,
    definition: b.definition ? { id: b.definition.id, name: b.definition.name } : null,
  });
  const wiOf = (w) => ({ id: w.id, type: w.fields['System.WorkItemType'], title: w.fields['System.Title'], state: w.fields['System.State'], assignedTo: w.fields['System.AssignedTo'] ? w.fields['System.AssignedTo'].displayName : null, changedAt: w.fields['System.ChangedDate'] });
  async function workItemsByIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      if (!chunk.length) continue;
      try { const d = await adoRequest('GET', `/wit/workitems?ids=${chunk.join(',')}&fields=System.Id,System.WorkItemType,System.Title,System.State,System.AssignedTo,System.ChangedDate&api-version=7.1`); for (const w of d.value || []) out.push(wiOf(w)); } catch (_) {}
    }
    return out;
  }
  const conventional = (msg) => { const m = String(msg || '').match(/^(\w+)(?:\(.+?\))?!?:\s*(.*)$/); return m ? { type: m[1].toLowerCase(), subject: m[2] } : { type: 'other', subject: String(msg || '').split('\n')[0] }; };

  async function handlePipelines(req, res) {
    try {
      const defs = await adoRequest('GET', '/build/definitions?$top=200&includeLatestBuilds=true&api-version=7.1');
      const list = (defs.value || []).map((d) => ({ id: d.id, name: d.name, folder: d.path && d.path !== '\\' ? d.path : '', type: d.type, queueStatus: d.queueStatus, url: d._links && d._links.web ? d._links.web.href : null, latest: d.latestBuild ? runOf(d.latestBuild) : null, latestCompleted: d.latestCompletedBuild ? runOf(d.latestCompletedBuild) : null }));
      list.sort((a, b) => (b.latest && b.latest.queuedAt ? new Date(b.latest.queuedAt) : 0) - (a.latest && a.latest.queuedAt ? new Date(a.latest.queuedAt) : 0));
      json(res, { pipelines: list });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handlePipelineRuns(req, res, url) {
    try {
      const id = url.searchParams.get('id');
      if (!id) return json(res, { error: 'id required' }, 400);
      const top = Number(url.searchParams.get('top') || 30);
      const branch = url.searchParams.get('branch');
      const d = await adoRequest('GET', `/build/builds?definitions=${encodeURIComponent(id)}&$top=${top}${branch ? `&branchName=${encodeURIComponent(branch.startsWith('refs/') ? branch : 'refs/heads/' + branch)}` : ''}&queryOrder=queueTimeDescending&api-version=7.1`);
      json(res, { runs: (d.value || []).map(runOf) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // One run. Failed tasks bring the tail of their log so the failure can be explained.
  async function handlePipelineRun(req, res, url) {
    try {
      const id = url.searchParams.get('id');
      if (!id) return json(res, { error: 'id required' }, 400);
      const [b, tl, ch, wi] = await Promise.all([
        adoRequest('GET', `/build/builds/${id}?api-version=7.1`),
        adoRequest('GET', `/build/builds/${id}/timeline?api-version=7.1`).catch(() => ({ records: [] })),
        adoRequest('GET', `/build/builds/${id}/changes?$top=100&api-version=7.1`).catch(() => ({ value: [] })),
        adoRequest('GET', `/build/builds/${id}/workitems?$top=100&api-version=7.1`).catch(() => ({ value: [] })),
      ]);
      const records = tl.records || [];
      const byId = {}; for (const r of records) byId[r.id] = r;
      const dur = (r) => (r.startTime && r.finishTime ? new Date(r.finishTime) - new Date(r.startTime) : null);
      const stages = records.filter((r) => r.type === 'Stage').sort((a, b) => (a.order || 0) - (b.order || 0)).map((st) => ({
        name: st.name, state: st.state, result: st.result, durationMs: dur(st),
        jobs: records.filter((r) => r.type === 'Job' && (r.parentId === st.id || (byId[r.parentId] && byId[r.parentId].parentId === st.id))).sort((a, b) => (a.order || 0) - (b.order || 0)).map((j) => ({
          name: j.name, state: j.state, result: j.result, durationMs: dur(j),
          tasks: records.filter((r) => r.type === 'Task' && r.parentId === j.id).sort((a, b) => (a.order || 0) - (b.order || 0)).map((t) => ({ name: t.name, state: t.state, result: t.result, durationMs: dur(t), logId: t.log ? t.log.id : null, issues: (t.issues || []).map((x) => ({ type: x.type, message: x.message })) })),
        })),
      }));
      // Log tails of the failed tasks, capped.
      const failedTasks = [];
      for (const st of stages) for (const j of st.jobs) for (const t of j.tasks) if (t.result === 'failed' && t.logId) failedTasks.push({ stage: st.name, job: j.name, task: t });
      for (const f of failedTasks.slice(0, 4)) {
        try {
          const text = await adoRequest('GET', `/build/builds/${id}/logs/${f.task.logId}?api-version=7.1`, null, 'text/plain');
          const lines = String(typeof text === 'string' ? text : (text.value || []).join('\n')).split('\n');
          const errIdx = lines.findIndex((l) => /##\[error\]|error:|Error:|FAILED|failed with exit code/i.test(l));
          const from = Math.max(0, Math.min(errIdx >= 0 ? errIdx - 20 : lines.length - 120, lines.length - 120));
          f.task.logTail = lines.slice(from, from + 160).map((l) => l.replace(/^\S+T\S+Z\s/, '')).join('\n').slice(0, 12000);
        } catch (e) { f.task.logTail = `(log not available: ${e.message})`; }
      }
      const items = await workItemsByIds((wi.value || []).map((w) => w.id).filter(Boolean));
      json(res, Object.assign(runOf(b), {
        message: b.triggerInfo && b.triggerInfo['ci.message'] ? b.triggerInfo['ci.message'] : '',
        stages,
        failedTasks: failedTasks.map((f) => ({ stage: f.stage, job: f.job, task: f.task.name, issues: f.task.issues, logTail: f.task.logTail || '' })),
        changes: (ch.value || []).map((c) => ({ id: c.id, short: c.id ? String(c.id).slice(0, 8) : '', message: (c.message || '').split('\n')[0], author: c.author ? c.author.displayName : null, at: c.timestamp, url: c.displayUri || null, ...conventional(c.message) })),
        workItems: items,
      }));
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handlePipelineHealth(req, res, url) {
    try {
      const id = url.searchParams.get('id');
      if (!id) return json(res, { error: 'id required' }, 400);
      const d = await adoRequest('GET', `/build/builds?definitions=${encodeURIComponent(id)}&$top=50&queryOrder=queueTimeDescending&api-version=7.1`);
      const runs = (d.value || []).map(runOf);
      const done = runs.filter((r) => ['succeeded', 'failed', 'partial', 'canceled'].includes(r.result));
      const ok = done.filter((r) => r.result === 'succeeded').length;
      const durations = done.map((r) => r.durationMs).filter((x) => x > 0);
      const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
      const recent = done.slice(0, 10); const older = done.slice(10, 20);
      const rate = (list) => (list.length ? Math.round((list.filter((r) => r.result === 'succeeded').length / list.length) * 100) : null);
      json(res, { total: runs.length, completed: done.length, succeeded: ok, failed: done.filter((r) => r.result === 'failed').length, partial: done.filter((r) => r.result === 'partial').length, canceled: done.filter((r) => r.result === 'canceled').length, successRate: rate(done), recentRate: rate(recent), olderRate: rate(older), avgDurationMs: avg, last: done.slice(0, 20).map((r) => ({ id: r.id, number: r.number, result: r.result, durationMs: r.durationMs, finishedAt: r.finishedAt, branch: r.branch })) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Release notes between two runs: the work items and commits of every run in between.
  async function handlePipelineNotes(req, res, url) {
    try {
      const id = url.searchParams.get('id'); const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
      if (!id || !to) return json(res, { error: 'id and to required (from optional: the previous successful run)' }, 400);
      const all = (await adoRequest('GET', `/build/builds?definitions=${encodeURIComponent(id)}&$top=200&queryOrder=queueTimeDescending&api-version=7.1`)).value || [];
      const toB = all.find((b) => String(b.id) === String(to)) || await adoRequest('GET', `/build/builds/${to}?api-version=7.1`);
      let fromB = from ? (all.find((b) => String(b.id) === String(from)) || await adoRequest('GET', `/build/builds/${from}?api-version=7.1`)) : null;
      if (!fromB) fromB = all.find((b) => b.result === 'succeeded' && String(b.id) !== String(to) && new Date(b.queueTime) < new Date(toB.queueTime)) || null;
      const t0 = fromB ? new Date(fromB.queueTime).getTime() : 0; const t1 = new Date(toB.queueTime).getTime();
      const between = all.filter((b) => { const t = new Date(b.queueTime).getTime(); return t > t0 && t <= t1; });
      const commits = []; const ids = new Set(); const seenCommit = new Set();
      for (const b of between) {
        try { for (const c of ((await adoRequest('GET', `/build/builds/${b.id}/changes?$top=100&api-version=7.1`)).value || [])) if (c.id && !seenCommit.has(c.id)) { seenCommit.add(c.id); commits.push({ id: c.id, short: String(c.id).slice(0, 8), message: (c.message || '').split('\n')[0], author: c.author ? c.author.displayName : null, at: c.timestamp, run: b.buildNumber, ...conventional(c.message) }); } } catch (_) {}
        try { for (const w of ((await adoRequest('GET', `/build/builds/${b.id}/workitems?$top=100&api-version=7.1`)).value || [])) if (w.id) ids.add(w.id); } catch (_) {}
      }
      const items = await workItemsByIds([...ids]);
      const order = ['Epic', 'Feature', 'User Story', 'Product Backlog Item', 'Bug', 'Task'];
      const groups = {}; for (const w of items) (groups[w.type] = groups[w.type] || []).push(w);
      const md = [`# Release notes - ${toB.definition ? toB.definition.name : `pipeline ${id}`} ${toB.buildNumber}`, '', `From ${fromB ? `${fromB.buildNumber} (${String(fromB.finishTime || fromB.queueTime).slice(0, 10)})` : 'the beginning'} to ${toB.buildNumber} (${String(toB.finishTime || toB.queueTime).slice(0, 10)}) - ${between.length} run${between.length === 1 ? '' : 's'}, ${items.length} work item${items.length === 1 ? '' : 's'}, ${commits.length} commit${commits.length === 1 ? '' : 's'}.`, ''];
      for (const type of Object.keys(groups).sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))) { md.push(`## ${type}s`, ''); for (const w of groups[type]) md.push(`- AB#${w.id} ${w.title}${w.assignedTo ? ` (${w.assignedTo})` : ''}`); md.push(''); }
      if (!items.length) md.push('_No work item is linked to these runs._', '');
      if (commits.length) {
        md.push('## Commits', '');
        const byType = {}; for (const c of commits) (byType[c.type] = byType[c.type] || []).push(c);
        for (const t of Object.keys(byType).sort()) { md.push(`### ${t}`, ''); for (const c of byType[t]) md.push(`- \`${c.short}\` ${c.subject || c.message}${c.author ? ` (${c.author})` : ''}`); md.push(''); }
      }
      json(res, { pipelineId: Number(id), from: fromB ? runOf(fromB) : null, to: runOf(toB), runs: between.map(runOf), workItems: items, commits, markdown: md.join('\n') });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Resolved or closed since the pipeline last succeeded: what the next run would ship.
  async function handleUnreleased(req, res, url) {
    try {
      const id = url.searchParams.get('id');
      let since = null; let last = null;
      if (id) { const d = await adoRequest('GET', `/build/builds?definitions=${encodeURIComponent(id)}&resultFilter=succeeded&$top=1&queryOrder=queueTimeDescending&api-version=7.1`); last = (d.value || [])[0] ? runOf(d.value[0]) : null; since = last ? last.finishedAt : null; }
      const wiql = { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN ('Resolved', 'Closed', 'Done') AND [System.WorkItemType] <> 'Task'${since ? ` AND [System.ChangedDate] >= '${new Date(since).toISOString().slice(0, 10)}'` : ' AND [System.ChangedDate] >= @today - 30'} ORDER BY [System.ChangedDate] DESC` };
      const q = await adoRequest('POST', '/wit/wiql?$top=200&api-version=7.1', wiql);
      let items = await workItemsByIds((q.workItems || []).map((w) => w.id));
      if (since) items = items.filter((w) => new Date(w.changedAt) > new Date(since));
      json(res, { pipelineId: id ? Number(id) : null, lastSuccessful: last, since, items });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleQueuePipeline(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/pipelines/queue', 'Queue an Azure DevOps pipeline run'))) return;
      const { id, branch } = await ctx.readBody(req);
      if (!id) return json(res, { error: 'id required' }, 400);
      const body = { definition: { id: Number(id) } };
      if (branch) body.sourceBranch = branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
      const b = await adoRequest('POST', '/build/builds?api-version=7.1', body);
      json(res, { ok: true, run: runOf(b) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  ctx.addAbsoluteRoute('GET',  '/api/pipelines',            handlePipelines);
  ctx.addAbsoluteRoute('GET',  '/api/pipelines/runs',       handlePipelineRuns);
  ctx.addAbsoluteRoute('GET',  '/api/pipelines/run',        handlePipelineRun);
  ctx.addAbsoluteRoute('GET',  '/api/pipelines/health',     handlePipelineHealth);
  ctx.addAbsoluteRoute('GET',  '/api/pipelines/notes',      handlePipelineNotes);
  ctx.addAbsoluteRoute('GET',  '/api/pipelines/unreleased', handleUnreleased);
  ctx.addAbsoluteRoute('POST', '/api/pipelines/queue',      handleQueuePipeline);

  ctx.addAbsoluteRoute('GET',  '/api/iterations',         handleIterations);
  ctx.addAbsoluteRoute('GET',  '/api/workitems',          handleWorkItems);
  ctx.addAbsoluteRoute('POST', '/api/workitems/create',   handleCreateWorkItem);
  ctx.addAbsoluteRoute('GET',  '/api/velocity',           handleVelocity);
  ctx.addAbsoluteRoute('GET',  '/api/burndown',           handleBurndown);
  ctx.addAbsoluteRoute('GET',  '/api/teams',              handleTeams);
  ctx.addAbsoluteRoute('GET',  '/api/areas',              handleAreas);
  ctx.addAbsoluteRoute('GET',  '/api/team-members',       handleTeamMembers);
  ctx.addAbsoluteRoute('POST', '/api/start-working',      handleStartWorking);

  // "What is happening, and who is doing it" - the timeline feed, one item's own history, and
  // what a single person is carrying. Kept in its own file so this one stays the work-item
  // surface. It registers its own routes and hands back the handler for the /updates sub-path,
  // which belongs to the prefix matcher below.
  const activity = require('./ado-activity').register({ adoRequest, json, ctx });

  // /api/workitems/<id> and its sub-paths require pattern matching.
  ctx.addAbsolutePrefixRoute('/api/workitems', (req, res, url, subpath) => {
    const s = subpath || '';
    const mState   = s.match(/^\/(\d+)\/state$/);
    const mComment = s.match(/^\/(\d+)\/comments$/);
    const mUpdates = s.match(/^\/(\d+)\/updates$/);
    const mParent  = s.match(/^\/(\d+)\/parent$/);
    const mItem    = s.match(/^\/(\d+)$/);
    if (mUpdates && req.method === 'GET') return activity.handleWorkItemUpdates(req, res, mUpdates[1]);
    if (mState && req.method === 'PATCH') return handleWorkItemState(req, res, mState[1]);
    if (mComment && req.method === 'POST') return handleAddWorkItemComment(req, res, mComment[1]);
    if (mParent && req.method === 'POST') return handleSetParent(req, res, mParent[1]);
    if (mItem && req.method === 'GET')   return handleWorkItemDetail(req, res, mItem[1]);
    if (mItem && req.method === 'PATCH') return handleUpdateWorkItem(req, res, mItem[1]);
    return false; // not our path -- fall through
  });
};
