package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/lib/pq"
)

func main() {
	// Get connection parameters from environment (container networking)
	host := getEnv("DB_HOST", "cockroachdb")
	port := getEnv("DB_PORT", "26257")
	dbname := getEnv("DB_NAME", "minecraft_platform")
	user := getEnv("DB_USER", "root")
	password := getEnv("DB_PASSWORD", "")
	sslmode := getEnv("DB_SSL_MODE", "disable")

	// Build connection string for container networking
	dsn := fmt.Sprintf("postgres://%s", user)
	if password != "" {
		dsn += ":" + password
	}
	dsn += fmt.Sprintf("@%s:%s/%s?sslmode=%s", host, port, dbname, sslmode)

	log.Printf("Testing container database connection...")
	log.Printf("Host: %s:%s", host, port)
	log.Printf("Database: %s", dbname)
	log.Printf("User: %s", user)

	// Test with both drivers
	drivers := []struct {
		name   string
		driver string
	}{
		{"pgx", "pgx"},
		{"lib/pq", "postgres"},
	}

	for _, driver := range drivers {
		log.Printf("Testing %s driver with DSN: %s", driver.name, dsn)

		db, err := sql.Open(driver.driver, dsn)
		if err != nil {
			log.Printf("❌ %s - Failed to open database: %v", driver.name, err)
			continue
		}
		defer db.Close()

		if err := db.Ping(); err != nil {
			log.Printf("❌ %s - Failed to ping database: %v", driver.name, err)
			continue
		}

		var result int
		err = db.QueryRow("SELECT 1").Scan(&result)
		if err != nil {
			log.Printf("❌ %s - Failed to query database: %v", driver.name, err)
			continue
		}

		log.Printf("✅ %s - Database connection successful! Query result: %d", driver.name, result)

		// Test creating the database if it doesn't exist
		_, err = db.Exec("CREATE DATABASE IF NOT EXISTS " + dbname)
		if err != nil {
			log.Printf("⚠️  %s - Failed to create database (may already exist): %v", driver.name, err)
		} else {
			log.Printf("✅ %s - Database creation/verification successful", driver.name)
		}

		return
	}

	log.Fatal("❌ All database drivers failed")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return strings.TrimSpace(value)
	}
	return defaultValue
}