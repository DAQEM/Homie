package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Workspace represents a top-level layout scope (e.g., Home, Work).
type Workspace struct {
	ID        uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
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

// Integration stores provider configuration and AES-256-GCM encrypted credentials.
type Integration struct {
	ID          uuid.UUID       `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	Provider    string          `gorm:"type:text;not null" json:"provider"`
	Credentials []byte          `gorm:"type:bytea;not null" json:"-"`
	Settings    json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"settings"`
	CreatedAt   time.Time       `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time       `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Integration) TableName() string {
	return "integrations"
}
