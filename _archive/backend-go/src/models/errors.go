package models

import "errors"

// Common validation errors
var (
	ErrTenantIDRequired     = errors.New("tenant_id is required")
	ErrServerIDRequired     = errors.New("server_id is required")
	ErrMetricTypeRequired   = errors.New("metric_type is required")
	ErrMetricNameRequired   = errors.New("metric_name is required")
	ErrMetricUnitRequired   = errors.New("metric_unit is required")
	ErrNameRequired         = errors.New("name is required")
	ErrInvalidStatus        = errors.New("invalid status")
	ErrInvalidTransition    = errors.New("invalid status transition")
	ErrNotFound             = errors.New("resource not found")
	ErrAlreadyExists        = errors.New("resource already exists")
	ErrInvalidConfiguration = errors.New("invalid configuration")
)
