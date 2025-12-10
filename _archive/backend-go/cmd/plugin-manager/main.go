package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"minecraft-platform/src/services"
)

const version = "1.0.0"

func main() {
	var (
		showVersion = flag.Bool("version", false, "Show version information")
		showHelp    = flag.Bool("help", false, "Show help information")
		format      = flag.String("format", "text", "Output format (text, json)")
		verbose     = flag.Bool("verbose", false, "Enable verbose output")
	)

	flag.Parse()

	if *showVersion {
		fmt.Printf("plugin-manager v%s\n", version)
		os.Exit(0)
	}

	if *showHelp || len(os.Args) < 2 {
		printHelp()
		os.Exit(0)
	}

	command := os.Args[len(os.Args)-len(flag.Args())]
	args := flag.Args()[1:]

	// Initialize service (in real implementation, this would come from config)
	pluginService := services.NewPluginManagerService(nil, nil)

	switch command {
	case "search":
		handleSearch(pluginService, args, *format, *verbose)
	case "install":
		handleInstall(pluginService, args, *format, *verbose)
	case "remove":
		handleRemove(pluginService, args, *format, *verbose)
	case "enable":
		handleEnable(pluginService, args, *format, *verbose)
	case "disable":
		handleDisable(pluginService, args, *format, *verbose)
	case "list":
		handleList(pluginService, args, *format, *verbose)
	case "info":
		handleInfo(pluginService, args, *format, *verbose)
	case "update":
		handleUpdate(pluginService, args, *format, *verbose)
	default:
		fmt.Printf("Unknown command: %s\n", command)
		printHelp()
		os.Exit(1)
	}
}

func printHelp() {
	fmt.Println("Plugin Manager CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  plugin-manager [options] <command> [args...]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  search <query>                     Search for plugins")
	fmt.Println("  install <plugin-id> [version]      Install a plugin")
	fmt.Println("  remove <plugin-id>                 Remove a plugin")
	fmt.Println("  enable <plugin-id>                 Enable a plugin")
	fmt.Println("  disable <plugin-id>                Disable a plugin")
	fmt.Println("  list [server-id]                   List installed plugins")
	fmt.Println("  info <plugin-id>                   Show plugin information")
	fmt.Println("  update [plugin-id]                 Update plugins")
	fmt.Println()
	fmt.Println("Options:")
	fmt.Println("  --version              Show version")
	fmt.Println("  --help                 Show this help")
	fmt.Println("  --format text|json     Output format (default: text)")
	fmt.Println("  --verbose              Enable verbose output")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  plugin-manager search worldedit")
	fmt.Println("  plugin-manager install worldedit 7.2.15")
	fmt.Println("  plugin-manager list server-123 --format=json")
	fmt.Println("  plugin-manager info essentials --verbose")
}

func handleSearch(service *services.PluginManagerService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: search command requires a query")
		fmt.Println("Usage: plugin-manager search <query>")
		os.Exit(1)
	}

	query := strings.Join(args, " ")

	// Mock search results
	plugins := []map[string]interface{}{
		{
			"id":          "worldedit",
			"name":        "WorldEdit",
			"description": "In-game world editor for Minecraft",
			"version":     "7.2.15",
			"author":      "sk89q",
			"category":    "Building",
			"downloads":   15000000,
			"rating":      4.8,
			"compatibility": []string{"1.19.0", "1.20.0", "1.20.1"},
		},
		{
			"id":          "essentials",
			"name":        "EssentialsX",
			"description": "Essential commands and features for your server",
			"version":     "2.20.1",
			"author":      "EssentialsX Team",
			"category":    "Admin Tools",
			"downloads":   25000000,
			"rating":      4.9,
			"compatibility": []string{"1.19.0", "1.20.0", "1.20.1"},
		},
	}

	// Filter based on query
	filteredPlugins := []map[string]interface{}{}
	for _, plugin := range plugins {
		if strings.Contains(strings.ToLower(plugin["name"].(string)), strings.ToLower(query)) ||
			strings.Contains(strings.ToLower(plugin["description"].(string)), strings.ToLower(query)) {
			filteredPlugins = append(filteredPlugins, plugin)
		}
	}

	result := map[string]interface{}{
		"action":  "search",
		"query":   query,
		"count":   len(filteredPlugins),
		"plugins": filteredPlugins,
	}

	outputResult(result, format)
}

func handleInstall(service *services.PluginManagerService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: install command requires plugin ID")
		fmt.Println("Usage: plugin-manager install <plugin-id> [version]")
		os.Exit(1)
	}

	pluginID := args[0]
	version := "latest"
	if len(args) > 1 {
		version = args[1]
	}

	result := map[string]interface{}{
		"action":    "install",
		"plugin_id": pluginID,
		"version":   version,
		"status":    "installing",
		"message":   "Plugin installation initiated",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"download_url":      fmt.Sprintf("https://plugins.example.com/%s/%s", pluginID, version),
			"installation_path": fmt.Sprintf("/plugins/%s.jar", pluginID),
			"dependencies":      []string{},
			"estimated_time":    "30s",
		}
	}

	outputResult(result, format)
}

func handleRemove(service *services.PluginManagerService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: remove command requires plugin ID")
		fmt.Println("Usage: plugin-manager remove <plugin-id>")
		os.Exit(1)
	}

	pluginID := args[0]

	result := map[string]interface{}{
		"action":    "remove",
		"plugin_id": pluginID,
		"status":    "removing",
		"message":   "Plugin removal initiated",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"backup_config":     true,
			"remove_data":       false,
			"cleanup_dependencies": true,
		}
	}

	outputResult(result, format)
}

func handleEnable(service *services.PluginManagerService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: enable command requires plugin ID")
		fmt.Println("Usage: plugin-manager enable <plugin-id>")
		os.Exit(1)
	}

	pluginID := args[0]

	result := map[string]interface{}{
		"action":    "enable",
		"plugin_id": pluginID,
		"status":    "enabled",
		"message":   "Plugin enabled successfully",
	}

	outputResult(result, format)
}

func handleDisable(service *services.PluginManagerService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: disable command requires plugin ID")
		fmt.Println("Usage: plugin-manager disable <plugin-id>")
		os.Exit(1)
	}

	pluginID := args[0]

	result := map[string]interface{}{
		"action":    "disable",
		"plugin_id": pluginID,
		"status":    "disabled",
		"message":   "Plugin disabled successfully",
	}

	outputResult(result, format)
}

func handleList(service *services.PluginManagerService, args []string, format string, verbose bool) {
	serverID := ""
	if len(args) > 0 {
		serverID = args[0]
	}

	plugins := []map[string]interface{}{
		{
			"id":      "essentials",
			"name":    "EssentialsX",
			"version": "2.20.1",
			"enabled": true,
			"status":  "running",
		},
		{
			"id":      "worldedit",
			"name":    "WorldEdit",
			"version": "7.2.15",
			"enabled": true,
			"status":  "running",
		},
		{
			"id":      "vault",
			"name":    "Vault",
			"version": "1.7.3",
			"enabled": true,
			"status":  "running",
		},
		{
			"id":      "luckperms",
			"name":    "LuckPerms",
			"version": "5.4.102",
			"enabled": false,
			"status":  "disabled",
		},
	}

	result := map[string]interface{}{
		"action":     "list",
		"server_id":  serverID,
		"total":      len(plugins),
		"enabled":    3,
		"disabled":   1,
		"plugins":    plugins,
	}

	outputResult(result, format)
}

func handleInfo(service *services.PluginManagerService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: info command requires plugin ID")
		fmt.Println("Usage: plugin-manager info <plugin-id>")
		os.Exit(1)
	}

	pluginID := args[0]

	result := map[string]interface{}{
		"action":      "info",
		"plugin_id":   pluginID,
		"name":        "WorldEdit",
		"description": "In-game world editor for Minecraft",
		"version":     "7.2.15",
		"author":      "sk89q",
		"website":     "https://enginehub.org/worldedit",
		"category":    "Building",
		"downloads":   15000000,
		"rating":      4.8,
		"size":        "2.5 MB",
		"compatibility": []string{"1.19.0", "1.20.0", "1.20.1"},
		"dependencies":  []string{},
		"permissions":   []string{"worldedit.*", "worldedit.selection.*"},
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"installation_date": "2024-01-15T10:00:00Z",
			"last_update":       "2024-01-10T14:30:00Z",
			"config_files":      []string{"config.yml", "worldedit.properties"},
			"commands": []string{
				"//wand", "//pos1", "//pos2", "//set", "//replace",
				"//copy", "//paste", "//undo", "//redo", "//expand",
			},
		}
	}

	outputResult(result, format)
}

func handleUpdate(service *services.PluginManagerService, args []string, format string, verbose bool) {
	pluginID := ""
	if len(args) > 0 {
		pluginID = args[0]
	}

	if pluginID == "" {
		// Update all plugins
		updates := []map[string]interface{}{
			{"id": "essentials", "current": "2.20.0", "available": "2.20.1", "status": "updated"},
			{"id": "worldedit", "current": "7.2.14", "available": "7.2.15", "status": "updated"},
		}

		result := map[string]interface{}{
			"action":  "update",
			"type":    "all",
			"count":   len(updates),
			"updates": updates,
		}

		outputResult(result, format)
	} else {
		// Update specific plugin
		result := map[string]interface{}{
			"action":           "update",
			"plugin_id":        pluginID,
			"current_version":  "7.2.14",
			"new_version":      "7.2.15",
			"status":           "updated",
			"message":          "Plugin updated successfully",
		}

		if verbose {
			result["details"] = map[string]interface{}{
				"changelog": []string{
					"Fixed world loading issues",
					"Improved performance",
					"Added new selection commands",
				},
				"backup_created": true,
				"restart_required": false,
			}
		}

		outputResult(result, format)
	}
}

func outputResult(result map[string]interface{}, format string) {
	switch format {
	case "json":
		output, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			log.Fatalf("Error formatting JSON: %v", err)
		}
		fmt.Println(string(output))
	case "text":
		outputText(result)
	default:
		fmt.Printf("Unknown format: %s\n", format)
		os.Exit(1)
	}
}

func outputText(result map[string]interface{}) {
	action := result["action"].(string)

	switch action {
	case "search":
		plugins := result["plugins"].([]map[string]interface{})
		fmt.Printf("🔍 Search Results for '%s' (%d found)\n", result["query"], result["count"])
		fmt.Println("───────────────────────────────────────────────────────────")

		for _, plugin := range plugins {
			fmt.Printf("📦 %-20s v%-10s ⭐%.1f 📥%s\n",
				plugin["name"],
				plugin["version"],
				plugin["rating"],
				formatDownloads(plugin["downloads"].(int)))
			fmt.Printf("   %s\n", plugin["description"])
			fmt.Printf("   Author: %s | Category: %s\n\n", plugin["author"], plugin["category"])
		}

	case "install":
		fmt.Printf("📥 Installing plugin: %s\n", result["plugin_id"])
		fmt.Printf("   Version: %s\n", result["version"])
		fmt.Printf("   Status: %s\n", result["status"])

	case "remove":
		fmt.Printf("🗑️  Removing plugin: %s\n", result["plugin_id"])
		fmt.Printf("   Status: %s\n", result["status"])

	case "enable":
		fmt.Printf("✅ Enabled plugin: %s\n", result["plugin_id"])

	case "disable":
		fmt.Printf("❌ Disabled plugin: %s\n", result["plugin_id"])

	case "list":
		plugins := result["plugins"].([]map[string]interface{})
		fmt.Printf("📋 Installed Plugins (%d total, %v enabled, %v disabled)\n",
			result["total"], result["enabled"], result["disabled"])
		fmt.Println("───────────────────────────────────────────────────────────")

		for _, plugin := range plugins {
			status := plugin["status"].(string)
			statusIcon := getPluginStatusIcon(status)
			enabledIcon := "❌"
			if plugin["enabled"].(bool) {
				enabledIcon = "✅"
			}

			fmt.Printf("%s %s %-20s v%-10s %s\n",
				statusIcon, enabledIcon, plugin["name"], plugin["version"], status)
		}

	case "info":
		fmt.Printf("📦 Plugin Information: %s\n", result["name"])
		fmt.Println("───────────────────────────────────────────────────────────")
		fmt.Printf("   Name: %s\n", result["name"])
		fmt.Printf("   Version: %s\n", result["version"])
		fmt.Printf("   Author: %s\n", result["author"])
		fmt.Printf("   Website: %s\n", result["website"])
		fmt.Printf("   Category: %s\n", result["category"])
		fmt.Printf("   Downloads: %s\n", formatDownloads(result["downloads"].(int)))
		fmt.Printf("   Rating: ⭐%.1f\n", result["rating"])
		fmt.Printf("   Size: %s\n", result["size"])
		fmt.Printf("   Description: %s\n", result["description"])

		// Compatibility
		if compatibility, ok := result["compatibility"].([]string); ok && len(compatibility) > 0 {
			fmt.Printf("   Compatible with: %s\n", strings.Join(compatibility, ", "))
		}

		// Dependencies
		if deps, ok := result["dependencies"].([]string); ok && len(deps) > 0 {
			fmt.Printf("   Dependencies: %s\n", strings.Join(deps, ", "))
		} else {
			fmt.Printf("   Dependencies: None\n")
		}

	case "update":
		if result["type"] == "all" {
			updates := result["updates"].([]map[string]interface{})
			fmt.Printf("🔄 Plugin Updates (%d plugins updated)\n", result["count"])
			fmt.Println("───────────────────────────────────────────────────────────")

			for _, update := range updates {
				fmt.Printf("✅ %-20s %s → %s\n",
					update["id"], update["current"], update["available"])
			}
		} else {
			fmt.Printf("🔄 Updated plugin: %s\n", result["plugin_id"])
			fmt.Printf("   %s → %s\n", result["current_version"], result["new_version"])
		}
	}

	// Print verbose details if available
	if details, ok := result["details"]; ok {
		fmt.Println("\n📋 Details:")
		printDetails(details.(map[string]interface{}), "   ")
	}
}

func getPluginStatusIcon(status string) string {
	switch status {
	case "running":
		return "🟢"
	case "disabled":
		return "🔴"
	case "error":
		return "❌"
	case "loading":
		return "🟡"
	default:
		return "⚪"
	}
}

func formatDownloads(downloads int) string {
	if downloads >= 1000000 {
		return fmt.Sprintf("%.1fM", float64(downloads)/1000000)
	} else if downloads >= 1000 {
		return fmt.Sprintf("%.1fK", float64(downloads)/1000)
	}
	return fmt.Sprintf("%d", downloads)
}

func printDetails(details map[string]interface{}, indent string) {
	for key, value := range details {
		switch v := value.(type) {
		case map[string]interface{}:
			fmt.Printf("%s%s:\n", indent, key)
			printDetails(v, indent+"  ")
		case []string:
			fmt.Printf("%s%s:\n", indent, key)
			for _, item := range v {
				fmt.Printf("%s  - %s\n", indent, item)
			}
		default:
			fmt.Printf("%s%s: %v\n", indent, key, value)
		}
	}
}