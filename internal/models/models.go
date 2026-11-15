package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// User represents an authenticated OIDC user (or the local fallback user when OIDC is disabled).
type User struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	OIDCSub     *string         `gorm:"column:oidc_sub;type:text;uniqueIndex" json:"oidc_sub,omitempty"`
	Username    string          `gorm:"type:text;not null;default:''" json:"username"`
	DisplayName string          `gorm:"type:text;not null;default:''" json:"display_name"`
	Email       string          `gorm:"type:text;not null;default:''" json:"email"`
	AvatarURL   string          `gorm:"type:text;not null;default:''" json:"avatar_url"`
	Groups      json.RawMessage `gorm:"type:jsonb;not null;default:'[]'" json:"groups"`
	BoardSeeded bool            `gorm:"type:bool;not null;default:false" json:"-"`
	LastLoginAt *time.Time      `json:"last_login_at,omitempty"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (User) TableName() string {
	return "users"
}

// Session stores server-side authenticated user sessions and encrypted OIDC tokens.
type Session struct {
	ID                   uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID               uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	User                 *User      `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
	OIDCSid              string     `gorm:"column:oidc_sid;type:text;not null;default:''" json:"-"`
	IDTokenEnc           []byte     `gorm:"column:id_token_enc;type:bytea" json:"-"`
	RefreshTokenEnc      []byte     `gorm:"column:refresh_token_enc;type:bytea" json:"-"`
	AccessTokenExpiresAt *time.Time `json:"-"`
	ExpiresAt            time.Time  `gorm:"not null;index" json:"expires_at"`
	CreatedAt            time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt            time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Session) TableName() string {
	return "sessions"
}

// OIDCRevokedJTI tracks seen Back-Channel Logout token JTIs to prevent replay attacks.
type OIDCRevokedJTI struct {
	JTI       string    `gorm:"column:jti;type:text;primaryKey"`
	ExpiresAt time.Time `gorm:"not null;index"`
}

func (OIDCRevokedJTI) TableName() string {
	return "oidc_revoked_jtis"
}

// Workspace represents a user-owned layout page (e.g., Home, Work).
type Workspace struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Name      string    `gorm:"type:text;not null" json:"name"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Workspace) TableName() string {
	return "workspaces"
}

// Node represents an element in the polymorphic UI tree (action, container, or widget).
type Node struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	WorkspaceID uuid.UUID       `gorm:"type:uuid;not null;index" json:"workspace_id"`
	ParentID    *uuid.UUID      `gorm:"type:uuid;index" json:"parent_id"`
	Parent      *Node           `gorm:"foreignKey:ParentID;constraint:OnDelete:CASCADE" json:"-"`
	Children    []Node          `gorm:"foreignKey:ParentID;constraint:OnDelete:CASCADE" json:"children,omitempty"`
	SortOrder   int32           `gorm:"type:int4;not null;default:0" json:"sort_order"`
	GridX       int32           `gorm:"type:int4;not null;default:1" json:"grid_x"`
	GridY       int32           `gorm:"type:int4;not null;default:1" json:"grid_y"`
	Title       string          `gorm:"type:text;not null" json:"title"`
	Icon        *string         `gorm:"type:text" json:"icon"`
	NodeType    string          `gorm:"type:text;not null" json:"node_type"`
	URL         *string         `gorm:"type:text" json:"url"`
	Width       int32           `gorm:"type:int4;not null;default:1" json:"width"`
	Height      int32           `gorm:"type:int4;not null;default:1" json:"height"`
	Settings    json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"settings"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Node) TableName() string {
	return "nodes"
}

// Integration stores user-scoped provider configuration and AES-256-GCM encrypted credentials.
type Integration struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID      uuid.UUID       `gorm:"type:uuid;not null;index" json:"user_id"`
	Provider    string          `gorm:"type:text;not null" json:"provider"`
	Credentials []byte          `gorm:"type:bytea;not null" json:"-"`
	Settings    json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"settings"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Integration) TableName() string {
	return "integrations"
}

// Preference stores cross-device user settings (appearance, app usage, etc.) scoped per user.
type Preference struct {
	UserID    uuid.UUID       `gorm:"type:uuid;primaryKey" json:"user_id"`
	Key       string          `gorm:"type:text;primaryKey" json:"key"`
	Value     json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"value"`
	UpdatedAt time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Preference) TableName() string {
	return "preferences"
}
