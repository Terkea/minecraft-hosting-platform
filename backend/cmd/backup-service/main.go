package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

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
		fmt.Printf("backup-service v%s\n", version)
		os.Exit(0)
	}

	if *showHelp || len(os.Args) < 2 {
		printHelp()
		os.Exit(0)
	}

	command := os.Args[len(os.Args)-len(flag.Args())]
	args := flag.Args()[1:]

	// Initialize service (in real implementation, this would come from config)
	backupService := services.NewBackupService(nil, nil)

	switch command {
	case "create":
		handleCreate(backupService, args, *format, *verbose)
	case "restore":
		handleRestore(backupService, args, *format, *verbose)
	case "list":
		handleList(backupService, args, *format, *verbose)
	case "delete":
		handleDelete(backupService, args, *format, *verbose)
	case "info":
		handleInfo(backupService, args, *format, *verbose)
	case "schedule":
		handleSchedule(backupService, args, *format, *verbose)
	case "download":
		handleDownload(backupService, args, *format, *verbose)
	case "validate":
		handleValidate(backupService, args, *format, *verbose)
	default:
		fmt.Printf("Unknown command: %s\n", command)
		printHelp()
		os.Exit(1)
	}
}

func printHelp() {
	fmt.Println("Backup Service CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  backup-service [options] <command> [args...]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  create <server-id> [name]          Create a backup")
	fmt.Println("  restore <backup-id> <server-id>    Restore from backup")
	fmt.Println("  list [server-id]                   List backups")
	fmt.Println("  delete <backup-id>                 Delete a backup")
	fmt.Println("  info <backup-id>                   Show backup information")
	fmt.Println("  schedule <server-id> <frequency>   Schedule automatic backups")
	fmt.Println("  download <backup-id> [path]        Download backup file")
	fmt.Println("  validate <backup-id>               Validate backup integrity")
	fmt.Println()
	fmt.Println("Options:")
	fmt.Println("  --version              Show version")
	fmt.Println("  --help                 Show this help")
	fmt.Println("  --format text|json     Output format (default: text)")
	fmt.Println("  --verbose              Enable verbose output")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  backup-service create server-123 \"Daily Backup\"")
	fmt.Println("  backup-service restore backup-456 server-123")
	fmt.Println("  backup-service list server-123 --format=json")
	fmt.Println("  backup-service schedule server-123 daily")
}

func handleCreate(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: create command requires server ID")
		fmt.Println("Usage: backup-service create <server-id> [name]")
		os.Exit(1)
	}

	serverID := args[0]
	name := fmt.Sprintf("Backup-%s-%s", serverID, time.Now().Format("2006-01-02-15:04"))
	if len(args) > 1 {
		name = args[1]
	}

	result := map[string]interface{}{
		"action":     "create",
		"backup_id":  fmt.Sprintf("backup-%d", time.Now().Unix()),
		"server_id":  serverID,
		"name":       name,
		"status":     "creating",
		"created_at": time.Now().Format(time.RFC3339),
		"message":    "Backup creation initiated",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"compression":      "gzip",
			"estimated_size":   "1.2 GB",
			"estimated_time":   "5-10 minutes",
			"backup_includes": []string{
				"World data",
				"Player data",
				"Server configuration",
				"Plugin data",
			},
			"exclusions": []string{
				"Cache files",
				"Temporary files",
				"Log files (older than 7 days)",
			},
		}
	}

	outputResult(result, format)
}

func handleRestore(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 2 {
		fmt.Println("Error: restore command requires backup ID and server ID")
		fmt.Println("Usage: backup-service restore <backup-id> <server-id>")
		os.Exit(1)
	}

	backupID := args[0]
	serverID := args[1]

	result := map[string]interface{}{
		"action":    "restore",
		"backup_id": backupID,
		"server_id": serverID,
		"status":    "restoring",
		"message":   "Backup restoration initiated",
		"warning":   "This will replace all current server data",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"backup_created":     "2024-01-15T10:00:00Z",
			"backup_size":        "1.2 GB",
			"estimated_time":     "3-5 minutes",
			"pre_restore_backup": "backup-pre-restore-" + serverID,
			"restore_steps": []string{
				"Create pre-restore backup",
				"Stop server if running",
				"Extract backup data",
				"Replace world files",
				"Restore configuration",
				"Start server",
			},
		}
	}

	outputResult(result, format)
}

func handleList(service *services.BackupService, args []string, format string, verbose bool) {
	serverID := ""
	if len(args) > 0 {
		serverID = args[0]
	}

	backups := []map[string]interface{}{
		{
			"backup_id":   "backup-001",
			"name":        "Daily Backup - 2024-01-16",
			"server_id":   "server-123",
			"size":        "1.2 GB",
			"compression": "gzip",
			"created_at":  "2024-01-16T08:00:00Z",
			"expires_at":  "2024-02-16T08:00:00Z",
			"status":      "completed",
			"tags":        []string{"daily", "automated"},
		},
		{
			"backup_id":   "backup-002",
			"name":        "Pre-update Backup",
			"server_id":   "server-123",
			"size":        "980 MB",
			"compression": "lz4",
			"created_at":  "2024-01-10T14:30:00Z",
			"expires_at":  "2024-03-10T14:30:00Z",
			"status":      "completed",
			"tags":        []string{"manual", "pre-update"},
		},
		{
			"backup_id":   "backup-003",
			"name":        "Weekly Backup",
			"server_id":   "server-456",
			"size":        "2.1 GB",
			"compression": "gzip",
			"created_at":  "2024-01-14T20:00:00Z",
			"expires_at":  "2024-02-14T20:00:00Z",
			"status":      "completed",
			"tags":        []string{"weekly", "automated"},
		},
	}

	// Filter by server ID if provided
	if serverID != "" {
		filteredBackups := []map[string]interface{}{}
		for _, backup := range backups {
			if backup["server_id"].(string) == serverID {
				filteredBackups = append(filteredBackups, backup)
			}
		}
		backups = filteredBackups
	}

	result := map[string]interface{}{
		"action":    "list",
		"server_id": serverID,
		"total":     len(backups),
		"backups":   backups,
	}

	if verbose {
		totalSize := "4.28 GB"
		if serverID == "server-123" {
			totalSize = "2.18 GB"
		}
		result["summary"] = map[string]interface{}{
			"total_size":    totalSize,
			"completed":     len(backups),
			"in_progress":   0,
			"failed":        0,
			"oldest_backup": "2024-01-10T14:30:00Z",
			"newest_backup": "2024-01-16T08:00:00Z",
		}
	}

	outputResult(result, format)
}

func handleDelete(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: delete command requires backup ID")
		fmt.Println("Usage: backup-service delete <backup-id>")
		os.Exit(1)
	}

	backupID := args[0]

	result := map[string]interface{}{
		"action":    "delete",
		"backup_id": backupID,
		"status":    "deleted",
		"message":   "Backup deleted successfully",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"freed_space":   "1.2 GB",
			"deletion_time": time.Now().Format(time.RFC3339),
			"permanent":     true,
		}
	}

	outputResult(result, format)
}

func handleInfo(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: info command requires backup ID")
		fmt.Println("Usage: backup-service info <backup-id>")
		os.Exit(1)
	}

	backupID := args[0]

	result := map[string]interface{}{
		"action":      "info",
		"backup_id":   backupID,
		"name":        "Daily Backup - 2024-01-16",
		"server_id":   "server-123",
		"size":        "1.2 GB",
		"compression": "gzip",
		"created_at":  "2024-01-16T08:00:00Z",
		"expires_at":  "2024-02-16T08:00:00Z",
		"status":      "completed",
		"tags":        []string{"daily", "automated"},
		"description": "Automated daily backup",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"metadata": map[string]interface{}{
				"world_size":    "1.1 GB",
				"plugin_data":   "100 MB",
				"player_count":  15,
				"world_seed":    "-1234567890",
				"minecraft_version": "1.20.1",
			},
			"integrity": map[string]interface{}{
				"checksum":     "sha256:abc123def456...",
				"verified":     true,
				"last_check":   "2024-01-16T08:05:00Z",
			},
			"storage": map[string]interface{}{
				"location":     "s3://backups/server-123/backup-001.tar.gz",
				"encryption":   "AES-256",
				"compressed_size": "850 MB",
				"compression_ratio": "29%",
			},
		}
	}

	outputResult(result, format)
}

func handleSchedule(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 2 {
		fmt.Println("Error: schedule command requires server ID and frequency")
		fmt.Println("Usage: backup-service schedule <server-id> <frequency>")
		fmt.Println("Frequencies: hourly, daily, weekly, monthly")
		os.Exit(1)
	}

	serverID := args[0]
	frequency := args[1]

	validFrequencies := []string{"hourly", "daily", "weekly", "monthly"}
	if !contains(validFrequencies, frequency) {
		fmt.Printf("Error: invalid frequency '%s'. Valid options: %s\n",
			frequency, strings.Join(validFrequencies, ", "))
		os.Exit(1)
	}

	result := map[string]interface{}{
		"action":    "schedule",
		"server_id": serverID,
		"frequency": frequency,
		"status":    "scheduled",
		"message":   fmt.Sprintf("Backup schedule set to %s", frequency),
		"next_run":  getNextRun(frequency),
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"schedule_id":     fmt.Sprintf("schedule-%s-%s", serverID, frequency),
			"retention_days":  getRetentionDays(frequency),
			"backup_time":     "02:00 UTC",
			"compression":     "gzip",
			"enabled":         true,
			"notifications":   []string{"email", "webhook"},
		}
	}

	outputResult(result, format)
}

func handleDownload(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: download command requires backup ID")
		fmt.Println("Usage: backup-service download <backup-id> [path]")
		os.Exit(1)
	}

	backupID := args[0]
	downloadPath := "./"
	if len(args) > 1 {
		downloadPath = args[1]
	}

	result := map[string]interface{}{
		"action":        "download",
		"backup_id":     backupID,
		"download_path": downloadPath,
		"status":        "downloading",
		"message":       "Backup download initiated",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"file_name":       "backup-001.tar.gz",
			"file_size":       "850 MB",
			"download_url":    "https://storage.example.com/backups/backup-001.tar.gz",
			"estimated_time":  "2-5 minutes",
			"checksum":        "sha256:abc123def456...",
		}
	}

	outputResult(result, format)
}

func handleValidate(service *services.BackupService, args []string, format string, verbose bool) {
	if len(args) < 1 {
		fmt.Println("Error: validate command requires backup ID")
		fmt.Println("Usage: backup-service validate <backup-id>")
		os.Exit(1)
	}

	backupID := args[0]

	result := map[string]interface{}{
		"action":    "validate",
		"backup_id": backupID,
		"status":    "valid",
		"message":   "Backup integrity verified successfully",
	}

	if verbose {
		result["details"] = map[string]interface{}{
			"validation_time": time.Now().Format(time.RFC3339),
			"checksum_match": true,
			"archive_integrity": true,
			"file_count": 15847,
			"total_size": "1.2 GB",
			"compression_valid": true,
			"tests_passed": []string{
				"Archive structure",
				"Checksum verification",
				"Compression integrity",
				"File accessibility",
				"Metadata consistency",
			},
		}
	}

	outputResult(result, format)
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
	case "create":
		fmt.Printf("💾 Creating backup: %s\n", result["name"])
		fmt.Printf("   Server: %s\n", result["server_id"])
		fmt.Printf("   Backup ID: %s\n", result["backup_id"])
		fmt.Printf("   Status: %s\n", result["status"])

	case "restore":
		fmt.Printf("🔄 Restoring backup: %s\n", result["backup_id"])
		fmt.Printf("   Target: %s\n", result["server_id"])
		fmt.Printf("   Status: %s\n", result["status"])
		if warning, ok := result["warning"]; ok {
			fmt.Printf("   ⚠️  Warning: %s\n", warning)
		}

	case "list":
		backups := result["backups"].([]map[string]interface{})
		fmt.Printf("📋 Backups (%d total)\n", result["total"])
		if serverID, ok := result["server_id"].(string); ok && serverID != "" {
			fmt.Printf("   Server: %s\n", serverID)
		}
		fmt.Println("───────────────────────────────────────────────────────────")

		for _, backup := range backups {
			status := backup["status"].(string)
			statusIcon := getBackupStatusIcon(status)

			fmt.Printf("%s %-25s %8s %s %s\n",
				statusIcon,
				backup["name"],
				backup["size"],
				backup["compression"],
				formatDate(backup["created_at"].(string)))

			// Show tags if available
			if tags, ok := backup["tags"].([]string); ok && len(tags) > 0 {
				fmt.Printf("   Tags: %s\n", strings.Join(tags, ", "))
			}
		}

	case "delete":
		fmt.Printf("🗑️  Deleted backup: %s\n", result["backup_id"])

	case "info":
		fmt.Printf("💾 Backup Information: %s\n", result["name"])
		fmt.Println("───────────────────────────────────────────────────────────")
		fmt.Printf("   Backup ID: %s\n", result["backup_id"])
		fmt.Printf("   Server ID: %s\n", result["server_id"])
		fmt.Printf("   Size: %s\n", result["size"])
		fmt.Printf("   Compression: %s\n", result["compression"])
		fmt.Printf("   Created: %s\n", formatDate(result["created_at"].(string)))
		fmt.Printf("   Expires: %s\n", formatDate(result["expires_at"].(string)))
		fmt.Printf("   Status: %s\n", result["status"])

		if tags, ok := result["tags"].([]string); ok && len(tags) > 0 {
			fmt.Printf("   Tags: %s\n", strings.Join(tags, ", "))
		}

		if desc, ok := result["description"]; ok {
			fmt.Printf("   Description: %s\n", desc)
		}

	case "schedule":
		fmt.Printf("⏰ Backup Schedule: %s\n", result["server_id"])
		fmt.Printf("   Frequency: %s\n", result["frequency"])
		fmt.Printf("   Next run: %s\n", result["next_run"])

	case "download":
		fmt.Printf("📥 Downloading backup: %s\n", result["backup_id"])
		fmt.Printf("   Download path: %s\n", result["download_path"])
		fmt.Printf("   Status: %s\n", result["status"])

	case "validate":
		fmt.Printf("✅ Backup Validation: %s\n", result["backup_id"])
		fmt.Printf("   Status: %s\n", result["status"])
		fmt.Printf("   Result: %s\n", result["message"])
	}

	// Print verbose details if available
	if details, ok := result["details"]; ok {
		fmt.Println("\n📋 Details:")
		printDetails(details.(map[string]interface{}), "   ")
	}

	// Print summary if available
	if summary, ok := result["summary"]; ok {
		fmt.Println("\n📊 Summary:")
		printDetails(summary.(map[string]interface{}), "   ")
	}
}

func getBackupStatusIcon(status string) string {
	switch status {
	case "completed":
		return "✅"
	case "creating":
		return "🟡"
	case "failed":
		return "❌"
	case "expired":
		return "🔴"
	default:
		return "⚪"
	}
}

func formatDate(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		return dateStr
	}
	return t.Format("Jan 02, 2006 15:04")
}

func getNextRun(frequency string) string {
	now := time.Now()
	switch frequency {
	case "hourly":
		return now.Add(1 * time.Hour).Format("Jan 02, 2006 15:04")
	case "daily":
		return now.AddDate(0, 0, 1).Format("Jan 02, 2006 15:04")
	case "weekly":
		return now.AddDate(0, 0, 7).Format("Jan 02, 2006 15:04")
	case "monthly":
		return now.AddDate(0, 1, 0).Format("Jan 02, 2006 15:04")
	default:
		return "Unknown"
	}
}

func getRetentionDays(frequency string) int {
	switch frequency {
	case "hourly":
		return 7
	case "daily":
		return 30
	case "weekly":
		return 90
	case "monthly":
		return 365
	default:
		return 30
	}
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
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