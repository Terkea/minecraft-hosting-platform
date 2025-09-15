package v1

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// MinecraftServerSpec defines the desired state of MinecraftServer
type MinecraftServerSpec struct {
	// ServerID is the unique identifier for this server instance
	ServerID string `json:"serverId"`

	// TenantID is the tenant that owns this server
	TenantID string `json:"tenantId"`

	// Image is the Docker image to use for the Minecraft server
	// +kubebuilder:default="itzg/minecraft-server:latest"
	Image string `json:"image,omitempty"`

	// Version is the Minecraft version to run
	// +kubebuilder:default="1.20.1"
	Version string `json:"version,omitempty"`

	// Resources defines the resource requirements for the server
	Resources MinecraftServerResources `json:"resources"`

	// Config contains the server configuration
	Config MinecraftServerConfig `json:"config"`

	// StorageClass is the storage class to use for persistent volumes
	// +kubebuilder:default="standard"
	StorageClass string `json:"storageClass,omitempty"`

	// Plugins is a list of plugins to install
	Plugins []MinecraftPlugin `json:"plugins,omitempty"`

	// Backup configuration
	Backup *BackupConfig `json:"backup,omitempty"`
}

// MinecraftServerResources defines resource requirements
type MinecraftServerResources struct {
	// CPU request (e.g., "1000m")
	CPURequest resource.Quantity `json:"cpuRequest"`

	// CPU limit (e.g., "2000m")
	CPULimit resource.Quantity `json:"cpuLimit"`

	// Memory request (e.g., "2Gi")
	MemoryRequest resource.Quantity `json:"memoryRequest"`

	// Memory limit (e.g., "4Gi")
	MemoryLimit resource.Quantity `json:"memoryLimit"`

	// Memory allocation for JVM (e.g., "3G")
	Memory string `json:"memory"`

	// Storage size (e.g., "10Gi")
	Storage resource.Quantity `json:"storage"`
}

// MinecraftServerConfig defines server configuration
type MinecraftServerConfig struct {
	// MaxPlayers is the maximum number of players
	// +kubebuilder:default=20
	MaxPlayers int `json:"maxPlayers,omitempty"`

	// Gamemode is the default game mode
	// +kubebuilder:default="survival"
	// +kubebuilder:validation:Enum=survival;creative;adventure;spectator
	Gamemode string `json:"gamemode,omitempty"`

	// Difficulty is the game difficulty
	// +kubebuilder:default="normal"
	// +kubebuilder:validation:Enum=peaceful;easy;normal;hard
	Difficulty string `json:"difficulty,omitempty"`

	// LevelName is the world name
	// +kubebuilder:default="world"
	LevelName string `json:"levelName,omitempty"`

	// MOTD is the message of the day
	// +kubebuilder:default="A Minecraft Server powered by Kubernetes"
	MOTD string `json:"motd,omitempty"`

	// WhiteList enables whitelist mode
	// +kubebuilder:default=false
	WhiteList bool `json:"whiteList,omitempty"`

	// OnlineMode enables online mode
	// +kubebuilder:default=true
	OnlineMode bool `json:"onlineMode,omitempty"`

	// PVP enables player vs player combat
	// +kubebuilder:default=true
	PVP bool `json:"pvp,omitempty"`

	// EnableCommandBlock enables command blocks
	// +kubebuilder:default=true
	EnableCommandBlock bool `json:"enableCommandBlock,omitempty"`

	// Additional server properties as key-value pairs
	AdditionalProperties map[string]string `json:"additionalProperties,omitempty"`
}

// MinecraftPlugin defines a plugin to install
type MinecraftPlugin struct {
	// Name of the plugin
	Name string `json:"name"`

	// Version of the plugin
	Version string `json:"version,omitempty"`

	// URL to download the plugin from
	URL string `json:"url,omitempty"`

	// Config for the plugin
	Config map[string]string `json:"config,omitempty"`

	// Enabled indicates if the plugin should be enabled
	// +kubebuilder:default=true
	Enabled bool `json:"enabled,omitempty"`
}

// BackupConfig defines backup settings
type BackupConfig struct {
	// Enabled indicates if backups should be taken
	// +kubebuilder:default=false
	Enabled bool `json:"enabled,omitempty"`

	// Schedule is the cron schedule for backups
	// +kubebuilder:default="0 2 * * *"
	Schedule string `json:"schedule,omitempty"`

	// RetentionDays is how many days to keep backups
	// +kubebuilder:default=7
	RetentionDays int `json:"retentionDays,omitempty"`

	// StorageClass for backup storage
	StorageClass string `json:"storageClass,omitempty"`
}

// MinecraftServerStatus defines the observed state of MinecraftServer
type MinecraftServerStatus struct {
	// Phase represents the current phase of the server
	// +kubebuilder:validation:Enum=Pending;Starting;Running;Stopping;Stopped;Error
	Phase string `json:"phase,omitempty"`

	// Message provides additional information about the current state
	Message string `json:"message,omitempty"`

	// LastUpdated is the last time the status was updated
	LastUpdated metav1.Time `json:"lastUpdated,omitempty"`

	// ExternalIP is the external IP address of the server
	ExternalIP string `json:"externalIP,omitempty"`

	// Port is the external port of the server
	Port int32 `json:"port,omitempty"`

	// PlayerCount is the current number of players online
	PlayerCount int `json:"playerCount,omitempty"`

	// MaxPlayers is the maximum number of players
	MaxPlayers int `json:"maxPlayers,omitempty"`

	// Version is the current Minecraft version
	Version string `json:"version,omitempty"`

	// Plugins is the list of installed plugins
	InstalledPlugins []InstalledPlugin `json:"installedPlugins,omitempty"`

	// Resources shows current resource usage
	ResourceUsage *ResourceUsage `json:"resourceUsage,omitempty"`

	// LastBackup is the timestamp of the last successful backup
	LastBackup *metav1.Time `json:"lastBackup,omitempty"`
}

// InstalledPlugin represents an installed plugin
type InstalledPlugin struct {
	// Name of the plugin
	Name string `json:"name"`

	// Version of the installed plugin
	Version string `json:"version"`

	// Status of the plugin
	Status string `json:"status"`

	// Enabled indicates if the plugin is enabled
	Enabled bool `json:"enabled"`
}

// ResourceUsage shows current resource consumption
type ResourceUsage struct {
	// CPU usage in millicores
	CPU resource.Quantity `json:"cpu,omitempty"`

	// Memory usage in bytes
	Memory resource.Quantity `json:"memory,omitempty"`

	// Storage usage in bytes
	Storage resource.Quantity `json:"storage,omitempty"`

	// Network input/output stats
	NetworkIO *NetworkIOStats `json:"networkIO,omitempty"`
}

// NetworkIOStats shows network I/O statistics
type NetworkIOStats struct {
	// Bytes received
	RxBytes int64 `json:"rxBytes"`

	// Bytes transmitted
	TxBytes int64 `json:"txBytes"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=mcserver;mcs
// +kubebuilder:printcolumn:name="Status",type="string",JSONPath=".status.phase"
// +kubebuilder:printcolumn:name="Players",type="string",JSONPath=".status.playerCount"
// +kubebuilder:printcolumn:name="Max Players",type="string",JSONPath=".status.maxPlayers"
// +kubebuilder:printcolumn:name="Version",type="string",JSONPath=".status.version"
// +kubebuilder:printcolumn:name="External IP",type="string",JSONPath=".status.externalIP"
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"

// MinecraftServer is the Schema for the minecraftservers API
type MinecraftServer struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   MinecraftServerSpec   `json:"spec,omitempty"`
	Status MinecraftServerStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// MinecraftServerList contains a list of MinecraftServer
type MinecraftServerList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []MinecraftServer `json:"items"`
}

func init() {
	SchemeBuilder.Register(&MinecraftServer{}, &MinecraftServerList{})
}

// Default sets default values for MinecraftServer
func (m *MinecraftServer) Default() {
	if m.Spec.Image == "" {
		m.Spec.Image = "itzg/minecraft-server:latest"
	}

	if m.Spec.Version == "" {
		m.Spec.Version = "1.20.1"
	}

	if m.Spec.StorageClass == "" {
		m.Spec.StorageClass = "standard"
	}

	if m.Spec.Config.MaxPlayers == 0 {
		m.Spec.Config.MaxPlayers = 20
	}

	if m.Spec.Config.Gamemode == "" {
		m.Spec.Config.Gamemode = "survival"
	}

	if m.Spec.Config.Difficulty == "" {
		m.Spec.Config.Difficulty = "normal"
	}

	if m.Spec.Config.LevelName == "" {
		m.Spec.Config.LevelName = "world"
	}

	if m.Spec.Config.MOTD == "" {
		m.Spec.Config.MOTD = "A Minecraft Server powered by Kubernetes"
	}

	if m.Spec.Config.OnlineMode == false && m.ObjectMeta.Annotations == nil {
		// Default to true for online mode
		m.Spec.Config.OnlineMode = true
	}

	if !m.Spec.Config.PVP && m.ObjectMeta.Annotations == nil {
		// Default to true for PVP
		m.Spec.Config.PVP = true
	}

	if !m.Spec.Config.EnableCommandBlock && m.ObjectMeta.Annotations == nil {
		// Default to true for command blocks
		m.Spec.Config.EnableCommandBlock = true
	}
}

// GetTenantID returns the tenant ID for this server
func (m *MinecraftServer) GetTenantID() string {
	return m.Spec.TenantID
}

// GetServerID returns the server ID for this server
func (m *MinecraftServer) GetServerID() string {
	return m.Spec.ServerID
}

// IsRunning returns true if the server is in running state
func (m *MinecraftServer) IsRunning() bool {
	return m.Status.Phase == "Running"
}

// IsStarting returns true if the server is in starting state
func (m *MinecraftServer) IsStarting() bool {
	return m.Status.Phase == "Starting" || m.Status.Phase == "Pending"
}

// IsError returns true if the server is in error state
func (m *MinecraftServer) IsError() bool {
	return m.Status.Phase == "Error"
}

// GetResourceRequirements returns the resource requirements as Kubernetes ResourceRequirements
func (m *MinecraftServer) GetResourceRequirements() corev1.ResourceRequirements {
	return corev1.ResourceRequirements{
		Requests: corev1.ResourceList{
			corev1.ResourceCPU:    m.Spec.Resources.CPURequest,
			corev1.ResourceMemory: m.Spec.Resources.MemoryRequest,
		},
		Limits: corev1.ResourceList{
			corev1.ResourceCPU:    m.Spec.Resources.CPULimit,
			corev1.ResourceMemory: m.Spec.Resources.MemoryLimit,
		},
	}
}