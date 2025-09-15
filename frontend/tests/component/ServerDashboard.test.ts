import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ServerDashboard from '../../src/components/ServerDashboard.svelte'
import { writable } from 'svelte/store'

// Mock WebSocket
const mockWebSocket = {
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: WebSocket.OPEN
}

global.WebSocket = vi.fn(() => mockWebSocket) as any

// Mock fetch
global.fetch = vi.fn()

// Mock stores
const mockServers = writable([
  {
    id: 'server-1',
    name: 'Test Server 1',
    status: 'running',
    minecraft_version: '1.20.1',
    memory_limit: '2Gi',
    cpu_limit: '1000m',
    player_count: 5,
    max_players: 20,
    ip_address: '192.168.1.100',
    port: 25565
  },
  {
    id: 'server-2',
    name: 'Test Server 2',
    status: 'stopped',
    minecraft_version: '1.19.4',
    memory_limit: '4Gi',
    cpu_limit: '2000m',
    player_count: 0,
    max_players: 50,
    ip_address: '192.168.1.101',
    port: 25566
  }
])

const mockMetrics = writable({
  'server-1': {
    cpu_usage: 45.2,
    memory_usage: 67.8,
    tps: 19.8,
    player_count: 5
  },
  'server-2': {
    cpu_usage: 0,
    memory_usage: 12.1,
    tps: 0,
    player_count: 0
  }
})

// Mock the stores module
vi.mock('../../src/stores', () => ({
  servers: mockServers,
  metrics: mockMetrics,
  isLoading: writable(false),
  error: writable(null)
}))

describe('ServerDashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders server list correctly', async () => {
    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Test Server 1')).toBeInTheDocument()
      expect(screen.getByText('Test Server 2')).toBeInTheDocument()
    })

    // Check server status indicators
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('stopped')).toBeInTheDocument()

    // Check server details
    expect(screen.getByText('5/20 players')).toBeInTheDocument()
    expect(screen.getByText('0/50 players')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.100:25565')).toBeInTheDocument()
  })

  it('displays real-time metrics correctly', async () => {
    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      // Check CPU metrics
      expect(screen.getByText('45.2%')).toBeInTheDocument()

      // Check memory metrics
      expect(screen.getByText('67.8%')).toBeInTheDocument()

      // Check TPS
      expect(screen.getByText('19.8 TPS')).toBeInTheDocument()
    })
  })

  it('handles server creation form submission', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'new-server',
        name: 'New Test Server',
        status: 'creating'
      })
    })

    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    // Open create server modal
    const createButton = screen.getByText('Create Server')
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('Create New Server')).toBeInTheDocument()
    })

    // Fill out form
    const nameInput = screen.getByLabelText('Server Name')
    const versionSelect = screen.getByLabelText('Minecraft Version')
    const memoryInput = screen.getByLabelText('Memory Limit')

    await fireEvent.input(nameInput, { target: { value: 'New Test Server' } })
    await fireEvent.change(versionSelect, { target: { value: '1.20.1' } })
    await fireEvent.input(memoryInput, { target: { value: '2' } })

    // Submit form
    const submitButton = screen.getByText('Create Server')
    await fireEvent.click(submitButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': 'test-tenant'
        },
        body: JSON.stringify({
          name: 'New Test Server',
          minecraft_version: '1.20.1',
          memory_limit: '2Gi',
          cpu_limit: '1000m'
        })
      })
    })
  })

  it('handles server actions (start/stop/delete)', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    })

    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Test Server 1')).toBeInTheDocument()
    })

    // Test start server (on stopped server)
    const startButton = screen.getAllByText('Start')[0]
    await fireEvent.click(startButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/server-2/start', {
      method: 'POST',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })

    // Test stop server (on running server)
    const stopButton = screen.getAllByText('Stop')[0]
    await fireEvent.click(stopButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/server-1/stop', {
      method: 'POST',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })
  })

  it('handles WebSocket connection and messages', async () => {
    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    // Verify WebSocket connection was established
    await waitFor(() => {
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8080/ws?tenant_id=test-tenant')
    })

    // Simulate WebSocket message
    const messageHandler = mockWebSocket.addEventListener.mock.calls.find(
      call => call[0] === 'message'
    )[1]

    const mockMessage = {
      data: JSON.stringify({
        type: 'server_update',
        server_id: 'server-1',
        data: {
          status: 'running',
          player_count: 7,
          cpu_usage: 52.1,
          memory_usage: 71.3,
          tps: 19.9
        }
      })
    }

    messageHandler(mockMessage)

    // Check that metrics were updated
    await waitFor(() => {
      expect(screen.getByText('52.1%')).toBeInTheDocument()
      expect(screen.getByText('71.3%')).toBeInTheDocument()
      expect(screen.getByText('19.9 TPS')).toBeInTheDocument()
    })
  })

  it('displays empty state when no servers exist', async () => {
    mockServers.set([])

    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('No servers found')).toBeInTheDocument()
      expect(screen.getByText('Create your first Minecraft server to get started')).toBeInTheDocument()
    })
  })

  it('handles loading states correctly', async () => {
    const { rerender } = render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    // Mock loading state
    const mockIsLoading = writable(true)
    vi.doMock('../../src/stores', () => ({
      servers: mockServers,
      metrics: mockMetrics,
      isLoading: mockIsLoading,
      error: writable(null)
    }))

    await rerender({ tenantId: 'test-tenant' })

    await waitFor(() => {
      expect(screen.getByText('Loading servers...')).toBeInTheDocument()
    })
  })

  it('handles error states correctly', async () => {
    const mockError = writable('Failed to load servers')

    vi.doMock('../../src/stores', () => ({
      servers: mockServers,
      metrics: mockMetrics,
      isLoading: writable(false),
      error: mockError
    }))

    const { rerender } = render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await rerender({ tenantId: 'test-tenant' })

    await waitFor(() => {
      expect(screen.getByText('Error: Failed to load servers')).toBeInTheDocument()
    })
  })

  it('validates server creation form inputs', async () => {
    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    // Open create server modal
    const createButton = screen.getByText('Create Server')
    await fireEvent.click(createButton)

    // Try to submit empty form
    const submitButton = screen.getByText('Create Server')
    await fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Server name is required')).toBeInTheDocument()
      expect(screen.getByText('Please select a Minecraft version')).toBeInTheDocument()
    })

    // Test invalid memory input
    const memoryInput = screen.getByLabelText('Memory Limit')
    await fireEvent.input(memoryInput, { target: { value: '0' } })
    await fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Memory limit must be at least 1GB')).toBeInTheDocument()
    })
  })

  it('handles server deletion with confirmation', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Test Server 1')).toBeInTheDocument()
    })

    // Click delete button
    const deleteButton = screen.getAllByText('Delete')[0]
    await fireEvent.click(deleteButton)

    // Confirm deletion
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this server?')).toBeInTheDocument()
    })

    const confirmButton = screen.getByText('Yes, Delete')
    await fireEvent.click(confirmButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/server-1', {
      method: 'DELETE',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })
  })

  it('displays server connection information correctly', async () => {
    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100:25565')).toBeInTheDocument()
      expect(screen.getByText('192.168.1.101:25566')).toBeInTheDocument()
    })

    // Test copy connection info functionality
    const copyButton = screen.getAllByLabelText('Copy server address')[0]

    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })

    await fireEvent.click(copyButton)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('192.168.1.100:25565')
  })

  it('filters servers by status', async () => {
    render(ServerDashboard, {
      props: {
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Test Server 1')).toBeInTheDocument()
      expect(screen.getByText('Test Server 2')).toBeInTheDocument()
    })

    // Filter by running servers
    const runningFilter = screen.getByLabelText('Show running servers only')
    await fireEvent.click(runningFilter)

    await waitFor(() => {
      expect(screen.getByText('Test Server 1')).toBeInTheDocument()
      expect(screen.queryByText('Test Server 2')).not.toBeInTheDocument()
    })

    // Filter by stopped servers
    const stoppedFilter = screen.getByLabelText('Show stopped servers only')
    await fireEvent.click(stoppedFilter)

    await waitFor(() => {
      expect(screen.queryByText('Test Server 1')).not.toBeInTheDocument()
      expect(screen.getByText('Test Server 2')).toBeInTheDocument()
    })
  })
})