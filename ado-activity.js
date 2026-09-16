'use strict';
/**
 * The parts of Azure DevOps that answer "what is happening, and who is doing it".
 *
 * The plugin could already read and change a work item. What it could not do is answer the two
 * questions a person actually opens a board to ask: what moved recently, and what is this
 * person carrying right now. Both are one WIQL query away, and neither is worth a trip to
 * dev.azure.com.
 *
 * Registered separately from routes.js so the original file stays the work-item surface and
 * this stays the "who and when" one.
 */

/**
 * @param {object} deps
 * @param {(method: string, path: string, body?: any, contentType?: string) => Promise<any>} deps.adoRequest
 * @param {(res: any, data: any, status?: number) => void} deps.json
 * @param {object} deps.ctx  the plugin context, for addAbsoluteRoute and getConfig
 */
function register({ adoRequest, json, ctx }) {
  /** Work items whose last change falls in the window, newest first. */
  async function recentlyChanged({ days = 7, top = 200, assignedTo = '' } = {}) {
    const clauses = [
      "[System.TeamProject] = @project",
      `[System.ChangedDate] >= @today - ${Math.max(0, Math.min(365, Number(days) || 7))}`,
    ];
    // @me would resolve to the PAT's owner, which is not who the caller asked about.
    if (assignedTo) clauses.push(`[System.AssignedTo] = '${String(assignedTo).replace(/'/g, "''")}'`);
    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.ChangedDate] DESC`,
    };
    const result = await adoRequest('POST', `/wit/wiql?$top=${Number(top) || 200}&api-version=7.1`, wiql);
    const ids = (result.workItems || []).map((w) => w.id);
    if (!ids.length) return [];

    // The batch endpoint caps at 200 ids per call, which is also our ceiling above.
    const fields = [
      'System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo',
      'System.ChangedDate', 'System.ChangedBy', 'System.CreatedDate', 'System.IterationPath',
      'System.Tags', 'Microsoft.VSTS.Scheduling.StoryPoints',
    ];
    const batch = await adoRequest('POST', '/wit/workitemsbatch?api-version=7.1', { ids, fields });
    return (batch.value || []).map((wi) => {
      const f = wi.fields || {};
      return {
        id: wi.id,
        title: f['System.Title'] || '',
        state: f['System.State'] || '',
        type: f['System.WorkItemType'] || '',
        assignedTo: f['System.AssignedTo'] ? f['System.AssignedTo'].displayName : '',
        assignedToEmail: f['System.AssignedTo'] ? (f['System.AssignedTo'].uniqueName || '') : '',
        changedBy: f['System.ChangedBy'] ? f['System.ChangedBy'].displayName : '',
        changedDate: f['System.ChangedDate'] || '',
        createdDate: f['System.CreatedDate'] || '',
        iterationPath: f['System.IterationPath'] || '',
        tags: f['System.Tags'] || '',
        storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
        // Whether this item is new or was merely touched changes how it reads in a timeline.
        isNew: f['System.CreatedDate'] === f['System.ChangedDate'],
      };
    }).sort((a, b) => String(b.changedDate).localeCompare(String(a.changedDate)));
  }

  /**
   * GET /api/activity?days=7&top=200
   * The project's recent movement, newest first - the feed behind the timeline.
   */
  async function handleActivity(req, res, url) {
    try {
      const days = url && url.searchParams.get('days');
      const top = url && url.searchParams.get('top');
      const items = await recentlyChanged({ days: days || 7, top: top || 200 });
      json(res, { days: Number(days) || 7, count: items.length, items });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  /**
   * GET /api/workitems/<id>/updates
   * One item's own history: who changed which field, from what, to what, and when.
   * The raw revision feed is mostly noise - system fields churn on every save - so it is
   * reduced to the changes a person would actually mention.
   */
  const INTERESTING = new Set([
    'System.State', 'System.AssignedTo', 'System.Title', 'System.IterationPath',
    'System.AreaPath', 'System.Tags', 'Microsoft.VSTS.Scheduling.StoryPoints',
    'Microsoft.VSTS.Common.Priority',
  ]);

  async function handleWorkItemUpdates(req, res, id) {
    try {
      const data = await adoRequest('GET', `/wit/workitems/${id}/updates?api-version=7.1`);
      const updates = [];
      for (const rev of data.value || []) {
        const changes = [];
        for (const [field, change] of Object.entries(rev.fields || {})) {
          if (!INTERESTING.has(field)) continue;
          const from = change.oldValue;
          const to = change.newValue;
          if (from === to) continue;
          changes.push({
            field: field.replace(/^(System|Microsoft\.VSTS\.[A-Za-z]+)\./, ''),
            from: from && from.displayName ? from.displayName : (from === undefined ? '' : from),
            to: to && to.displayName ? to.displayName : (to === undefined ? '' : to),
          });
        }
        // A revision that only bumped a system field is not worth a line in the history.
        if (!changes.length) continue;
        updates.push({
          rev: rev.rev,
          by: rev.revisedBy ? rev.revisedBy.displayName : '',
          at: (rev.fields && rev.fields['System.ChangedDate'] && rev.fields['System.ChangedDate'].newValue) || rev.revisedDate || '',
          changes,
        });
      }
      json(res, { id: Number(id), updates: updates.reverse() });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  /**
   * GET /api/person?who=<display name or email>&days=30
   * What one person is carrying: everything open and assigned to them, plus what they have
   * touched lately. This is the question the 2.0 team tab could not answer.
   */
  async function handlePerson(req, res, url) {
    try {
      const who = (url && url.searchParams.get('who')) || '';
      if (!who) return json(res, { error: 'who is required' }, 400);
      const days = Number((url && url.searchParams.get('days')) || 30);

      const touched = await recentlyChanged({ days, top: 200, assignedTo: who });
      const open = touched.filter((i) => !/closed|done|removed|resolved/i.test(i.state));
      const byState = {};
      for (const item of touched) byState[item.state] = (byState[item.state] || 0) + 1;
      const points = open.reduce((sum, i) => sum + (Number(i.storyPoints) || 0), 0);

      json(res, {
        who,
        days,
        counts: { total: touched.length, open: open.length, points },
        byState,
        items: touched,
      });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  /**
   * GET /api/comments?days=7&top=40
   * What people actually SAID on the work, across every item that moved in the window.
   *
   * Azure DevOps only serves comments per work item, so this reads the recently changed items
   * and asks each for its comments in parallel, then keeps the ones written in the window,
   * newest first. Forty items is enough to cover a week on a busy board and cheap enough to
   * do on every open.
   */
  async function handleComments(req, res, url) {
    try {
      const days = Math.max(1, Math.min(90, Number(url && url.searchParams.get('days')) || 7));
      const top = Math.max(1, Math.min(80, Number(url && url.searchParams.get('top')) || 40));
      const since = Date.now() - days * 86400000;
      const items = await recentlyChanged({ days, top });
      const byId = new Map(items.map((i) => [i.id, i]));

      const batches = await Promise.all(items.map((item) =>
        adoRequest('GET', `/wit/workitems/${item.id}/comments?$top=50&api-version=7.1-preview.4`)
          .then((d) => (d.comments || []).map((c) => ({
            id: c.id,
            workItemId: item.id,
            title: item.title,
            type: item.type,
            state: item.state,
            author: c.createdBy ? c.createdBy.displayName : '',
            date: c.createdDate || '',
            // Comments arrive as HTML; the feed shows text, and the item panel shows the rest.
            text: String(c.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          })))
          .catch(() => [])));

      const comments = batches.flat()
        .filter((c) => c.date && new Date(c.date).getTime() >= since && c.text)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 60);
      json(res, { days, itemsScanned: items.length, count: comments.length, comments });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  ctx.addAbsoluteRoute('GET', '/api/activity', handleActivity);
  ctx.addAbsoluteRoute('GET', '/api/comments', handleComments);
  ctx.addAbsoluteRoute('GET', '/api/person', handlePerson);

  // /api/workitems/<id>/updates lives under a prefix routes.js already owns, so it is
  // returned here for that matcher to call rather than registered separately.
  return { handleWorkItemUpdates };
}

module.exports = { register };
