package models

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
)

// UserAccount represents a customer account with associated servers, permissions, and billing
type UserAccount struct {
	ID        uuid.UUID `json:"id" db:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Email     string    `json:"email" db:"email" gorm:"uniqueIndex;not null" validate:"required,email,max=255"`
	Name      string    `json:"name" db:"name" gorm:"not null" validate:"required,min=1,max=100"`
	TenantID  uuid.UUID `json:"tenant_id" db:"tenant_id" gorm:"type:uuid;not null;index" validate:"required"`
	CreatedAt time.Time `json:"created_at" db:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at" gorm:"autoUpdateTime"`
}

// UserAccountRepository defines the interface for User Account data operations
type UserAccountRepository interface {
	Create(ctx context.Context, account *UserAccount) error
	GetByID(ctx context.Context, id uuid.UUID) (*UserAccount, error)
	GetByEmail(ctx context.Context, email string) (*UserAccount, error)
	GetByTenant(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]*UserAccount, error)
	Update(ctx context.Context, account *UserAccount) error
	Delete(ctx context.Context, id uuid.UUID) error
	Exists(ctx context.Context, email string) (bool, error)
}

// TableName returns the table name for GORM
func (UserAccount) TableName() string {
	return "user_accounts"
}

// Validate performs comprehensive validation on the UserAccount
func (u *UserAccount) Validate() error {
	if u.Email == "" {
		return errors.New("email is required")
	}

	if !isValidEmail(u.Email) {
		return errors.New("email must be a valid email address")
	}

	if len(u.Email) > 255 {
		return errors.New("email must be 255 characters or less")
	}

	if u.Name == "" {
		return errors.New("name is required")
	}

	if len(u.Name) < 1 || len(u.Name) > 100 {
		return errors.New("name must be between 1 and 100 characters")
	}

	if u.TenantID == uuid.Nil {
		return errors.New("tenant_id is required")
	}

	return nil
}

// BeforeCreate is called before creating a new UserAccount
func (u *UserAccount) BeforeCreate() error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}

	if u.TenantID == uuid.Nil {
		// For single-tenant scenarios, set tenant_id to user ID
		u.TenantID = u.ID
	}

	now := time.Now().UTC()
	u.CreatedAt = now
	u.UpdatedAt = now

	return u.Validate()
}

// BeforeUpdate is called before updating a UserAccount
func (u *UserAccount) BeforeUpdate() error {
	u.UpdatedAt = time.Now().UTC()
	return u.Validate()
}

// IsOwner checks if this user account owns the given tenant ID
func (u *UserAccount) IsOwner(tenantID uuid.UUID) bool {
	return u.TenantID == tenantID
}

// CanAccessTenant checks if this user has access to the specified tenant
func (u *UserAccount) CanAccessTenant(tenantID uuid.UUID) bool {
	// For now, users can only access their own tenant
	// In the future, this could support shared access or admin roles
	return u.TenantID == tenantID
}

// Value implements the driver.Valuer interface for database storage
func (u UserAccount) Value() (driver.Value, error) {
	return u.ID.String(), nil
}

// Scan implements the sql.Scanner interface for database retrieval
func (u *UserAccount) Scan(value interface{}) error {
	if value == nil {
		u.ID = uuid.Nil
		return nil
	}

	switch v := value.(type) {
	case string:
		id, err := uuid.Parse(v)
		if err != nil {
			return err
		}
		u.ID = id
		return nil
	case []byte:
		id, err := uuid.ParseBytes(v)
		if err != nil {
			return err
		}
		u.ID = id
		return nil
	default:
		return fmt.Errorf("cannot scan %T into UserAccount.ID", value)
	}
}

// CreateUserAccountTable returns the SQL DDL for creating the user_accounts table
func CreateUserAccountTable() string {
	return `
CREATE TABLE IF NOT EXISTS user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Indexes for performance
    INDEX idx_user_accounts_email (email),
    INDEX idx_user_accounts_tenant_id (tenant_id),
    INDEX idx_user_accounts_created_at (created_at)
);

-- Row-level security for multi-tenant isolation
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own tenant's data
CREATE POLICY user_accounts_tenant_isolation ON user_accounts
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_accounts_updated_at
    BEFORE UPDATE ON user_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`
}

// DropUserAccountTable returns the SQL DDL for dropping the user_accounts table
func DropUserAccountTable() string {
	return `
DROP TRIGGER IF EXISTS update_user_accounts_updated_at ON user_accounts;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP POLICY IF EXISTS user_accounts_tenant_isolation ON user_accounts;
DROP TABLE IF EXISTS user_accounts CASCADE;
`
}

// isValidEmail validates email format using regex
func isValidEmail(email string) bool {
	// RFC 5322 compliant email regex (simplified version)
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

// UserAccountCreateRequest represents the request payload for creating a user account
type UserAccountCreateRequest struct {
	Email string `json:"email" validate:"required,email,max=255"`
	Name  string `json:"name" validate:"required,min=1,max=100"`
}

// ToUserAccount converts the create request to a UserAccount model
func (r *UserAccountCreateRequest) ToUserAccount() *UserAccount {
	return &UserAccount{
		Email: r.Email,
		Name:  r.Name,
		// ID and TenantID will be set in BeforeCreate
	}
}

// UserAccountUpdateRequest represents the request payload for updating a user account
type UserAccountUpdateRequest struct {
	Email *string `json:"email,omitempty" validate:"omitempty,email,max=255"`
	Name  *string `json:"name,omitempty" validate:"omitempty,min=1,max=100"`
}

// ApplyTo applies the update request to an existing UserAccount
func (r *UserAccountUpdateRequest) ApplyTo(account *UserAccount) {
	if r.Email != nil {
		account.Email = *r.Email
	}
	if r.Name != nil {
		account.Name = *r.Name
	}
}

// UserAccountResponse represents the response payload for user account operations
type UserAccountResponse struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	TenantID  uuid.UUID `json:"tenant_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// FromUserAccount converts a UserAccount model to a response payload
func (r *UserAccountResponse) FromUserAccount(account *UserAccount) {
	r.ID = account.ID
	r.Email = account.Email
	r.Name = account.Name
	r.TenantID = account.TenantID
	r.CreatedAt = account.CreatedAt
	r.UpdatedAt = account.UpdatedAt
}

// NewUserAccountResponse creates a new UserAccountResponse from a UserAccount
func NewUserAccountResponse(account *UserAccount) *UserAccountResponse {
	response := &UserAccountResponse{}
	response.FromUserAccount(account)
	return response
}