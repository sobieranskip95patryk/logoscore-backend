Project‑specific operational rules for coding agents.

1. Project Rules
Keep changes minimal, reviewable, and consistent with existing conventions.

Never modify secrets, credentials, .env, deployment configs, billing/IAM/cloud settings, or infrastructure files without explicit approval.

Before editing, inspect the relevant files and confirm their role in the project.

After editing, provide a concise summary of changed files and the reasoning behind each change.

Prefer unified diff patches for modifications.

When practical, run or propose commands for tests, linting, formatting, or builds.

If a command cannot be executed, provide the exact command the operator should run.

2. Git Workflow
Do not commit, push, merge, rebase, or delete branches unless explicitly asked.

Use a separate branch for meaningful changes.

Keep diffs clean and avoid unrelated formatting or refactoring.

Do not modify files outside the scope of the assigned task.

3. Project Stack Awareness
Before proposing changes, identify:

Language and framework (Python, FastAPI/Flask/Django, Node/TS, etc.).

Dependency management (requirements.txt, pyproject.toml, package.json).

Entry points (main.py, app.py, index.ts, etc.).

Routing, middleware, config, and service layers.

Environment variable usage.

Database clients and connection lifecycle.

Dockerfile and container structure (if present).

Deployment scripts or CI/CD pipelines.

If any of these are unclear → ask before acting.

4. Commands and Checks
Before proposing changes, identify available scripts and tools.

Python
Tests: pytest

Linting: ruff check .

Type checking: mypy .

Formatting: black . or ruff format .

Node/TypeScript
Tests: npm test

Linting: npm run lint

Build: npm run build

General
Repo state: git status

Diff: git diff

Directory structure: tree -L 3

5. Docker / Container Rules
Do not modify Dockerfiles unless explicitly instructed.

Do not introduce new base images or system packages without approval.

Do not modify ports, ENTRYPOINT, CMD, or multi‑stage structure unless requested.

Use unified diff for Dockerfile changes.

For large Dockerfile generation, use cat << 'EOF' blocks.

6. GCP Deployment Rules
High‑risk areas requiring explicit approval:

Cloud Run / Cloud Functions / Compute Engine

Artifact Registry / Cloud Build

IAM roles / service accounts

VPC / firewall rules

Cloud SQL / Firestore / BigQuery

Secrets Manager

DNS / networking

Billing / quotas

Allowed:

analyzing deployment scripts,

describing workflows,

generating safe, non‑executing commands.

Forbidden without approval:

deploys, migrations, IAM changes, registry pushes, service account creation.

7. API Contract Enforcement
Do not change API routes, HTTP methods, request/response schemas, or error formats unless explicitly instructed.

Preserve authentication and authorization logic.

Detect schema drift and report it.

If a change affects the API contract → stop and ask.

8. Multi‑Agent Orchestration Rules
Execute only the tasks explicitly assigned to this agent.

Do not infer tasks belonging to other agents.

Do not reinterpret or optimize instructions from other agents.

If instructions conflict → ask for clarification.

Do not assume shared state unless provided.

9. Communication Rules
Explanations: Polish.

Code, identifiers, commit messages, technical comments: English.

For complex tasks, respond using:
Plan → Changes → Tests → Risks → Next steps

10. Shell / Terminal Mode
Allowed only for:

generating large files via cat << 'EOF',

generating patches,

generating safe build/test commands.

Forbidden:

destructive commands,

deploys,

IAM changes,

network modifications,

database migrations,

installation commands.

All commands must be non‑executing suggestions.