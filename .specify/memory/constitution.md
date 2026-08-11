<!--
Sync Impact Report
Version change: 1.6.0 -> 1.7.0
Modified principles:
- III. Tests Are Mandatory: integration-level coverage now explicitly includes diagnostics.
- Delivery Workflow: added Scope Discipline rules enforced by affected product areas.
Added sections:
- None
Removed sections:
- None
Follow-up TODOs:
- None
-->
# Trezor Bench Constitution

## Core Principles

### I. TypeScript Extension First
All shipped code MUST be authored in TypeScript and MUST target the stable VS Code
extension API available in VS Code 1.105 or newer. Work to preserve behavior on
older VS Code releases is out of scope unless the constitution is amended first.
Rationale: the project is a VS Code extension, and narrowing the support window keeps
implementation and test effort focused on the supported host.

### II. Manifest-Driven Behavior
Available build context, build options, artifact resolution, and debug selection MUST
derive from workspace settings and repository data such as `tbench.yaml`. Features
MUST NOT hardcode firmware matrices, silently infer alternate artifacts, or retain
stale state once the manifest or settings disallow it. Invalid or missing source data
MUST trigger visible normalization or failure handling.
Rationale: the firmware repository is the source of truth, and the extension must stay
aligned with it instead of drifting into duplicated configuration.

### III. Tests Are Mandatory
Every functional change MUST ship with automated tests that fail before the fix or
feature is implemented when practical. User-story work MUST include tests for the
primary success path, and bug fixes MUST include regression coverage. Changes that
touch VS Code integration, manifest parsing, task execution, diagnostics, or persisted
state MUST include integration-level coverage in addition to focused unit tests where feasible.
Rationale: this extension coordinates workspace state, UI, tasks, and tooling; without
tests, regressions will be hard to detect and expensive to diagnose.

### IV. Failures Must Be Visible
User-blocking and state-changing failures MUST be surfaced through explicit VS Code
feedback. File-backed problems MUST produce diagnostics when a concrete file can be
identified, and runtime warnings or errors MUST be written to a dedicated output
channel with enough context to troubleshoot the failure. Silent fallbacks that hide
manifest, artifact, provider, or debug-resolution problems are prohibited.
Rationale: this tool is operational infrastructure inside the editor, so invisible
failures are worse than explicit failure states.

### V. Keep It Small And Clear
Designs MUST prefer the smallest implementation that satisfies the current
requirement. New abstractions, background services, or compatibility layers require
an explicit need. Identifiers SHOULD stay under 25 characters when that does not
reduce clarity; longer names MUST be justified by disambiguation or API constraints.
Complexity exceptions MUST be recorded in the implementation plan.
Rationale: the extension spans UI, task orchestration, and editor integration;
concise code and justified complexity keep it maintainable.

## Technical Guardrails

- The product is a single-package VS Code extension for the `trezor-firmware`
	workspace and is implemented in TypeScript.
- The supported editor baseline is VS Code 1.105+.
- The extension may assume a single-root workspace unless a future amendment
	expands that scope.
- Integration with external tools such as cpptools, Cargo tasks, YAML manifests,
	and debug templates MUST use stable, documented interfaces and fail explicitly
	when prerequisites are missing.
- Repository data and workspace settings are authoritative over cached extension
	state.

## Delivery Workflow

- Before `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, or
	`/speckit.implement` proceeds, the agent MUST read `specs/product-spec.md`
	and `specs/glossary.md` when those files exist.
- Those workflow steps MUST extract the concrete user-visible and
	implementation-sensitive details from the relevant product-spec sections,
	including UI interaction rules, ordering constraints, persistence behavior,
	command-surface behavior, and VS Code surface expectations that are easy to
	omit when only a summary is carried forward.
- Each feature spec MUST describe user-visible behavior, edge cases, operational
	constraints, and failure or diagnostic behavior.
- If the selected product documentation contains a concrete required behavior
	that is not yet represented in `spec.md`, `plan.md`, `tasks.md`, or the
	intended implementation approach, the agent MUST amend the missing artifact
	before continuing instead of silently proceeding with a partial
	interpretation.
- Each generated spec, implementation plan, and task list MUST explicitly name
	the affected product areas in `specs/product-spec.md` and any required terms
	from `specs/glossary.md`, and MUST stay aligned with that documentation.
- Scope Discipline: every spec, plan, and task list MUST remain within the
	bounded feature scope defined by its named affected product areas. Spec
	generation MUST reject requirements outside that scope. Plan generation MUST
	error when it introduces behavior outside that scope without a corresponding
	specification and product-documentation update. Task generation MUST error
	when a generated task belongs to unrelated product behavior outside the
	scoped feature change. An agent executing `tasks.md` MUST halt and request
	clarification, rather than silently absorbing the work, when a task, code
	change, or requested follow-on work would cross into product behavior outside
	the affected product areas.
- If requested work changes user-visible behavior or terminology that is not yet
	represented in `specs/product-spec.md` or `specs/glossary.md`, the workflow
	MUST update the relevant consolidated document in the same change or stop for
	clarification before continuing.
- Each implementation plan MUST record the critical product-spec details that
	are most likely to be missed during coding, especially for tree-view
	behavior, event ordering, persistence semantics, command visibility,
	template-resolution rules, and other editor-integration details.
- Each implementation plan MUST pass a Constitution Check covering host
	compatibility, manifest-driven design, test coverage, failure visibility, and
	simplicity.
- Each task list MUST schedule tests before implementation tasks for every user
	story and MUST include observability work whenever a feature adds new failure
	modes or validation paths.
- Each task list and implementation run MUST include explicit coverage for
	critical product-spec and glossary details through dedicated test tasks,
	validation tasks, or both.
- Agents and generated artifacts MUST use workspace-relative paths whenever they
	reference files inside the current workspace. Absolute filesystem paths MAY be
	used only for tool execution, script parsing, or references outside the
	workspace.
- When an automated agent executes `tasks.md`, it MUST complete exactly one task
	at a time. Automatic commits MUST be created only after the completed task has
	been verified, including required tests or validation steps, and after
	`tasks.md` has been updated to mark that task finished. The default rule is
	one task per commit; grouping multiple tasks into a single commit is prohibited
	unless an approved exception explicitly allows it. Implementation-phase commit
	subjects MUST begin with task identifiers followed by a colon and a concise
	description. A single-task commit MUST use `T001:`. An approved contiguous
	multi-task exception MUST use an inclusive interval such as `T003-T006:`. An
	approved non-contiguous multi-task exception MUST use a comma-separated list
	such as `T001,T007,T009:`. Approved mixed exceptions MAY combine both forms,
	for example `T001,T003-T006:`.
- Before a task is marked complete, self-review MUST compare the changed code
	against the affected feature spec, `specs/product-spec.md`, and
	`specs/glossary.md` as applicable, and confirm that the critical details were
	implemented as specified, not merely approximated.
- Code review and self-review MUST verify constitutional compliance before merge.
- Documentation and generated scaffolding MUST stay consistent with this
	constitution whenever the rules change.

## Governance

This constitution overrides conflicting local process guidance for this repository.
Amendments require a documented change to this file, an explicit rationale, and
synchronization of impacted templates, agent instructions, and consolidated
product documentation in the same change.
Versioning follows semantic rules for governance documents: MAJOR for incompatible
principle changes or removals, MINOR for new principles or materially expanded
requirements, and PATCH for clarifications that do not change project obligations.
Compliance review is required for every plan, task list, and pull request that
changes behavior, tooling, or development workflow.

**Version**: 1.7.0 | **Ratified**: 2026-04-02 | **Last Amended**: 2026-07-31
