# CI/CD Pipeline Documentation

This document provides comprehensive documentation of the CI/CD pipeline setup for the Minecraft Server Hosting Platform.

## Overview

The platform uses GitHub Actions for continuous integration and deployment with a multi-layered approach to quality assurance:

1. **CI Pipeline** - Code quality, linting, type checking, and builds
2. **Security Scanning** - SAST, secret detection, dependency scanning, and container scanning
3. **DAST** - Dynamic Application Security Testing with OWASP ZAP

## Pipeline Triggers

| Pipeline          | Push to Master | Push to Develop | Pull Request | Schedule      | Manual |
| ----------------- | -------------- | --------------- | ------------ | ------------- | ------ |
| CI                | Yes            | Yes             | Yes          | No            | No     |
| Security Scanning | Yes            | Yes             | Yes          | Daily 2AM UTC | Yes    |
| DAST              | Yes            | No              | No           | No            | Yes    |

## CI Workflow (`.github/workflows/ci.yml`)

### Jobs Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CI Pipeline                              │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│    Lint &   │ TypeScript  │  Build API  │   Build     │  Build  │
│   Format    │    Check    │   Server    │  Frontend   │ Operator│
├─────────────┴─────────────┴─────────────┴─────────────┴─────────┤
│                          Go Tests                                │
├─────────────────────────────────────────────────────────────────┤
│                       Secret Detection                           │
└─────────────────────────────────────────────────────────────────┘
```

### Job Details

#### 1. Lint & Format

Ensures code quality across all codebases:

- **Prettier** - Format checking for TypeScript, JavaScript, JSON, CSS
- **ESLint** - Linting for API server and frontend TypeScript
- **golangci-lint** - Linting for Go operator code

#### 2. TypeScript Check

Type checking for TypeScript projects:

- `api-server` - Node.js backend type verification
- `frontend` - React/Vite frontend type verification

#### 3. Build Jobs

Parallel build verification:

- **API Server** - TypeScript compilation to JavaScript
- **Frontend** - Vite production build with tree shaking
- **Operator** - Go binary compilation

#### 4. Go Tests

Runs the Go operator test suite with:

- Race condition detection (`-race`)
- Code coverage reporting to Codecov

#### 5. Secret Detection

Uses Gitleaks to detect secrets in the codebase:

- Scans full git history
- Uses custom rules defined in `.gitleaks.toml`
- Allowlists for development placeholders

### Concurrency Control

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This ensures only one CI run per branch executes at a time, canceling outdated runs.

## Security Scanning Workflow (`.github/workflows/security-scan.yml`)

### Comprehensive Security Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Scanning Pipeline                    │
├────────────────┬────────────────┬────────────────┬──────────────┤
│  SAST Scan     │  Secret Scan   │ Dependency Scan│   IaC Scan   │
│  (Semgrep +    │ (TruffleHog +  │    (Go + npm)  │  (Checkov +  │
│   CodeQL)      │   GitLeaks)    │                │  Terrascan)  │
├────────────────┴────────────────┴────────────────┴──────────────┤
│                       Container Scan                             │
│                  (Trivy + Snyk per image)                        │
├─────────────────────────────────────────────────────────────────┤
│                     Runtime Security                             │
│                     (Falco + OPA)                                │
├─────────────────────────────────────────────────────────────────┤
│                    Compliance Check                              │
│                  (CIS + NIST benchmarks)                         │
├─────────────────────────────────────────────────────────────────┤
│                   Security Report                                │
│              (Aggregated HTML report)                            │
└─────────────────────────────────────────────────────────────────┘
```

### Security Tools Used

| Category     | Tools                          | Purpose                                  |
| ------------ | ------------------------------ | ---------------------------------------- |
| SAST         | Semgrep, CodeQL                | Static code analysis for vulnerabilities |
| Secrets      | TruffleHog, GitLeaks           | Detect leaked credentials                |
| Dependencies | govulncheck, npm audit         | Vulnerable dependency detection          |
| IaC          | Checkov, Kube-score, Terrascan | Kubernetes/Docker security               |
| Containers   | Trivy, Snyk                    | Container image vulnerabilities          |
| Runtime      | Falco, OPA Gatekeeper          | Runtime security monitoring              |
| Compliance   | CIS Benchmark, NIST            | Security compliance validation           |

## DAST Workflow (`.github/workflows/dast.yml`)

### Dynamic Application Security Testing

Uses OWASP ZAP for runtime vulnerability scanning:

```
┌─────────────────────────────────────────────────────────────────┐
│                       DAST Pipeline                              │
├───────────────────────┬─────────────────────────────────────────┤
│  Manual Trigger       │  Push Trigger (Integration)              │
├───────────────────────┼─────────────────────────────────────────┤
│  - API Scan           │  1. Build API Server                     │
│  - Baseline Scan      │  2. Start local server                   │
│  - Full Scan          │  3. Run ZAP baseline scan                │
│                       │  4. Upload DAST report                   │
└───────────────────────┴─────────────────────────────────────────┘
```

### Scan Types

| Scan Type | Duration | Coverage              | When to Use |
| --------- | -------- | --------------------- | ----------- |
| Baseline  | ~5 min   | Basic vulnerabilities | Every push  |
| API       | ~10 min  | API-specific issues   | API changes |
| Full      | ~30+ min | Comprehensive         | Pre-release |

## Local Development Quality Gates

### Pre-commit Hooks

The project uses `lint-staged` with Husky for pre-commit quality checks:

```json
{
  "lint-staged": {
    "api-server/**/*.{ts,tsx}": ["prettier --write", "eslint --fix"],
    "frontend/**/*.{ts,tsx}": ["prettier --write", "eslint --fix"],
    "*.{js,jsx,json,md,css,scss}": ["prettier --write"],
    "k8s/operator/**/*.go": ["gofmt -w"]
  }
}
```

### Running Locally

```bash
# Run all linting
npm run lint

# Run specific linters
npm run lint:api       # API server ESLint
npm run lint:frontend  # Frontend ESLint

# Run formatting
npm run format         # Format all files
npm run format:check   # Check formatting

# Run type checking
npm run typecheck:api
npm run typecheck:frontend

# Run Go linter
cd k8s/operator && golangci-lint run
```

## ESLint Configuration

### API Server (`api-server/eslint.config.js`)

Uses ESLint 9 flat config with TypeScript support:

- `@typescript-eslint/recommended` rules
- Strict promise handling (`no-floating-promises`, `await-thenable`)
- No explicit `any` warnings (practical for API types)
- Prettier integration for formatting

### Frontend (`frontend/eslint.config.js`)

Additional React-specific rules:

- `react-hooks/exhaustive-deps` - Hook dependency validation
- `react-refresh/only-export-components` - Fast refresh support
- JSX best practices (self-closing, boolean values, curly braces)

## Secret Detection Configuration

### Gitleaks (`.gitleaks.toml`)

Custom rules for platform-specific secrets:

- Kubernetes secrets
- Minecraft RCON passwords
- Database connection strings
- JWT secrets
- API keys

Allowlist for development:

- Test fixtures and mocks
- Development placeholder values
- Go module checksums

## Troubleshooting

### Common CI Failures

| Issue            | Cause                 | Solution                          |
| ---------------- | --------------------- | --------------------------------- |
| Lint errors      | Code style violations | Run `npm run lint:fix` locally    |
| Type errors      | TypeScript issues     | Run `npm run typecheck` locally   |
| Secret detection | Potential secrets     | Review `.gitleaks.toml` allowlist |
| DAST timeout     | Server not starting   | Check API server health endpoint  |

### Debugging Locally

```bash
# Reproduce CI environment
export NODE_VERSION=20
export GO_VERSION=1.21

# Run exact CI commands
npm install
cd api-server && npm install && npm run build
cd ../frontend && npm install && npm run build
cd ../k8s/operator && go build -o bin/operator .
```

## Best Practices

1. **Always run `npm run lint` before committing** - Pre-commit hooks will catch issues
2. **Fix warnings, don't suppress them** - Warnings become errors in CI
3. **Keep dependencies updated** - Security scans flag vulnerable packages
4. **Review DAST reports** - Address high/critical findings promptly
5. **Test security changes locally** - Run `npm audit` before pushing

## Pipeline Maintenance

### Updating Node.js Version

1. Update `env.NODE_VERSION` in `.github/workflows/ci.yml`
2. Update `.nvmrc` if present
3. Update `package.json` engines field
4. Test locally before pushing

### Updating Go Version

1. Update `env.GO_VERSION` in `.github/workflows/ci.yml`
2. Update `go.mod` in `k8s/operator`
3. Run `go mod tidy` to update dependencies

### Adding New Security Rules

1. Add to `.gitleaks.toml` for secret patterns
2. Add to `.github/zap-rules.tsv` for DAST rules
3. Update Checkov policies for IaC rules
