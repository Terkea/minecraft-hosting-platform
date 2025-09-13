#!/bin/bash

# Development Setup Script for Minecraft Server Platform
set -e

echo "🚀 Setting up Minecraft Server Platform for development..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists go; then
    echo "❌ Go is not installed. Please install Go 1.21+ from https://golang.org"
    exit 1
fi

if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is not installed. Please install npm"
    exit 1
fi

echo "✅ Prerequisites check complete"

# Setup backend
echo "🔧 Setting up backend..."
cd backend

# Create .env from example if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "📝 Created .env file from template. Please update with your configuration."
fi

# Install pre-commit if available
if command_exists pre-commit; then
    echo "🪝 Installing pre-commit hooks..."
    cd ..
    pre-commit install
    cd backend
else
    echo "⚠️  pre-commit not installed. Run 'pip install pre-commit' for commit hooks."
fi

echo "✅ Backend setup complete"

# Setup frontend
echo "🎨 Setting up frontend..."
cd ../frontend

echo "✅ Frontend setup complete"

# Setup development tools
echo "🛠️  Setting up development tools..."

# Create helpful scripts
cd ..
mkdir -p scripts

# Create start script
cat > scripts/dev-start.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting development servers..."

# Start backend in background
echo "🔧 Starting backend API server..."
cd backend && make run &
BACKEND_PID=$!

# Start frontend in background
echo "🎨 Starting frontend dev server..."
cd ../frontend && npm run dev &
FRONTEND_PID=$!

# Function to cleanup background processes
cleanup() {
    echo "🛑 Stopping development servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}

# Setup signal handlers
trap cleanup SIGINT SIGTERM

echo "✅ Development servers started!"
echo "📱 Frontend: http://localhost:5173"
echo "🔧 Backend API: http://localhost:8080"
echo "📖 API Docs: http://localhost:8080/swagger/index.html"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for background processes
wait
EOF

chmod +x scripts/dev-start.sh

# Create test script
cat > scripts/test-all.sh << 'EOF'
#!/bin/bash
echo "🧪 Running all tests..."

# Run backend tests
echo "🔧 Running backend tests..."
cd backend
echo "  📝 Contract tests..."
make test-contract
echo "  🔗 Integration tests..."
make test-integration
echo "  📊 Unit tests..."
make test

# Run frontend tests
echo "🎨 Running frontend tests..."
cd ../frontend
echo "  🧩 Component tests..."
npm run test
echo "  🎭 E2E tests..."
npm run test:e2e

echo "✅ All tests completed!"
EOF

chmod +x scripts/test-all.sh

echo "✅ Development tools setup complete"

echo ""
echo "🎉 Setup complete! Next steps:"
echo ""
echo "1. Update backend/.env with your database and configuration"
echo "2. Start development servers: ./scripts/dev-start.sh"
echo "3. Run tests: ./scripts/test-all.sh"
echo ""
echo "📚 Documentation:"
echo "  - Implementation plan: specs/001-create-a-cloud/plan.md"
echo "  - Task breakdown: specs/001-create-a-cloud/tasks.md"
echo "  - Development guidelines: CLAUDE.md"
echo ""
echo "🚀 Happy coding!"