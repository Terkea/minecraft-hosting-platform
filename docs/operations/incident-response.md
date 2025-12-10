# Incident Response Playbook

## Overview

This document outlines the incident response procedures for the Minecraft hosting platform.

## Severity Levels

### Critical (P0)

- **Definition**: Complete service outage or data loss
- **Response Time**: 15 minutes
- **Examples**: API down, database unavailable, security breach

### High (P1)

- **Definition**: Significant functionality degradation
- **Response Time**: 1 hour
- **Examples**: High latency, partial service degradation

### Medium (P2)

- **Definition**: Minor functionality issues
- **Response Time**: 4 hours
- **Examples**: Non-critical feature bugs

### Low (P3)

- **Definition**: Cosmetic or minor issues
- **Response Time**: 24 hours
- **Examples**: UI inconsistencies

## Response Procedures

### 1. Detection and Alerting

```bash
# Check monitoring dashboards
open https://grafana.minecraft-platform.com/dashboards

# Verify alert status
kubectl get alerts -n minecraft-platform

# Check service health
curl -f https://api.minecraft-platform.com/health
```

### 2. Initial Response (First 5 minutes)

1. Acknowledge the incident
2. Assess severity level
3. Create incident channel: `#incident-YYYY-MM-DD-NNN`
4. Begin investigation

### 3. Investigation Commands

```bash
# Check pod status
kubectl get pods -n minecraft-platform

# Check recent deployments
kubectl rollout history deployment/api-server -n minecraft-platform

# Check logs
kubectl logs -f deployment/api-server -n minecraft-platform --tail=100

# Check metrics
kubectl top pods -n minecraft-platform

# Check cluster events
kubectl get events -n minecraft-platform --sort-by=.metadata.creationTimestamp
```

### 4. Common Issues and Solutions

#### API Server Down

```bash
# Check deployment status
kubectl get deployment api-server -n minecraft-platform

# Check pod logs
kubectl logs -l app=api-server -n minecraft-platform

# Restart if needed
kubectl rollout restart deployment/api-server -n minecraft-platform

# Scale up if resource constrained
kubectl scale deployment api-server --replicas=10 -n minecraft-platform
```

#### Database Connection Issues

```bash
# Check database pod status
kubectl get pods -l app=cockroachdb -n minecraft-platform

# Test database connectivity
kubectl exec -it cockroachdb-0 -n minecraft-platform -- cockroach sql --insecure

# Check connection pool metrics
kubectl exec -it deployment/api-server -n minecraft-platform -- curl localhost:8080/metrics | grep db_
```

#### High Memory Usage

```bash
# Identify memory-intensive pods
kubectl top pods -n minecraft-platform --sort-by=memory

# Check for memory leaks
kubectl exec -it deployment/api-server -n minecraft-platform -- curl localhost:8080/debug/pprof/heap

# Scale horizontally if needed
kubectl patch hpa api-server-hpa -n minecraft-platform -p '{"spec":{"maxReplicas":20}}'
```

## Escalation Matrix

| Severity | Primary           | Secondary     | Manager             |
| -------- | ----------------- | ------------- | ------------------- |
| P0       | On-call Engineer  | Lead Engineer | Engineering Manager |
| P1       | On-call Engineer  | Lead Engineer | -                   |
| P2       | Assigned Engineer | -             | -                   |
| P3       | Assigned Engineer | -             | -                   |

## Communication Templates

### Initial Alert

```
🚨 INCIDENT ALERT 🚨
Severity: P0
Service: Minecraft Platform API
Issue: Complete service outage
Impact: All users unable to access platform
Investigation: In progress
ETA: TBD
Incident Channel: #incident-2024-01-15-001
```

### Status Update

```
📊 INCIDENT UPDATE
Issue: Minecraft Platform API outage
Status: Investigating root cause
Progress: Identified database connection pool exhaustion
Next Steps: Scaling connection pool, monitoring recovery
ETA: 10 minutes
```

### Resolution

```
✅ INCIDENT RESOLVED
Issue: Minecraft Platform API outage
Resolution: Scaled database connection pool from 20 to 50 connections
Root Cause: Traffic spike exceeded connection pool capacity
Duration: 23 minutes
Post-mortem: Will be conducted within 24 hours
```

## Post-Incident Procedures

### 1. Immediate (Within 1 hour)

- [ ] Verify full service restoration
- [ ] Update monitoring thresholds if needed
- [ ] Document timeline in incident tracking system
- [ ] Schedule post-mortem meeting

### 2. Post-Mortem (Within 24 hours)

- [ ] Conduct blameless post-mortem
- [ ] Identify root cause and contributing factors
- [ ] Create action items for prevention
- [ ] Update runbooks and procedures
- [ ] Share learnings with team

### 3. Follow-up (Within 1 week)

- [ ] Implement prevention measures
- [ ] Update monitoring and alerting
- [ ] Conduct chaos engineering tests
- [ ] Update documentation
