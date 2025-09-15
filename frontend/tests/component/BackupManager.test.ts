import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BackupManager from '../../src/components/BackupManager.svelte'
import { writable } from 'svelte/store'

// Mock fetch
global.fetch = vi.fn()

// Mock stores
const mockBackups = writable([
  {
    id: 'backup-1',
    name: 'Daily Backup - 2024-01-15',
    description: 'Automated daily backup',
    size: '1.2 GB',
    compression: 'gzip',
    created_at: '2024-01-15T08:00:00Z',
    expires_at: '2024-02-15T08:00:00Z',
    status: 'completed',
    progress: 100,
    tags: ['daily', 'automated'],
    metadata: {
      world_size: '1.1 GB',
      plugin_data: '100 MB'
    }
  },
  {
    id: 'backup-2',
    name: 'Pre-update Backup',
    description: 'Backup before major server update',
    size: '980 MB',
    compression: 'lz4',
    created_at: '2024-01-10T14:30:00Z',
    expires_at: '2024-03-10T14:30:00Z',
    status: 'completed',
    progress: 100,
    tags: ['manual', 'pre-update'],
    metadata: {
      world_size: '890 MB',
      plugin_data: '90 MB'
    }
  },
  {
    id: 'backup-3',
    name: 'Weekly Backup - In Progress',
    description: 'Weekly automated backup',
    size: '0 MB',
    compression: 'gzip',
    created_at: '2024-01-16T09:15:00Z',
    expires_at: '2024-02-16T09:15:00Z',
    status: 'creating',
    progress: 45,
    tags: ['weekly', 'automated'],
    metadata: {}
  }
])

vi.mock('../../src/stores', () => ({
  backups: mockBackups,
  isLoading: writable(false),
  error: writable(null)
}))

describe('BackupManager Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders backup list correctly', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Backup Manager')).toBeInTheDocument()
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
      expect(screen.getByText('Pre-update Backup')).toBeInTheDocument()
      expect(screen.getByText('Weekly Backup - In Progress')).toBeInTheDocument()
    })
  })

  it('displays backup information correctly', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      // Check backup sizes
      expect(screen.getByText('1.2 GB')).toBeInTheDocument()
      expect(screen.getByText('980 MB')).toBeInTheDocument()

      // Check compression types
      expect(screen.getByText('GZIP')).toBeInTheDocument()
      expect(screen.getByText('LZ4')).toBeInTheDocument()

      // Check statuses
      expect(screen.getByText('Completed')).toBeInTheDocument()
      expect(screen.getByText('Creating')).toBeInTheDocument()

      // Check progress bar for in-progress backup
      expect(screen.getByText('45%')).toBeInTheDocument()
    })
  })

  it('handles backup creation', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'backup-new',
        name: 'Manual Backup',
        status: 'creating'
      })
    })

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    // Open create backup modal
    const createButton = screen.getByText('Create Backup')
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('Create New Backup')).toBeInTheDocument()
    })

    // Fill out form
    const nameInput = screen.getByLabelText('Backup Name')
    const descInput = screen.getByLabelText('Description (optional)')
    const compressionSelect = screen.getByLabelText('Compression')

    await fireEvent.input(nameInput, { target: { value: 'Manual Backup' } })
    await fireEvent.input(descInput, { target: { value: 'Manual backup for testing' } })
    await fireEvent.change(compressionSelect, { target: { value: 'lz4' } })

    // Submit form
    const submitButton = screen.getByText('Create Backup')
    await fireEvent.click(submitButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/backups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'test-tenant'
      },
      body: JSON.stringify({
        name: 'Manual Backup',
        description: 'Manual backup for testing',
        compression: 'lz4',
        tags: []
      })
    })
  })

  it('handles backup restoration', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Backup restoration started'
      })
    })

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
    })

    // Click restore button
    const restoreButton = screen.getByLabelText('Restore Daily Backup - 2024-01-15')
    await fireEvent.click(restoreButton)

    // Confirm restoration
    await waitFor(() => {
      expect(screen.getByText('Restore Backup')).toBeInTheDocument()
      expect(screen.getByText('This will replace your current server data')).toBeInTheDocument()
    })

    // Check create pre-restore backup option
    const preBackupCheckbox = screen.getByLabelText('Create backup before restore')
    await fireEvent.click(preBackupCheckbox)

    const confirmButton = screen.getByText('Restore Backup')
    await fireEvent.click(confirmButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/backups/backup-1/restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'test-tenant'
      },
      body: JSON.stringify({
        create_pre_restore_backup: true,
        pre_restore_backup_name: 'Pre-restore backup - 2024-01-15'
      })
    })
  })

  it('handles backup deletion', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
    })

    // Click delete button
    const deleteButton = screen.getByLabelText('Delete Daily Backup - 2024-01-15')
    await fireEvent.click(deleteButton)

    // Confirm deletion
    await waitFor(() => {
      expect(screen.getByText('Delete Backup')).toBeInTheDocument()
      expect(screen.getByText('This action cannot be undone')).toBeInTheDocument()
    })

    const confirmButton = screen.getByText('Yes, Delete')
    await fireEvent.click(confirmButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/backups/backup-1', {
      method: 'DELETE',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })
  })

  it('filters backups by tags', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
      expect(screen.getByText('Pre-update Backup')).toBeInTheDocument()
      expect(screen.getByText('Weekly Backup - In Progress')).toBeInTheDocument()
    })

    // Filter by 'automated' tag
    const automatedFilter = screen.getByText('automated')
    await fireEvent.click(automatedFilter)

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
      expect(screen.queryByText('Pre-update Backup')).not.toBeInTheDocument()
      expect(screen.getByText('Weekly Backup - In Progress')).toBeInTheDocument()
    })

    // Filter by 'manual' tag
    const manualFilter = screen.getByText('manual')
    await fireEvent.click(manualFilter)

    await waitFor(() => {
      expect(screen.queryByText('Daily Backup - 2024-01-15')).not.toBeInTheDocument()
      expect(screen.getByText('Pre-update Backup')).toBeInTheDocument()
      expect(screen.queryByText('Weekly Backup - In Progress')).not.toBeInTheDocument()
    })
  })

  it('searches backups by name and description', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    const searchInput = screen.getByPlaceholderText('Search backups...')

    // Search for "daily"
    await fireEvent.input(searchInput, { target: { value: 'daily' } })

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
      expect(screen.queryByText('Pre-update Backup')).not.toBeInTheDocument()
      expect(screen.queryByText('Weekly Backup - In Progress')).not.toBeInTheDocument()
    })

    // Search for "update"
    await fireEvent.input(searchInput, { target: { value: 'update' } })

    await waitFor(() => {
      expect(screen.queryByText('Daily Backup - 2024-01-15')).not.toBeInTheDocument()
      expect(screen.getByText('Pre-update Backup')).toBeInTheDocument()
      expect(screen.queryByText('Weekly Backup - In Progress')).not.toBeInTheDocument()
    })
  })

  it('sorts backups by different criteria', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    // Test sorting by size
    const sortSelect = screen.getByLabelText('Sort by')
    await fireEvent.change(sortSelect, { target: { value: 'size' } })

    await waitFor(() => {
      const backupElements = screen.getAllByTestId('backup-card')
      expect(backupElements[0]).toHaveTextContent('Daily Backup - 2024-01-15') // 1.2 GB
      expect(backupElements[1]).toHaveTextContent('Pre-update Backup')         // 980 MB
    })

    // Test sorting by date
    await fireEvent.change(sortSelect, { target: { value: 'date' } })

    await waitFor(() => {
      const backupElements = screen.getAllByTestId('backup-card')
      expect(backupElements[0]).toHaveTextContent('Weekly Backup - In Progress') // Most recent
      expect(backupElements[1]).toHaveTextContent('Daily Backup - 2024-01-15')
    })
  })

  it('displays backup metadata correctly', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
    })

    // Click to expand backup details
    const detailsButton = screen.getByLabelText('View backup details for Daily Backup - 2024-01-15')
    await fireEvent.click(detailsButton)

    await waitFor(() => {
      expect(screen.getByText('World Size: 1.1 GB')).toBeInTheDocument()
      expect(screen.getByText('Plugin Data: 100 MB')).toBeInTheDocument()
      expect(screen.getByText('Created: Jan 15, 2024 08:00')).toBeInTheDocument()
      expect(screen.getByText('Expires: Feb 15, 2024 08:00')).toBeInTheDocument()
    })
  })

  it('handles backup scheduling', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        schedule_id: 'schedule-1'
      })
    })

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    // Open schedule backup modal
    const scheduleButton = screen.getByText('Schedule Backups')
    await fireEvent.click(scheduleButton)

    await waitFor(() => {
      expect(screen.getByText('Schedule Automatic Backups')).toBeInTheDocument()
    })

    // Configure schedule
    const enableCheckbox = screen.getByLabelText('Enable automatic backups')
    await fireEvent.click(enableCheckbox)

    const frequencySelect = screen.getByLabelText('Backup Frequency')
    await fireEvent.change(frequencySelect, { target: { value: 'daily' } })

    const timeInput = screen.getByLabelText('Backup Time')
    await fireEvent.input(timeInput, { target: { value: '02:00' } })

    const retentionInput = screen.getByLabelText('Keep backups for (days)')
    await fireEvent.input(retentionInput, { target: { value: '7' } })

    // Save schedule
    const saveButton = screen.getByText('Save Schedule')
    await fireEvent.click(saveButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/backup-schedules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'test-tenant'
      },
      body: JSON.stringify({
        enabled: true,
        frequency: 'daily',
        time: '02:00',
        retention_days: 7,
        compression: 'gzip'
      })
    })
  })

  it('displays backup progress for in-progress backups', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Weekly Backup - In Progress')).toBeInTheDocument()
    })

    // Check progress bar
    const progressBar = screen.getByRole('progressbar')
    expect(progressBar).toHaveAttribute('aria-valuenow', '45')
    expect(screen.getByText('45%')).toBeInTheDocument()

    // Check status
    expect(screen.getByText('Creating')).toBeInTheDocument()
  })

  it('validates backup creation form', async () => {
    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    // Open create backup modal
    const createButton = screen.getByText('Create Backup')
    await fireEvent.click(createButton)

    // Try to submit empty form
    const submitButton = screen.getByText('Create Backup')
    await fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Backup name is required')).toBeInTheDocument()
    })

    // Test name length validation
    const nameInput = screen.getByLabelText('Backup Name')
    await fireEvent.input(nameInput, { target: { value: 'a' } })
    await fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('Backup name must be at least 3 characters')).toBeInTheDocument()
    })
  })

  it('handles empty state when no backups exist', async () => {
    mockBackups.set([])

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('No backups found')).toBeInTheDocument()
      expect(screen.getByText('Create your first backup to protect your server data')).toBeInTheDocument()
    })
  })

  it('handles backup download', async () => {
    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:url')
    global.URL.revokeObjectURL = vi.fn()

    // Mock fetch for download
    global.fetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['backup data'], { type: 'application/gzip' })
    })

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Daily Backup - 2024-01-15')).toBeInTheDocument()
    })

    // Click download button
    const downloadButton = screen.getByLabelText('Download Daily Backup - 2024-01-15')
    await fireEvent.click(downloadButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/backups/backup-1/download', {
      method: 'GET',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled()
    })
  })

  it('displays expiration warnings for backups', async () => {
    // Add a backup that expires soon
    const expiringBackup = {
      id: 'backup-expiring',
      name: 'Expiring Backup',
      description: 'This backup expires tomorrow',
      size: '500 MB',
      compression: 'gzip',
      created_at: '2024-01-10T08:00:00Z',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
      status: 'completed',
      progress: 100,
      tags: ['manual'],
      metadata: {}
    }

    mockBackups.update(backups => [...backups, expiringBackup])

    render(BackupManager, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Expires in 1 day')).toBeInTheDocument()
      expect(screen.getByText('⚠️')).toBeInTheDocument() // Warning icon
    })
  })
})