import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import PluginMarketplace from '../../src/components/PluginMarketplace.svelte'
import { writable } from 'svelte/store'

// Mock fetch
global.fetch = vi.fn()

// Mock stores
const mockPlugins = writable([
  {
    id: 'worldedit',
    name: 'WorldEdit',
    description: 'In-game world editor for Minecraft',
    version: '7.2.15',
    author: 'sk89q',
    category: 'Building',
    downloads: 15000000,
    rating: 4.8,
    compatibility: ['1.19.0', '1.20.0', '1.20.1'],
    dependencies: [],
    installed: false,
    enabled: false,
    size: '2.5 MB',
    tags: ['building', 'editing', 'creative']
  },
  {
    id: 'essentials',
    name: 'EssentialsX',
    description: 'Essential commands and features for your server',
    version: '2.20.1',
    author: 'EssentialsX Team',
    category: 'Admin Tools',
    downloads: 25000000,
    rating: 4.9,
    compatibility: ['1.19.0', '1.20.0', '1.20.1'],
    dependencies: [],
    installed: true,
    enabled: true,
    size: '1.8 MB',
    tags: ['admin', 'commands', 'utilities']
  },
  {
    id: 'vault',
    name: 'Vault',
    description: 'Economy API for Bukkit/Spigot plugins',
    version: '1.7.3',
    author: 'MilkBowl',
    category: 'Economy',
    downloads: 12000000,
    rating: 4.6,
    compatibility: ['1.18.0', '1.19.0', '1.20.0', '1.20.1'],
    dependencies: [],
    installed: true,
    enabled: true,
    size: '0.8 MB',
    tags: ['economy', 'api', 'dependency']
  },
  {
    id: 'luckperms',
    name: 'LuckPerms',
    description: 'Advanced permissions system',
    version: '5.4.102',
    author: 'lucko',
    category: 'Admin Tools',
    downloads: 8000000,
    rating: 4.9,
    compatibility: ['1.19.0', '1.20.0', '1.20.1'],
    dependencies: ['vault'],
    installed: false,
    enabled: false,
    size: '3.2 MB',
    tags: ['permissions', 'admin', 'management']
  }
])

const mockInstalledPlugins = writable(['essentials', 'vault'])

vi.mock('../../src/stores', () => ({
  plugins: mockPlugins,
  installedPlugins: mockInstalledPlugins,
  isLoading: writable(false),
  error: writable(null)
}))

describe('PluginMarketplace Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders plugin marketplace correctly', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Plugin Marketplace')).toBeInTheDocument()
      expect(screen.getByText('WorldEdit')).toBeInTheDocument()
      expect(screen.getByText('EssentialsX')).toBeInTheDocument()
      expect(screen.getByText('LuckPerms')).toBeInTheDocument()
    })
  })

  it('displays plugin information correctly', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      // Check plugin details
      expect(screen.getByText('In-game world editor for Minecraft')).toBeInTheDocument()
      expect(screen.getByText('sk89q')).toBeInTheDocument()
      expect(screen.getByText('15.0M downloads')).toBeInTheDocument()
      expect(screen.getByText('4.8 ⭐')).toBeInTheDocument()
      expect(screen.getByText('2.5 MB')).toBeInTheDocument()

      // Check categories
      expect(screen.getByText('Building')).toBeInTheDocument()
      expect(screen.getByText('Admin Tools')).toBeInTheDocument()
      expect(screen.getByText('Economy')).toBeInTheDocument()
    })
  })

  it('filters plugins by category', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    // Filter by Building category
    const buildingFilter = screen.getByText('Building')
    await fireEvent.click(buildingFilter)

    await waitFor(() => {
      expect(screen.getByText('WorldEdit')).toBeInTheDocument()
      expect(screen.queryByText('EssentialsX')).not.toBeInTheDocument()
      expect(screen.queryByText('LuckPerms')).not.toBeInTheDocument()
    })

    // Filter by Admin Tools
    const adminFilter = screen.getByText('Admin Tools')
    await fireEvent.click(adminFilter)

    await waitFor(() => {
      expect(screen.queryByText('WorldEdit')).not.toBeInTheDocument()
      expect(screen.getByText('EssentialsX')).toBeInTheDocument()
      expect(screen.getByText('LuckPerms')).toBeInTheDocument()
    })
  })

  it('searches plugins by name and description', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    const searchInput = screen.getByPlaceholderText('Search plugins...')

    // Search for "world"
    await fireEvent.input(searchInput, { target: { value: 'world' } })

    await waitFor(() => {
      expect(screen.getByText('WorldEdit')).toBeInTheDocument()
      expect(screen.queryByText('EssentialsX')).not.toBeInTheDocument()
      expect(screen.queryByText('LuckPerms')).not.toBeInTheDocument()
    })

    // Search for "permissions"
    await fireEvent.input(searchInput, { target: { value: 'permissions' } })

    await waitFor(() => {
      expect(screen.queryByText('WorldEdit')).not.toBeInTheDocument()
      expect(screen.queryByText('EssentialsX')).not.toBeInTheDocument()
      expect(screen.getByText('LuckPerms')).toBeInTheDocument()
    })
  })

  it('handles plugin installation', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Plugin installed successfully'
      })
    })

    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('WorldEdit')).toBeInTheDocument()
    })

    // Install WorldEdit plugin
    const installButton = screen.getByLabelText('Install WorldEdit')
    await fireEvent.click(installButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/plugins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'test-tenant'
      },
      body: JSON.stringify({
        plugin_id: 'worldedit',
        version: '7.2.15'
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Installing...')).toBeInTheDocument()
    })
  })

  it('handles plugin removal', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Plugin removed successfully'
      })
    })

    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('EssentialsX')).toBeInTheDocument()
    })

    // Remove EssentialsX plugin
    const removeButton = screen.getByLabelText('Remove EssentialsX')
    await fireEvent.click(removeButton)

    // Confirm removal
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to remove this plugin?')).toBeInTheDocument()
    })

    const confirmButton = screen.getByText('Yes, Remove')
    await fireEvent.click(confirmButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/plugins/essentials', {
      method: 'DELETE',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })
  })

  it('handles plugin enable/disable', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    })

    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('EssentialsX')).toBeInTheDocument()
    })

    // Disable EssentialsX plugin
    const toggleButton = screen.getByLabelText('Disable EssentialsX')
    await fireEvent.click(toggleButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/plugins/essentials/disable', {
      method: 'POST',
      headers: {
        'X-Tenant-ID': 'test-tenant'
      }
    })
  })

  it('shows compatibility warnings', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.21.0' // Version not compatible with some plugins
      }
    })

    await waitFor(() => {
      // Vault should show compatibility warning (only supports up to 1.20.1)
      expect(screen.getByText('Not compatible with Minecraft 1.21.0')).toBeInTheDocument()
    })
  })

  it('displays plugin dependencies', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('LuckPerms')).toBeInTheDocument()
    })

    // Click to view LuckPerms details
    const pluginCard = screen.getByText('LuckPerms').closest('.plugin-card')
    const detailsButton = pluginCard?.querySelector('[aria-label="View plugin details"]')

    if (detailsButton) {
      await fireEvent.click(detailsButton)

      await waitFor(() => {
        expect(screen.getByText('Dependencies:')).toBeInTheDocument()
        expect(screen.getByText('Vault')).toBeInTheDocument()
        expect(screen.getByText('✓ Installed')).toBeInTheDocument()
      })
    }
  })

  it('handles plugin installation with dependencies', async () => {
    // Mock successful installation
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Plugin and dependencies installed successfully',
        installed_dependencies: ['vault']
      })
    })

    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    // Make vault not installed for this test
    mockInstalledPlugins.set(['essentials'])

    await waitFor(() => {
      expect(screen.getByText('LuckPerms')).toBeInTheDocument()
    })

    // Install LuckPerms which depends on Vault
    const installButton = screen.getByLabelText('Install LuckPerms')
    await fireEvent.click(installButton)

    // Should show dependency installation dialog
    await waitFor(() => {
      expect(screen.getByText('This plugin requires the following dependencies:')).toBeInTheDocument()
      expect(screen.getByText('Vault (not installed)')).toBeInTheDocument()
    })

    const proceedButton = screen.getByText('Install with Dependencies')
    await fireEvent.click(proceedButton)

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/servers/test-server/plugins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'test-tenant'
      },
      body: JSON.stringify({
        plugin_id: 'luckperms',
        version: '5.4.102',
        install_dependencies: true
      })
    })
  })

  it('filters plugins by installation status', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    // Filter to show only installed plugins
    const installedFilter = screen.getByLabelText('Show installed plugins only')
    await fireEvent.click(installedFilter)

    await waitFor(() => {
      expect(screen.queryByText('WorldEdit')).not.toBeInTheDocument()
      expect(screen.getByText('EssentialsX')).toBeInTheDocument()
      expect(screen.getByText('Vault')).toBeInTheDocument()
      expect(screen.queryByText('LuckPerms')).not.toBeInTheDocument()
    })

    // Filter to show only available plugins
    const availableFilter = screen.getByLabelText('Show available plugins only')
    await fireEvent.click(availableFilter)

    await waitFor(() => {
      expect(screen.getByText('WorldEdit')).toBeInTheDocument()
      expect(screen.queryByText('EssentialsX')).not.toBeInTheDocument()
      expect(screen.queryByText('Vault')).not.toBeInTheDocument()
      expect(screen.getByText('LuckPerms')).toBeInTheDocument()
    })
  })

  it('displays empty state for no search results', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    const searchInput = screen.getByPlaceholderText('Search plugins...')
    await fireEvent.input(searchInput, { target: { value: 'nonexistentplugin' } })

    await waitFor(() => {
      expect(screen.getByText('No plugins found')).toBeInTheDocument()
      expect(screen.getByText('Try adjusting your search or filter criteria')).toBeInTheDocument()
    })
  })

  it('handles installation errors gracefully', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'))

    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('WorldEdit')).toBeInTheDocument()
    })

    const installButton = screen.getByLabelText('Install WorldEdit')
    await fireEvent.click(installButton)

    await waitFor(() => {
      expect(screen.getByText('Failed to install plugin')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('sorts plugins by different criteria', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    // Test sorting by downloads
    const sortSelect = screen.getByLabelText('Sort by')
    await fireEvent.change(sortSelect, { target: { value: 'downloads' } })

    await waitFor(() => {
      const pluginElements = screen.getAllByTestId('plugin-card')
      expect(pluginElements[0]).toHaveTextContent('EssentialsX') // Highest downloads
      expect(pluginElements[1]).toHaveTextContent('WorldEdit')
    })

    // Test sorting by rating
    await fireEvent.change(sortSelect, { target: { value: 'rating' } })

    await waitFor(() => {
      const pluginElements = screen.getAllByTestId('plugin-card')
      expect(pluginElements[0]).toHaveTextContent('EssentialsX') // 4.9 rating
      expect(pluginElements[1]).toHaveTextContent('LuckPerms')   // 4.9 rating
    })
  })

  it('displays plugin configuration options for installed plugins', async () => {
    render(PluginMarketplace, {
      props: {
        serverId: 'test-server',
        tenantId: 'test-tenant',
        minecraftVersion: '1.20.1'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('EssentialsX')).toBeInTheDocument()
    })

    // Click configure button for installed plugin
    const configureButton = screen.getByLabelText('Configure EssentialsX')
    await fireEvent.click(configureButton)

    await waitFor(() => {
      expect(screen.getByText('Plugin Configuration: EssentialsX')).toBeInTheDocument()
      expect(screen.getByText('Edit configuration files and settings')).toBeInTheDocument()
    })
  })
})