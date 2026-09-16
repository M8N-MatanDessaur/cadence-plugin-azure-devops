# Azure DevOps Plugin

The Azure DevOps plugin owns every interaction with dev.azure.com in Cadence: work item tracking, sprints and iterations, velocity, teams, area paths, burndown, and AB# auto-linking.

## Extraction state

The HTTP handlers live in this plugin's `routes.js`. The manifest keeps the legacy absolute paths under `/api/workitems/*`, `/api/iterations`, etc. so existing UI, scripts, and AI routes keep working while ownership is plugin-based.

## Routes described by the manifest

| Surface              | Current path                              | Purpose                                 |
|----------------------|-------------------------------------------|-----------------------------------------|
| List work items      | `GET /api/workitems`                      | Backlog / My Items / Iteration views    |
| Create work item     | `POST /api/workitems/create`              | Gated. Accepts `parent` to nest under a story |
| Get work item        | `GET /api/workitems/:id`                  | Detail view                             |
| Update work item     | `PATCH /api/workitems/:id`                | Gated. Fields + `parent` (re-parents)   |
| Change state         | `PATCH /api/workitems/:id/state`          | Gated                                   |
| Set parent           | `POST /api/workitems/:id/parent`          | Gated. Nest under a parent (Hierarchy)  |
| Comment              | `POST /api/workitems/:id/comments`        | Gated                                   |
| Iterations           | `GET /api/iterations`                     | Iteration selector                      |
| Teams                | `GET /api/teams`                          | Teams sidebar                           |
| Team members         | `GET /api/team-members`                   | Team capacity UI                        |
| Areas                | `GET /api/areas`                          | Area path picker                        |
| Velocity             | `GET /api/velocity`                       | Velocity widget                         |
| Burndown             | `GET /api/burndown`                       | Burndown chart                          |
| Start working        | `POST /api/start-working`                 | Moves item to Active, creates branch    |

## Contributions

- `workItemProvider` exposes the full work-item surface so the future provider-agnostic Backlog tab renders ADO via the same interface Jira/Wrike plugins will implement.
- `workItemProvider` and plugin-owned routes drive the Backlog, Work Item, Activity, Teams, Velocity, and Burndown surfaces.
- `leftQuickActions` contributes "New Item", "My Items", "Refresh".
- `aiActions` contributes the "Standup Summary", "Iteration Status", and "Retrospective" quick AI actions.
- `commitLinkers` registers the `AB#<id>` auto-link resolver.
- `configKeys`, `sensitiveKeys`, and `imageAuth` declare this plugin's config ownership, secret scrubbing, and authenticated image hosts.

## Configuration

Reads `AzureDevOpsOrg`, `AzureDevOpsProject`, `AzureDevOpsProjects`, `AzureDevOpsPAT`, `DefaultTeam`, and `DefaultArea`. These keys are persisted in `dashboard/plugins/azure-devops/config.json` and merged into `/api/config` for backward compatibility.

## AB# auto-link

The `commitLinkers` pattern `AB#(\d+)` maps to `{adoOrgUrl}/_workitems/edit/{1}`. The token `{adoOrgUrl}` is resolved by the shell using the current ADO org URL from config; plugins do not embed org URLs.

## Workflow rules (owned by this plugin)

### Work item creation

When creating work items through this plugin, ALWAYS include:

1. **Title** -- clear, concise, descriptive (plain text, no special characters)
2. **Description** -- detailed enough to understand the full scope; include context, what needs to happen, and why
3. **Story Points** -- estimate 1, 2, 3, 5, 8, or 13 based on complexity
4. **Priority** -- default to 2 (Normal) unless specified
5. **Acceptance Criteria** -- for features / user stories; skip for small bugs
6. **Iteration** -- use `selectedIteration` from `/api/ui/context`; if null ("All Iterations"), leave `iterationPath` empty; NEVER assume the current sprint
7. **Parent** -- when creating a child Task/Bug under a User Story/Feature, pass `parent` (the parent work item id) so it nests correctly. To re-parent an existing item, `POST /api/workitems/:id/parent` with `{ "parent": <id> }` (or `PATCH /api/workitems/:id` with a `parent` field). Any existing parent is replaced.

### State transitions

When moving a work item to **Active** or **Resolved**:

1. Fetch team members from `/api/team-members`
2. Look up the `DefaultUser` from `/api/config`
3. If found in the team, assign the work item to them; otherwise leave unassigned

State progression: `New -> Active -> Resolved -> Closed`.

### Work item lifecycle during development

Follow this sequence when working on a task tied to a work item:

1. **Start working** -- AUTOMATICALLY move the item to **Active** (via `/api/start-working` or manually). Do not wait for the user.
2. **Write code** -- work item stays Active.
3. **Show diff** using `Show-Diff.ps1 -Repo '<name>'` -- let the user review.
4. **Commit** -- ask "Ready to commit?".
5. **After commit** -- ask "Want me to move AB#<id> to Resolved?" and act on confirmation. Never forget this step.
6. **Push / PR** -- only when the user asks.

Always include `AB#<id>` in commit messages and branch names so the GitHub <-> ADO crosswalk auto-links.

### Plugin scripts

Under `./dashboard/plugins/azure-devops/scripts/`:

| Script | Purpose |
|---|---|
| `Get-SprintStatus.ps1` | Current sprint overview |
| `Get-StandupSummary.ps1 -IterationPath '...'` | Standup of recent changes |
| `Get-Retrospective.ps1` | Last completed sprint analysis |
| `Get-WorkItem.ps1 -Id <id>` | Full work item detail |
| `New-WorkItem.ps1 -Type '...' -Title '...' -Priority <n> -StoryPoints <n> [-Parent <id>] [-IterationPath '...'] [-AreaPath '...']` | Create a work item (optionally nested under a parent) |
| `Set-WorkItemState.ps1 -Id <id> -State <state>` | Change work item state |
| `Set-WorkItemParent.ps1 -Id <id> -Parent <id>` | Nest a work item under a parent (Hierarchy link) |
| `Find-WorkItems.ps1 -Search '...' -Type '...' -State '...'` | Filter work items |
| `Get-MyWorkItems.ps1 [-State <state>]` | My items grouped by state |
| `Refresh-Board.ps1` | Refresh backlog / board view |

Call with `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./dashboard/plugins/azure-devops/scripts/<Name>.ps1"` from bash.

## Pipelines and releases (3.0)

The Release Manager plugin retired into this one. Same server as your shell (`$CADENCE_API`, fallback `http://127.0.0.1:3800`); GET routes are read-only, POST routes go through the permission gate and need `x-cadence-token` (the scripts attach it).

| Route | What |
|---|---|
| `GET /api/pipelines` | Every build pipeline with its latest run and latest completed run |
| `GET /api/pipelines/runs?id&top&branch` | Runs of one pipeline |
| `GET /api/pipelines/run?id` | One run: stages, jobs, tasks, failed tasks with their log tail, commits (conventional type parsed), linked work items |
| `GET /api/pipelines/health?id` | Success rate (recent versus older), failed, partial, average duration, last 20 |
| `GET /api/pipelines/notes?id&to[&from]` | Release notes between two runs: work items grouped by type, commits grouped by conventional type, as Markdown plus the raw lists; `from` defaults to the previous successful run |
| `GET /api/pipelines/unreleased[?id]` | Work items resolved or closed since the pipeline last succeeded (or in the last 30 days) |
| `POST /api/pipelines/queue {id, branch?}` | Queue a run |

Scripts: `Get-Pipelines`, `Get-PipelineRuns -Id [-Branch]`, `Get-PipelineRun -Id`, `Get-PipelineHealth -Id`, `New-ReleaseNotes -Id -To [-From]`, `Get-UnreleasedItems [-Id]`, `Start-Pipeline -Id [-Branch]` (gated).
