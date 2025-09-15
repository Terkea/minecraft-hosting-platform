package main

import (
	"database/sql"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	// Test connection to CockroachDB container
	dsn := "postgres://root@localhost:26257/defaultdb?sslmode=disable"
	log.Printf("Testing connection with: %s", dsn)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	// Create database
	_, err = db.Exec("CREATE DATABASE IF NOT EXISTS minecraft_platform")
	if err != nil {
		log.Printf("Warning: Could not create database: %v", err)
	}

	// Test query
	var result int
	err = db.QueryRow("SELECT 1").Scan(&result)
	if err != nil {
		log.Fatalf("Failed to query database: %v", err)
	}

	log.Printf("✅ Database connection successful! Result: %d", result)
}