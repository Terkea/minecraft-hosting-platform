# CI/CD Pipeline Documentation

Comprehensive documentation for the Minecraft Server Hosting Platform CI/CD pipelines.

## Table of Contents

- [Overview](#overview)
- [Workflow Summary](#workflow-summary)
- [CI Workflow](#ci-workflow-githubworkflowsciyml)
- [Security Workflow](#security-workflow-githubworkflowssecurityyml)
- [Deploy Workflow](#deploy-workflow-githubworkflowsdeployyml)
- [Release Workflow](#release-workflow-githubworkflowsreleaseyml)
- [DAST Workflow](#dast-workflow-githubworkflowsdastyml)
- [Environment Variables](#environment-variables)
- [Security Configuration](#security-configuration)
- [Local Development](#local-development)
- [Troubleshooting](#troubleshooting)

## Overview

The platform uses GitHub Actions for continuous integration, security scanning, and deployment. All pipelines are **blocking** - failures will prevent merges and deployments.

### Key Principles

1. **No Error Skipping**: All jobs fail on errors - no `continue-on-error` or `|| true`
2. **Security First**: Security scans run as gates before builds
3. **Parallel Execution**: Independent jobs run concurrently for speed
4. **Artifact Preservation**: Build artifacts are uploaded for downstream jobs

## Workflow Summary

| Workflow | File           | Trigger                    | Purpose                       |
| -------- | -------------- | -------------------------- | ----------------------------- |
| CI       | `ci.yml`       | Push/PR to master, develop | Lint, typecheck, build, test  |
| Security | `security.yml` | Push/PR + Weekly schedule  | SAST, dependencies, IaC       |
| Deploy   | `deploy.yml`   | Push/PR to master, develop | Security gate + full build    |
| Release  | `release.yml`  | Tag push (v\*.\*.\*)       | Build, Docker images, release |
| DAST     | `dast.yml`     | Push/PR + Manual           | Runtime security testing      |

### Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           On Push/PR                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │     CI       │    │    Security      │    │     Deploy       │       │
│  │  (Parallel)  │    │    (Parallel)    │    │  (Sequential)    │       │
│  ├──────────────┤    ├──────────────────┤    ├──────────────────┤       │
│  │ • Lint       │    │ • Semgrep SAST   │    │ 1. Security Scan │       │
│  │ • Typecheck  │    │ • NPM Audit      │    │    (Trivy)       │       │
│  │ • Build API  │    │ • Go Vulncheck   │    │        ↓         │       │
│  │ • Build FE   │    │ • Trivy          │    │ 2. API Build     │       │
│  │ • Build Op   │    │ • Checkov        │    │ 3. Frontend Build│       │
│  │ • Go Tests   │    │ • License Check  │    │ 4. Operator Build│       │
│  │ • Secrets    │    │                  │    │                  │       │
│  └──────────────┘    └──────────────────┘    └──────────────────┘       │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## CI Workflow (`.github/workflows/ci.yml`)

Primary continuous integration pipeline for code quality and builds.

### Triggers

- Push to `master` or `develop`
- Pull requests to `master` or `develop`

### Jobs

#### 1. Lint & Format

Runs code quality checks across all codebases:

| Check       | Tool          | Scope             |
| ----------- | ------------- | ----------------- |
| Formatting  | Prettier      | TS, JS, JSON, CSS |
| API Linting | ESLint        | `api-server/`     |
| FE Linting  | ESLint        | `frontend/`       |
| Go Linting  | golangci-lint | `k8s/operator/`   |

#### 2. TypeScript Check

Type verification for TypeScript projects:

- `api-server/` - Node.js backend
- `frontend/` - Svelte frontend

#### 3. Build Jobs (Parallel)

| Component  | Output                      | Artifact Name     |
| ---------- | --------------------------- | ----------------- |
| API Server | `api-server/dist/`          | `api-server-dist` |
| Frontend   | `frontend/dist/`            | `frontend-dist`   |
| Operator   | `k8s/operator/bin/operator` | `operator-binary` |

#### 4. Go Tests

- Race condition detection (`-race` flag)
- Code coverage uploaded to Codecov

#### 5. Secret Detection

Uses [Gitleaks](https://github.com/gitleaks/gitleaks) with custom rules from `.gitleaks.toml`.

### Concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Only one CI run per branch at a time; new pushes cancel in-progress runs.

## Security Workflow (`.github/workflows/security.yml`)

Comprehensive security scanning pipeline. **All jobs are blocking.**

### Triggers

- Push to `master` or `develop`
- Pull requests to `master` or `develop`
- Weekly schedule (Monday 00:00 UTC)

### Jobs

#### 1. Semgrep SAST

Static Application Security Testing using [Semgrep](https://semgrep.dev/):

```yaml
run: semgrep scan --config auto --error
```

Rule sets applied:

- `p/default` - General security rules
- `p/security-audit` - Security audit rules
- `p/typescript` - TypeScript-specific rules
- `p/golang` - Go-specific rules

#### 2. NPM Audit

Dependency vulnerability scanning for Node.js:

```bash
npm audit --audit-level=high
```

Scans:

- `api-server/` dependencies
- `frontend/` dependencies

#### 3. Go Vulnerability Check

Uses [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck):

```bash
govulncheck ./...
```

Checks `k8s/operator/` Go dependencies.

#### 4. Trivy Security Scan

Filesystem vulnerability scanning using [Trivy](https://trivy.dev/):

```yaml
severity: 'CRITICAL,HIGH'
exit-code: '1' # Fail on findings
```

#### 5. Checkov IaC Scan

Infrastructure as Code scanning for Kubernetes manifests:

```yaml
directory: k8s/
framework: kubernetes,helm
soft_fail: false
```

**Skipped Checks** (intentionally disabled for Minecraft workloads):

| Check ID   | Description                  | Reason                                 |
| ---------- | ---------------------------- | -------------------------------------- |
| CKV_K8S_43 | Image using digest           | Using semantic version tags            |
| CKV_K8S_40 | Resource limits defined      | Limits set at pod level                |
| CKV_K8S_38 | Service account token mount  | Required for K8s API access            |
| CKV_K8S_28 | NET_RAW capability           | Default for game server networking     |
| CKV_K8S_22 | Read-only filesystem         | Minecraft requires writable world data |
| CKV_K8S_21 | Default namespace            | Uses dedicated namespace               |
| CKV_K8S_20 | Low user ID                  | Container runs as minecraft user       |
| CKV_K8S_23 | Host IPC                     | Not applicable                         |
| CKV_K8S_25 | Container privileged         | Not applicable                         |
| CKV_K8S_37 | Secrets in env vars          | Using K8s secrets, not hardcoded       |
| CKV_K8S_35 | Secret file permissions      | Default permissions acceptable         |
| CKV_K8S_8  | Liveness probe               | Minecraft startup is slow, handled     |
| CKV_K8S_9  | Readiness probe              | Custom RCON-based probe implemented    |
| CKV_K8S_29 | Apply security context       | Applied at pod level                   |
| CKV_K8S_30 | SecurityContext set          | Applied at pod level                   |
| CKV_K8S_31 | SecurityContext runAsNonRoot | Minecraft container requirements       |

#### 6. License Compliance

Checks for prohibited licenses:

```bash
license-checker --failOn "GPL;AGPL;LGPL;CPAL"
```

## Deploy Workflow (`.github/workflows/deploy.yml`)

Deployment pipeline with security gate.

### Triggers

- Push to `master` or `develop`
- Pull requests to `master` or `develop`
- Manual trigger

### Job Dependencies

```
security-scan (Gate)
       │
       ├──→ api-server-test
       ├──→ frontend-test
       └──→ operator-test
```

All build jobs depend on `security-scan` passing first.

### Security Gate

Trivy filesystem scan must pass before any builds run:

```yaml
security-scan:
  steps:
    - name: Run Trivy vulnerability scanner
      uses: aquasecurity/trivy-action@master
      with:
        exit-code: '1' # Fail on CRITICAL/HIGH
```

## Release Workflow (`.github/workflows/release.yml`)

Automated release pipeline for tagged versions.

### Triggers

- Push of tags matching `v*.*.*` (e.g., `v1.0.0`)
- Manual trigger with version input

### Jobs

#### 1. Build All Components

- Linting and type checking
- Build all three components
- Generate operator binaries for linux/amd64 and linux/arm64

#### 2. Docker Images

Multi-platform Docker builds for:

| Component  | Image                                         |
| ---------- | --------------------------------------------- |
| API Server | `ghcr.io/{owner}/{repo}/api-server:{version}` |
| Frontend   | `ghcr.io/{owner}/{repo}/frontend:{version}`   |
| Operator   | `ghcr.io/{owner}/{repo}/operator:{version}`   |

Features:

- Multi-arch: `linux/amd64`, `linux/arm64`
- Semantic version tags: `1.0.0`, `1.0`, `1`
- GitHub Actions cache for layer caching

#### 3. Helm Chart

- Updates Chart.yaml version
- Packages chart as `.tgz`
- Uploads as release artifact

#### 4. GitHub Release

- Generates changelog from commits
- Attaches operator binaries
- Attaches Helm chart
- Marks pre-releases for versions with `-` suffix

## DAST Workflow (`.github/workflows/dast.yml`)

Dynamic Application Security Testing using OWASP ZAP.

### Triggers

- Push to `master` or `develop` (baseline scan)
- Pull requests to `master` or `develop` (baseline scan)
- Manual trigger with custom options

### How It Works

The DAST workflow automatically:

1. Builds the API server
2. Creates a test `.env` configuration
3. Starts the API server in the background
4. Waits for health check to pass
5. Runs the ZAP security scan
6. Uploads the report as an artifact

### Manual Inputs

| Input      | Description                               | Options                   |
| ---------- | ----------------------------------------- | ------------------------- |
| target_url | URL to scan (empty = use built-in server) | Any valid URL             |
| scan_type  | Type of scan                              | `baseline`, `full`, `api` |

### Scan Types

| Type     | Duration | Coverage                         | Use Case       |
| -------- | -------- | -------------------------------- | -------------- |
| Baseline | ~5 min   | Passive scanning, common issues  | Every push/PR  |
| API      | ~10 min  | API-specific, endpoint discovery | API changes    |
| Full     | ~30+ min | Active scanning, comprehensive   | Pre-production |

### ZAP Rules

Custom rules defined in `.github/zap-rules.tsv`:

| Action | Description                                        |
| ------ | -------------------------------------------------- |
| IGNORE | Informational items (cache headers, version leaks) |
| WARN   | Low/medium risk (CSP, cookies, HSTS)               |
| FAIL   | High/critical (XSS, SQLi, injection, command exec) |

## Environment Variables

### Workflow Environment

| Variable     | Value   | Used In              |
| ------------ | ------- | -------------------- |
| GO_VERSION   | 1.24    | All Go-related steps |
| NODE_VERSION | 20      | All Node.js steps    |
| REGISTRY     | ghcr.io | Docker image pushes  |

### Required Secrets

| Secret       | Purpose                           |
| ------------ | --------------------------------- |
| GITHUB_TOKEN | Default, auto-provided by Actions |

### Application Environment

See `.env.example` files in each component:

- `api-server/.env.example` - API server configuration
- `frontend/.env.example` - Frontend configuration
- `k8s/operator/.env.example` - Operator configuration

**Required Variables (no defaults):**

| Variable             | Component  | Description                     |
| -------------------- | ---------- | ------------------------------- |
| PORT                 | api-server | HTTP server port                |
| K8S_NAMESPACE        | api-server | Kubernetes namespace to manage  |
| RCON_PASSWORD        | api-server | Minecraft RCON password         |
| CORS_ALLOWED_ORIGINS | api-server | Comma-separated allowed origins |

## Security Configuration

### Gitleaks (`.gitleaks.toml`)

Custom secret detection rules:

| Rule                    | Pattern                           |
| ----------------------- | --------------------------------- |
| kubernetes-secret       | K8s secret assignments            |
| minecraft-rcon-password | RCON password patterns            |
| database-connection     | postgres/mysql/mongodb URLs       |
| hardcoded-password      | Password assignments with entropy |
| jwt-secret              | JWT secret patterns               |
| api-key                 | API key patterns with entropy     |

**Allowlisted Paths:**

- `node_modules/`, `vendor/`, `dist/`, `bin/`
- Test files (`*_test.go`, `*.test.ts`, `*.spec.ts`)
- Test data directories (`testdata/`, `fixtures/`)
- Documentation files

### ZAP Rules (`.github/zap-rules.tsv`)

Security findings are categorized:

**FAIL (Blocking):**

- SQL Injection (all variants)
- Cross-Site Scripting (XSS)
- Command Injection
- XML External Entity (XXE)
- CRLF Injection
- Server-Side Code Injection

**WARN (Non-blocking):**

- Missing security headers (CSP, HSTS, X-Frame-Options)
- Cookie security flags
- Information disclosure

**IGNORE:**

- Cache headers
- Server version headers
- Timestamp disclosures

## Local Development

### Running Checks Locally

```bash
# Full lint check
npm run lint

# Individual linters
npm run lint:api       # API server ESLint
npm run lint:frontend  # Frontend ESLint
npm run lint:go        # Go golangci-lint

# Formatting
npm run format         # Fix formatting
npm run format:check   # Check formatting

# Type checking
npm run typecheck:api
npm run typecheck:frontend

# Go checks
cd k8s/operator
golangci-lint run ./...
go test -race ./...
govulncheck ./...
```

### Pre-commit Hooks

Configured via `lint-staged` in `package.json`:

```json
{
  "lint-staged": {
    "api-server/**/*.{ts,tsx}": ["prettier --write"],
    "frontend/**/*.{ts,tsx}": ["prettier --write"],
    "*.{js,jsx,json,md,css,scss}": ["prettier --write"],
    "k8s/operator/**/*.go": ["gofmt -w"]
  }
}
```

### Security Scans

```bash
# NPM audit
cd api-server && npm audit
cd frontend && npm audit

# Go vulnerability check
cd k8s/operator && govulncheck ./...

# Run Trivy locally
docker run --rm -v $(pwd):/src aquasec/trivy fs /src

# Run Semgrep locally
docker run --rm -v $(pwd):/src semgrep/semgrep scan --config auto /src
```

## Troubleshooting

### Common Failures

| Issue               | Cause                         | Solution                                    |
| ------------------- | ----------------------------- | ------------------------------------------- |
| Lint failures       | Code style violations         | Run `npm run format` and `npm run lint:fix` |
| Type errors         | TypeScript issues             | Run `npm run typecheck` locally             |
| Secret detection    | Potential secret in code      | Add to `.gitleaks.toml` allowlist if safe   |
| npm audit failure   | Vulnerable dependency         | Run `npm update` or `npm audit fix`         |
| govulncheck failure | Vulnerable Go module          | Update with `go get module@version`         |
| Trivy failure       | Container/file vulnerability  | Update affected packages                    |
| Checkov failure     | K8s security misconfiguration | Fix or add to `skip_check` if intentional   |

### Debugging Locally

```bash
# Reproduce CI environment
export NODE_VERSION=20
export GO_VERSION=1.24

# Install dependencies fresh
rm -rf node_modules
npm install

# Build all components
cd api-server && npm run build
cd ../frontend && npm run build
cd ../k8s/operator && go build -o bin/operator .
```

### Viewing Workflow Logs

```bash
# List recent workflow runs
gh run list --limit 10

# View specific run
gh run view <run-id>

# View failed step logs
gh run view <run-id> --log-failed
```

## Maintenance

### Updating Node.js Version

1. Update `env.NODE_VERSION` in all workflow files
2. Update `engines.node` in `package.json`
3. Update `.nvmrc` if present
4. Test locally before pushing

### Updating Go Version

1. Update `env.GO_VERSION` in all workflow files
2. Update `go.mod` in `k8s/operator`
3. Run `go mod tidy`
4. Test build locally

### Adding Security Exceptions

**Gitleaks allowlist:**

```toml
# In .gitleaks.toml
[allowlist]
paths = ['new/path/to/ignore']
regexes = ['pattern.*to.*allow']
```

**Checkov skip:**

```yaml
# In security.yml
skip_check: CKV_K8S_XX,CKV_K8S_YY
```

**ZAP rules:**

```tsv
# In .github/zap-rules.tsv
10XXX	IGNORE	Rule description
```
