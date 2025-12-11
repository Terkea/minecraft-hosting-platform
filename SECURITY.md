# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Use GitHub's private vulnerability reporting feature:
   - Go to the [Security tab](../../security)
   - Click "Report a vulnerability"
   - Provide detailed information about the vulnerability

### What to Include

- Type of vulnerability (e.g., XSS, SQL injection, authentication bypass)
- Steps to reproduce the issue
- Affected components/files
- Potential impact assessment
- Any suggested fixes (optional)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Depends on severity
  - Critical: 24-72 hours
  - High: 7 days
  - Medium: 30 days
  - Low: 90 days

### Security Measures

This project implements the following security measures:

- **SAST**: CodeQL, Semgrep static analysis
- **DAST**: OWASP ZAP dynamic security testing
- **Dependency Scanning**: Dependabot, npm audit, govulncheck, Trivy
- **IaC Scanning**: Checkov for Kubernetes manifests
- **Secret Scanning**: GitHub secret scanning enabled
- **OSSF Scorecard**: OpenSSF security best practices assessment

### Security Scanning Schedule

- **On every push/PR**: CodeQL, Semgrep, Trivy, Checkov, DAST
- **Weekly**: Full security scan, dependency updates
- **Continuous**: Dependabot monitoring

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who report valid vulnerabilities.
