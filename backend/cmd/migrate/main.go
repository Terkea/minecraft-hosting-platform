package main

import (
	"flag"
	"log"
	"os"
	"strconv"

	"minecraft-platform/src/database"
	"gorm.io/gorm/logger"
)

func main() {
	var (
		host     = flag.String("host", getEnv("DB_HOST", "localhost"), "Database host")
		port     = flag.String("port", getEnv("DB_PORT", "26257"), "Database port")
		user     = flag.String("user", getEnv("DB_USER", "root"), "Database user")
		password = flag.String("password", getEnv("DB_PASSWORD", ""), "Database password")
		dbname   = flag.String("dbname", getEnv("DB_NAME", "minecraft_platform"), "Database name")
		sslmode  = flag.String("sslmode", getEnv("DB_SSL_MODE", "disable"), "SSL mode")
		action   = flag.String("action", "up", "Migration action: up, down, status")
	)
	flag.Parse()

	portInt, err := strconv.Atoi(*port)
	if err != nil {
		log.Fatalf("Invalid port: %v", err)
	}

	config := &database.DatabaseConfig{
		Host:         *host,
		Port:         portInt,
		Username:     *user,
		Password:     *password,
		DatabaseName: *dbname,
		SSLMode:      *sslmode,
		MaxOpenConns: 25,
		MaxIdleConns: 5,
		LogLevel:     logger.Info,
	}

	log.Printf("Connecting to database: %s@%s:%d/%s", *user, *host, portInt, *dbname)

	db, err := database.NewDatabase(config)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	switch *action {
	case "up":
		log.Println("Running database migrations...")
		if err := db.AutoMigrate(); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		log.Println("✅ Migrations completed successfully!")

	case "status":
		log.Println("Checking database connection...")
		sqlDB, err := db.DB.DB()
		if err != nil {
			log.Fatalf("Failed to get database handle: %v", err)
		}

		if err := sqlDB.Ping(); err != nil {
			log.Fatalf("Database ping failed: %v", err)
		}
		log.Println("✅ Database connection is healthy!")

	default:
		log.Fatalf("Unknown action: %s. Supported actions: up, status", *action)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}