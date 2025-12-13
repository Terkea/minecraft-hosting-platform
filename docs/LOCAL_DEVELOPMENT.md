# Local Development Setup

This guide explains how to start all services required for local development of the Minecraft Hosting Platform.

## Prerequisites

Ensure you have the following installed:

| Tool           | Version | Purpose                        |
| -------------- | ------- | ------------------------------ |
| Node.js        | 18+     | Backend and frontend runtime   |
| Docker Desktop | Latest  | Container runtime for minikube |
| Minikube       | Latest  | Local Kubernetes cluster       |
| kubectl        | Latest  | Kubernetes CLI                 |

## Services Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Local Machine                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  Frontend   │    │  Backend    │    │      Minikube       │  │
│  │  (Vite)     │───▶│  (Express)  │───▶│  ┌───────────────┐  │  │
│  │  :3000      │    │  :8080      │    │  │  CockroachDB  │  │  │
│  └─────────────┘    └─────────────┘    │  │  :26257       │  │  │
│                            │           │  ├───────────────┤  │  │
│                            │           │  │  MC Servers   │  │  │
│                            └──────────▶│  │  (Operator)   │  │  │
│                                        │  └───────────────┘  │  │
│                                        └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Startup Order

Services must be started in this order due to dependencies:

1. **Docker Desktop** - Required by minikube
2. **Minikube** - Hosts the database and Minecraft servers
3. **Port Forwards** - Expose k8s services to localhost
4. **Backend API** - Connects to database
5. **Frontend** - Connects to backend API

## Step-by-Step Startup

### 1. Start Docker Desktop

Open Docker Desktop and wait for it to fully start. You should see the Docker icon in your system tray indicating it's running.

**Verify:**

```bash
docker version
```

### 2. Start Minikube

```bash
minikube start
```

Wait for the cluster to be ready. This may take a few minutes on first start.

**Verify:**

```bash
minikube status
kubectl get nodes
```

Expected output:

```
minikube
type: Control Plane
host: Running
kubelet: Running
apiserver: Running
kubeconfig: Configured
```

### 3. Verify CockroachDB is Running

```bash
kubectl get pods | grep cockroach
```

If CockroachDB isn't deployed, deploy it:

```bash
kubectl apply -f k8s/manifests/cockroachdb.yaml
```

Wait for the pod to be ready:

```bash
kubectl wait --for=condition=ready pod -l app=cockroachdb --timeout=120s
```

### 4. Start Port Forwards

Open a **new terminal** for each port forward (they run in foreground):

**Terminal 1 - Database:**

```bash
kubectl port-forward svc/cockroachdb 26257:26257
```

**Terminal 2 - Backup Server (if needed):**

```bash
kubectl port-forward svc/backup-server 9090:9090
```

**Verify database connection:**

```bash
# In a new terminal
psql "postgresql://root@localhost:26257/minecraft_platform?sslmode=disable" -c "SELECT 1"
```

### 5. Start the Backend API

```bash
cd api-server
npm run dev
```

**Expected output:**

```
[K8sClient] Kubernetes configuration loaded successfully
[UserStore] Database connection initialized
[RefreshTokenStore] Database connection initialized
[Startup] Database connection established
Server running on port 8080
WebSocket server initialized
```

**Verify:**

```bash
curl http://localhost:8080/api/v1/health
```

### 6. Start the Frontend

```bash
cd frontend
npm run dev
```

**Expected output:**

```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:3000/
```

**Access the app:**
Open http://localhost:3000 in your browser.

## Quick Start Script

For convenience, you can create a startup script. On Windows (PowerShell):

```powershell
# start-dev.ps1
Write-Host "Starting development environment..." -ForegroundColor Green

# Check Docker
$docker = docker version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# Start minikube if not running
$status = minikube status 2>&1
if ($status -notmatch "Running") {
    Write-Host "Starting minikube..." -ForegroundColor Yellow
    minikube start
}

# Start port-forward in background
Write-Host "Starting port forwards..." -ForegroundColor Yellow
Start-Job -ScriptBlock { kubectl port-forward svc/cockroachdb 26257:26257 }

# Wait for port-forward
Start-Sleep -Seconds 3

# Start backend
Write-Host "Starting backend..." -ForegroundColor Yellow
Start-Process -FilePath "cmd" -ArgumentList "/c cd api-server && npm run dev"

# Start frontend
Write-Host "Starting frontend..." -ForegroundColor Yellow
Start-Process -FilePath "cmd" -ArgumentList "/c cd frontend && npm run dev"

Write-Host "Development environment started!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8080" -ForegroundColor Cyan
```

## Environment Variables

The backend requires environment variables in `api-server/.env`:

```env
# Database (CockroachDB via port-forward)
DATABASE_URL=postgresql://root@localhost:26257/minecraft_platform?sslmode=disable

# Server
PORT=8080
K8S_NAMESPACE=minecraft-servers

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Google OAuth (get from Google Cloud Console)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/auth/google/callback

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your-secret-key

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

See [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) for OAuth configuration.

## Common Issues

### Docker not running

```
Error: PROVIDER_DOCKER_NOT_RUNNING
```

**Solution:** Start Docker Desktop and wait for it to fully initialize.

### Database connection timeout

```
Error: Connection terminated due to connection timeout
```

**Solution:**

1. Ensure minikube is running: `minikube status`
2. Ensure CockroachDB pod is running: `kubectl get pods | grep cockroach`
3. Ensure port-forward is active: `kubectl port-forward svc/cockroachdb 26257:26257`

### Port already in use

```
Error: listen EADDRINUSE: address already in use :::8080
```

**Solution:** Find and kill the process using the port:

```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <pid> /F

# Linux/Mac
lsof -i :8080
kill -9 <pid>
```

### Minikube TLS handshake timeout

```
Error: Unable to connect to the server: TLS handshake timeout
```

**Solution:**

1. Restart Docker Desktop
2. Run `minikube delete` then `minikube start`

### OAuth redirect issues

```
Error: redirect_uri_mismatch
```

**Solution:** Ensure Google Cloud Console has the correct redirect URI:

- `http://localhost:8080/api/v1/auth/google/callback`

## Ports Reference

| Service        | Port  | Description                |
| -------------- | ----- | -------------------------- |
| Frontend       | 3000  | Vite dev server            |
| Backend API    | 8080  | Express server             |
| CockroachDB    | 26257 | PostgreSQL wire protocol   |
| CockroachDB UI | 8081  | Admin dashboard (optional) |
| Backup Server  | 9090  | Backup sidecar service     |

## Stopping Services

```bash
# Stop frontend/backend: Ctrl+C in their terminals

# Stop port-forwards: Ctrl+C in their terminals

# Stop minikube (optional, preserves data)
minikube stop

# Delete minikube (removes all data)
minikube delete
```

## Useful Commands

```bash
# View backend logs
cd api-server && npm run dev

# View Kubernetes logs
kubectl logs -f deployment/minecraft-operator

# Access CockroachDB SQL shell
kubectl exec -it cockroachdb-0 -- cockroach sql --insecure

# View all pods
kubectl get pods -A

# Restart a deployment
kubectl rollout restart deployment/<name>
```
