package kubernetes

import (
	"context"
	"fmt"
	"io"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// MinecraftServerGVR is the GroupVersionResource for MinecraftServer CRD
var MinecraftServerGVR = schema.GroupVersionResource{
	Group:    "minecraft.platform.com",
	Version:  "v1",
	Resource: "minecraftservers",
}

// Client implements the KubernetesClient interface for the backend services
type Client struct {
	clientset     *kubernetes.Clientset
	dynamicClient dynamic.Interface
	namespace     string
}

// ClientConfig holds configuration for the Kubernetes client
type ClientConfig struct {
	// KubeconfigPath is the path to the kubeconfig file (empty for in-cluster)
	KubeconfigPath string
	// DefaultNamespace is the default namespace for operations
	DefaultNamespace string
}

// NewClient creates a new Kubernetes client
func NewClient(cfg *ClientConfig) (*Client, error) {
	var config *rest.Config
	var err error

	if cfg.KubeconfigPath != "" {
		// Out-of-cluster config (development)
		config, err = clientcmd.BuildConfigFromFlags("", cfg.KubeconfigPath)
	} else {
		// In-cluster config (production)
		config, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	namespace := cfg.DefaultNamespace
	if namespace == "" {
		namespace = "default"
	}

	return &Client{
		clientset:     clientset,
		dynamicClient: dynamicClient,
		namespace:     namespace,
	}, nil
}

// MinecraftServerSpec represents the spec for creating a MinecraftServer
type MinecraftServerSpec struct {
	Name             string            `json:"name"`
	Namespace        string            `json:"namespace"`
	ServerID         string            `json:"serverId"`
	TenantID         string            `json:"tenantId"`
	Image            string            `json:"image,omitempty"`
	Version          string            `json:"version"`
	Resources        ResourceSpec      `json:"resources"`
	Config           ServerConfig      `json:"config"`
	StorageClass     string            `json:"storageClass,omitempty"`
	Plugins          []PluginSpec      `json:"plugins,omitempty"`
	Backup           *BackupSpec       `json:"backup,omitempty"`
}

// ResourceSpec defines resource requirements
type ResourceSpec struct {
	CPURequest    string `json:"cpuRequest"`
	CPULimit      string `json:"cpuLimit"`
	MemoryRequest string `json:"memoryRequest"`
	MemoryLimit   string `json:"memoryLimit"`
	Memory        string `json:"memory"`
	Storage       string `json:"storage"`
}

// ServerConfig defines server configuration
type ServerConfig struct {
	MaxPlayers           int               `json:"maxPlayers"`
	Gamemode             string            `json:"gamemode"`
	Difficulty           string            `json:"difficulty"`
	LevelName            string            `json:"levelName"`
	MOTD                 string            `json:"motd"`
	WhiteList            bool              `json:"whiteList"`
	OnlineMode           bool              `json:"onlineMode"`
	PVP                  bool              `json:"pvp"`
	EnableCommandBlock   bool              `json:"enableCommandBlock"`
	AdditionalProperties map[string]string `json:"additionalProperties,omitempty"`
}

// PluginSpec defines a plugin to install
type PluginSpec struct {
	Name    string            `json:"name"`
	Version string            `json:"version,omitempty"`
	URL     string            `json:"url,omitempty"`
	Config  map[string]string `json:"config,omitempty"`
	Enabled bool              `json:"enabled"`
}

// BackupSpec defines backup configuration
type BackupSpec struct {
	Enabled       bool   `json:"enabled"`
	Schedule      string `json:"schedule,omitempty"`
	RetentionDays int    `json:"retentionDays,omitempty"`
	StorageClass  string `json:"storageClass,omitempty"`
}

// MinecraftServerStatus represents the status of a MinecraftServer
type MinecraftServerStatus struct {
	Phase            string           `json:"phase"`
	Message          string           `json:"message"`
	ExternalIP       string           `json:"externalIP"`
	Port             int32            `json:"port"`
	PlayerCount      int              `json:"playerCount"`
	MaxPlayers       int              `json:"maxPlayers"`
	Version          string           `json:"version"`
	InstalledPlugins []InstalledPlugin `json:"installedPlugins,omitempty"`
	LastUpdated      time.Time        `json:"lastUpdated"`
	PodStatus        *PodStatus       `json:"podStatus,omitempty"`
}

// InstalledPlugin represents an installed plugin
type InstalledPlugin struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Status  string `json:"status"`
	Enabled bool   `json:"enabled"`
}

// PodStatus represents pod status information
type PodStatus struct {
	Name         string `json:"name"`
	Phase        string `json:"phase"`
	Ready        bool   `json:"ready"`
	RestartCount int32  `json:"restartCount"`
	NodeName     string `json:"nodeName"`
}

// DeleteOptions represents options for deleting resources
type DeleteOptions struct {
	GracePeriodSeconds *int64 `json:"gracePeriodSeconds,omitempty"`
	Force              bool   `json:"force,omitempty"`
}

// LogOptions represents options for retrieving logs
type LogOptions struct {
	Lines       int        `json:"lines,omitempty"`
	Since       *time.Time `json:"since,omitempty"`
	Follow      bool       `json:"follow,omitempty"`
	Container   string     `json:"container,omitempty"`
}

// LogResult represents log data
type LogResult struct {
	Lines     []LogLine `json:"lines"`
	Truncated bool      `json:"truncated"`
}

// LogLine represents a single log line
type LogLine struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
}

// MinecraftServerEvent represents a watch event
type MinecraftServerEvent struct {
	Type   string                 `json:"type"`
	Object *MinecraftServerStatus `json:"object"`
}

// CreateMinecraftServer creates a new MinecraftServer custom resource
func (c *Client) CreateMinecraftServer(ctx context.Context, spec *MinecraftServerSpec) error {
	namespace := spec.Namespace
	if namespace == "" {
		namespace = c.namespace
	}

	// Build the unstructured object
	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "minecraft.platform.com/v1",
			"kind":       "MinecraftServer",
			"metadata": map[string]interface{}{
				"name":      spec.Name,
				"namespace": namespace,
			},
			"spec": map[string]interface{}{
				"serverId":     spec.ServerID,
				"tenantId":     spec.TenantID,
				"image":        spec.Image,
				"version":      spec.Version,
				"storageClass": spec.StorageClass,
				"resources": map[string]interface{}{
					"cpuRequest":    spec.Resources.CPURequest,
					"cpuLimit":      spec.Resources.CPULimit,
					"memoryRequest": spec.Resources.MemoryRequest,
					"memoryLimit":   spec.Resources.MemoryLimit,
					"memory":        spec.Resources.Memory,
					"storage":       spec.Resources.Storage,
				},
				"config": map[string]interface{}{
					"maxPlayers":         spec.Config.MaxPlayers,
					"gamemode":           spec.Config.Gamemode,
					"difficulty":         spec.Config.Difficulty,
					"levelName":          spec.Config.LevelName,
					"motd":               spec.Config.MOTD,
					"whiteList":          spec.Config.WhiteList,
					"onlineMode":         spec.Config.OnlineMode,
					"pvp":                spec.Config.PVP,
					"enableCommandBlock": spec.Config.EnableCommandBlock,
				},
			},
		},
	}

	// Add plugins if present
	if len(spec.Plugins) > 0 {
		plugins := make([]interface{}, len(spec.Plugins))
		for i, p := range spec.Plugins {
			plugins[i] = map[string]interface{}{
				"name":    p.Name,
				"version": p.Version,
				"url":     p.URL,
				"enabled": p.Enabled,
			}
		}
		obj.Object["spec"].(map[string]interface{})["plugins"] = plugins
	}

	// Add backup config if present
	if spec.Backup != nil {
		obj.Object["spec"].(map[string]interface{})["backup"] = map[string]interface{}{
			"enabled":       spec.Backup.Enabled,
			"schedule":      spec.Backup.Schedule,
			"retentionDays": spec.Backup.RetentionDays,
			"storageClass":  spec.Backup.StorageClass,
		}
	}

	_, err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to create MinecraftServer: %w", err)
	}

	return nil
}

// GetMinecraftServer retrieves a MinecraftServer by name
func (c *Client) GetMinecraftServer(ctx context.Context, namespace, name string) (*MinecraftServerStatus, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	obj, err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			return nil, fmt.Errorf("MinecraftServer %s/%s not found", namespace, name)
		}
		return nil, fmt.Errorf("failed to get MinecraftServer: %w", err)
	}

	return c.parseStatus(obj)
}

// UpdateMinecraftServer updates an existing MinecraftServer
func (c *Client) UpdateMinecraftServer(ctx context.Context, namespace, name string, spec *MinecraftServerSpec) error {
	if namespace == "" {
		namespace = c.namespace
	}

	// Get existing resource
	existing, err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get existing MinecraftServer: %w", err)
	}

	// Update spec fields
	existingSpec := existing.Object["spec"].(map[string]interface{})
	existingSpec["version"] = spec.Version
	existingSpec["resources"] = map[string]interface{}{
		"cpuRequest":    spec.Resources.CPURequest,
		"cpuLimit":      spec.Resources.CPULimit,
		"memoryRequest": spec.Resources.MemoryRequest,
		"memoryLimit":   spec.Resources.MemoryLimit,
		"memory":        spec.Resources.Memory,
		"storage":       spec.Resources.Storage,
	}
	existingSpec["config"] = map[string]interface{}{
		"maxPlayers":         spec.Config.MaxPlayers,
		"gamemode":           spec.Config.Gamemode,
		"difficulty":         spec.Config.Difficulty,
		"levelName":          spec.Config.LevelName,
		"motd":               spec.Config.MOTD,
		"whiteList":          spec.Config.WhiteList,
		"onlineMode":         spec.Config.OnlineMode,
		"pvp":                spec.Config.PVP,
		"enableCommandBlock": spec.Config.EnableCommandBlock,
	}

	_, err = c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Update(ctx, existing, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update MinecraftServer: %w", err)
	}

	return nil
}

// DeleteMinecraftServer deletes a MinecraftServer
func (c *Client) DeleteMinecraftServer(ctx context.Context, namespace, name string, opts *DeleteOptions) error {
	if namespace == "" {
		namespace = c.namespace
	}

	deleteOpts := metav1.DeleteOptions{}
	if opts != nil {
		if opts.GracePeriodSeconds != nil {
			deleteOpts.GracePeriodSeconds = opts.GracePeriodSeconds
		}
		if opts.Force {
			zero := int64(0)
			deleteOpts.GracePeriodSeconds = &zero
		}
	}

	err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Delete(ctx, name, deleteOpts)
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete MinecraftServer: %w", err)
	}

	return nil
}

// ScaleMinecraftServer updates the resources for a MinecraftServer
func (c *Client) ScaleMinecraftServer(ctx context.Context, namespace, name string, resources *ResourceSpec) error {
	if namespace == "" {
		namespace = c.namespace
	}

	existing, err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get existing MinecraftServer: %w", err)
	}

	existingSpec := existing.Object["spec"].(map[string]interface{})
	existingSpec["resources"] = map[string]interface{}{
		"cpuRequest":    resources.CPURequest,
		"cpuLimit":      resources.CPULimit,
		"memoryRequest": resources.MemoryRequest,
		"memoryLimit":   resources.MemoryLimit,
		"memory":        resources.Memory,
		"storage":       resources.Storage,
	}

	_, err = c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Update(ctx, existing, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to scale MinecraftServer: %w", err)
	}

	return nil
}

// GetPodLogs retrieves logs for a MinecraftServer pod
func (c *Client) GetPodLogs(ctx context.Context, namespace, podName string, opts *LogOptions) (*LogResult, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	podLogOpts := &corev1.PodLogOptions{}
	if opts != nil {
		if opts.Lines > 0 {
			lines := int64(opts.Lines)
			podLogOpts.TailLines = &lines
		}
		if opts.Since != nil {
			since := metav1.NewTime(*opts.Since)
			podLogOpts.SinceTime = &since
		}
		if opts.Container != "" {
			podLogOpts.Container = opts.Container
		}
	}

	req := c.clientset.CoreV1().Pods(namespace).GetLogs(podName, podLogOpts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get pod logs: %w", err)
	}
	defer stream.Close()

	// Read all logs
	logBytes, err := io.ReadAll(stream)
	if err != nil {
		return nil, fmt.Errorf("failed to read log stream: %w", err)
	}

	// Parse logs into lines (simplified - real implementation would parse timestamps)
	logStr := string(logBytes)
	lines := []LogLine{}
	for _, line := range splitLines(logStr) {
		if line != "" {
			lines = append(lines, LogLine{
				Timestamp: time.Now(),
				Level:     "INFO",
				Source:    "minecraft-server",
				Message:   line,
			})
		}
	}

	return &LogResult{
		Lines:     lines,
		Truncated: false,
	}, nil
}

// WatchMinecraftServer watches a MinecraftServer for changes
func (c *Client) WatchMinecraftServer(ctx context.Context, namespace, name string) (<-chan *MinecraftServerEvent, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	watcher, err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).Watch(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("metadata.name=%s", name),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create watch: %w", err)
	}

	events := make(chan *MinecraftServerEvent)

	go func() {
		defer close(events)
		defer watcher.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					return
				}

				obj, ok := event.Object.(*unstructured.Unstructured)
				if !ok {
					continue
				}

				status, err := c.parseStatus(obj)
				if err != nil {
					continue
				}

				events <- &MinecraftServerEvent{
					Type:   string(event.Type),
					Object: status,
				}
			}
		}
	}()

	return events, nil
}

// ListMinecraftServers lists all MinecraftServers in a namespace
func (c *Client) ListMinecraftServers(ctx context.Context, namespace string) ([]*MinecraftServerStatus, error) {
	if namespace == "" {
		namespace = c.namespace
	}

	list, err := c.dynamicClient.Resource(MinecraftServerGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list MinecraftServers: %w", err)
	}

	result := make([]*MinecraftServerStatus, 0, len(list.Items))
	for _, item := range list.Items {
		status, err := c.parseStatus(&item)
		if err != nil {
			continue
		}
		result = append(result, status)
	}

	return result, nil
}

// parseStatus extracts status from an unstructured MinecraftServer
func (c *Client) parseStatus(obj *unstructured.Unstructured) (*MinecraftServerStatus, error) {
	status := &MinecraftServerStatus{}

	statusObj, found, err := unstructured.NestedMap(obj.Object, "status")
	if err != nil || !found {
		return status, nil
	}

	if phase, ok := statusObj["phase"].(string); ok {
		status.Phase = phase
	}
	if message, ok := statusObj["message"].(string); ok {
		status.Message = message
	}
	if externalIP, ok := statusObj["externalIP"].(string); ok {
		status.ExternalIP = externalIP
	}
	if port, ok := statusObj["port"].(int64); ok {
		status.Port = int32(port)
	}
	if playerCount, ok := statusObj["playerCount"].(int64); ok {
		status.PlayerCount = int(playerCount)
	}
	if maxPlayers, ok := statusObj["maxPlayers"].(int64); ok {
		status.MaxPlayers = int(maxPlayers)
	}
	if version, ok := statusObj["version"].(string); ok {
		status.Version = version
	}

	return status, nil
}

// splitLines splits a string into lines
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// HealthCheck checks if the Kubernetes cluster is reachable
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.clientset.Discovery().ServerVersion()
	if err != nil {
		return fmt.Errorf("kubernetes cluster not reachable: %w", err)
	}
	return nil
}
