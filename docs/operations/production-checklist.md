# Production Deployment Checklist

This checklist must be completed before deploying to production.

## 1. Secrets Management

**File:** `k8s/security/secrets-management.yaml`

### Sealed Secrets

Generate real sealed secrets using kubeseal:

```bash
# Install kubeseal if not already installed
brew install kubeseal  # macOS
# or
wget https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/kubeseal-0.24.0-linux-amd64.tar.gz

# Generate sealed secrets
kubectl create secret generic minecraft-api-secrets \
  --from-literal=jwt-secret=$(openssl rand -base64 32) \
  --from-literal=encryption-key=$(openssl rand -base64 32) \
  --dry-run=client -o yaml | kubeseal --format yaml > sealed-secrets.yaml
```

Replace `REPLACE_WITH_SEALED_SECRET` placeholders in `secrets-management.yaml`.

### Encryption at Rest

Generate a new encryption key for Kubernetes secrets encryption:

```bash
head -c 32 /dev/urandom | base64
```

Replace the placeholder `c2VjcmV0IGlzIHNlY3VyZQ==` values in the EncryptionConfiguration.

Configure kube-apiserver with:

```
--encryption-provider-config=/path/to/encryption-config.yaml
```

### Vault Configuration

1. Replace `https://vault.example.com:8200` with your actual Vault server URL
2. Update the Kubernetes auth role name to match your Vault configuration
3. Configure the actual secret paths in Vault

## 2. TLS Certificates

### Cert-Manager

1. Update the email address in ClusterIssuer for Let's Encrypt notifications
2. Update DNS names to match your actual domains:
   - `api.minecraft-platform.com` -> your API domain
   - `dashboard.minecraft-platform.com` -> your dashboard domain

### Manual Certificates (if not using cert-manager)

Ensure TLS certificates are provisioned and stored in Kubernetes secrets.

## 3. Database

- [ ] CockroachDB cluster is provisioned and accessible
- [ ] Database credentials are stored in Vault/External Secrets
- [ ] Connection strings are updated in application configs
- [ ] Database backups are configured

## 4. Networking

- [ ] Ingress controller is deployed (nginx-ingress recommended)
- [ ] DNS records point to load balancer IPs
- [ ] Network policies are reviewed and applied
- [ ] Firewall rules allow required traffic

## 5. Monitoring & Alerting

- [ ] Prometheus is deployed and scraping metrics
- [ ] Grafana dashboards are configured
- [ ] Alert rules are configured in Prometheus/Alertmanager
- [ ] PagerDuty/Slack integrations are set up

## 6. Security

- [ ] RBAC policies are reviewed
- [ ] Pod Security Standards are enforced
- [ ] Network policies restrict pod-to-pod communication
- [ ] Secrets are not hardcoded anywhere
- [ ] All example/placeholder values are replaced

## 7. Scaling

- [ ] Horizontal Pod Autoscaler is configured
- [ ] Resource requests/limits are set appropriately
- [ ] Node autoscaling is configured (if using cloud provider)

## 8. Disaster Recovery

- [ ] Backup strategy is documented and tested
- [ ] Restore procedures are documented and tested
- [ ] RPO/RTO targets are defined

## Pre-Flight Checks

Run these commands before deploying:

```bash
# Validate Kubernetes manifests
kubectl apply --dry-run=client -f k8s/

# Check for placeholder values
grep -r "example.com" k8s/
grep -r "REPLACE_WITH" k8s/
grep -r "TODO" k8s/
grep -r "placeholder" k8s/

# Validate secrets are sealed (not plain text)
grep -r "kind: Secret" k8s/ | grep -v SealedSecret

# Run security scan
trivy fs k8s/
```

## Deployment Order

1. Namespaces and RBAC
2. Secrets (sealed secrets, external secrets operator)
3. ConfigMaps
4. Databases and stateful services
5. Backend services (API server, operator)
6. Frontend
7. Ingress and networking
8. Monitoring stack
