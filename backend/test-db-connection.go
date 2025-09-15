package main

import (
	"database/sql"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	// Simple connection test
	dsn := "postgres://root@localhost:26257/minecraft_platform?sslmode=disable"

	log.Printf("Testing connection with DSN: %s", dsn)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	var result int
	err = db.QueryRow("SELECT 1").Scan(&result)
	if err != nil {
		log.Fatalf("Failed to query database: %v", err)
	}

	log.Printf("✅ Database connection successful! Query result: %d", result)
}