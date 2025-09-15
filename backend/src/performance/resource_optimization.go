package performance

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"sync"
	"time"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

// ResourceOptimizer handles system resource optimization
type ResourceOptimizer struct {
	kubeClient    kubernetes.Interface
	metricsClient versioned.Interface
	config        ResourceOptimizationConfig
	mu            sync.RWMutex
	lastOptimization time.Time
}

// ResourceOptimizationConfig holds optimization configuration
type ResourceOptimizationConfig struct {
	CPUTargetUtilization    float64       `json:"cpu_target_utilization"`
	MemoryTargetUtilization float64       `json:"memory_target_utilization"`
	OptimizationInterval    time.Duration `json:"optimization_interval"`
	MinReplicas            int32         `json:"min_replicas"`
	MaxReplicas            int32         `json:"max_replicas"`
	ScaleUpCooldown        time.Duration `json:"scale_up_cooldown"`
	ScaleDownCooldown      time.Duration `json:"scale_down_cooldown"`
}

// ResourceMetrics represents resource usage metrics
type ResourceMetrics struct {
	Timestamp   time.Time `json:"timestamp"`
	CPUUsage    float64   `json:"cpu_usage"`
	CPULimit    float64   `json:"cpu_limit"`
	MemoryUsage int64     `json:"memory_usage"`
	MemoryLimit int64     `json:"memory_limit"`
	NetworkIO   int64     `json:"network_io"`
	DiskIO      int64     `json:"disk_io"`
	Replicas    int32     `json:"replicas"`
}

// OptimizationAction represents an optimization action taken
type OptimizationAction struct {
	Timestamp   time.Time `json:"timestamp"`
	Action      string    `json:"action"`
	Resource    string    `json:"resource"`
	OldValue    interface{} `json:"old_value"`
	NewValue    interface{} `json:"new_value"`
	Reason      string    `json:"reason"`
	Success     bool      `json:"success"`
}

// NewResourceOptimizer creates a new resource optimizer
func NewResourceOptimizer(kubeClient kubernetes.Interface, metricsClient versioned.Interface, config ResourceOptimizationConfig) *ResourceOptimizer {
	return &ResourceOptimizer{
		kubeClient:    kubeClient,
		metricsClient: metricsClient,
		config:        config,
		lastOptimization: time.Now(),
	}
}

// OptimizeResources performs comprehensive resource optimization
func (ro *ResourceOptimizer) OptimizeResources(ctx context.Context, namespace string) ([]OptimizationAction, error) {
	ro.mu.Lock()
	defer ro.mu.Unlock()

	log.Printf("Starting resource optimization for namespace: %s", namespace)

	var actions []OptimizationAction

	// Get current metrics
	metrics, err := ro.collectResourceMetrics(ctx, namespace)
	if err != nil {
		return nil, fmt.Errorf("failed to collect resource metrics: %w", err)
	}

	// Optimize CPU resources
	cpuActions, err := ro.optimizeCPUResources(ctx, namespace, metrics)
	if err != nil {
		log.Printf("Warning: CPU optimization failed: %v", err)
	} else {
		actions = append(actions, cpuActions...)
	}

	// Optimize memory resources
	memActions, err := ro.optimizeMemoryResources(ctx, namespace, metrics)
	if err != nil {
		log.Printf("Warning: Memory optimization failed: %v", err)
	} else {
		actions = append(actions, memActions...)
	}

	// Optimize replica count
	replicaActions, err := ro.optimizeReplicaCount(ctx, namespace, metrics)
	if err != nil {
		log.Printf("Warning: Replica optimization failed: %v", err)
	} else {
		actions = append(actions, replicaActions...)
	}

	// Optimize resource limits and requests
	limitActions, err := ro.optimizeResourceLimits(ctx, namespace, metrics)
	if err != nil {
		log.Printf("Warning: Resource limit optimization failed: %v", err)
	} else {
		actions = append(actions, limitActions...)
	}

	ro.lastOptimization = time.Now()
	log.Printf("Resource optimization completed. %d actions taken.", len(actions))

	return actions, nil
}

// collectResourceMetrics gathers current resource usage metrics
func (ro *ResourceOptimizer) collectResourceMetrics(ctx context.Context, namespace string) (map[string]ResourceMetrics, error) {
	metrics := make(map[string]ResourceMetrics)

	// Get pod metrics
	podMetrics, err := ro.metricsClient.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod metrics: %w", err)
	}

	// Get pod information
	pods, err := ro.kubeClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pods: %w", err)
	}

	// Create a map of pod specs for easy lookup
	podSpecs := make(map[string]v1.Pod)
	for _, pod := range pods.Items {
		podSpecs[pod.Name] = pod
	}

	// Process metrics for each pod
	for _, podMetric := range podMetrics.Items {
		podSpec, exists := podSpecs[podMetric.Name]
		if !exists {
			continue
		}

		var totalCPUUsage, totalCPULimit float64
		var totalMemoryUsage, totalMemoryLimit int64

		// Sum resources across all containers in the pod
		for i, containerMetric := range podMetric.Containers {
			if i < len(podSpec.Spec.Containers) {
				container := podSpec.Spec.Containers[i]

				// CPU metrics
				cpuUsage := containerMetric.Usage.Cpu().AsApproximateFloat64()
				totalCPUUsage += cpuUsage

				if cpuLimit := container.Resources.Limits.Cpu(); cpuLimit != nil {
					totalCPULimit += cpuLimit.AsApproximateFloat64()
				}

				// Memory metrics
				memoryUsage := containerMetric.Usage.Memory().Value()
				totalMemoryUsage += memoryUsage

				if memoryLimit := container.Resources.Limits.Memory(); memoryLimit != nil {
					totalMemoryLimit += memoryLimit.Value()
				}
			}
		}

		metrics[podMetric.Name] = ResourceMetrics{
			Timestamp:   time.Now(),
			CPUUsage:    totalCPUUsage,
			CPULimit:    totalCPULimit,
			MemoryUsage: totalMemoryUsage,
			MemoryLimit: totalMemoryLimit,
		}
	}

	return metrics, nil
}

// optimizeCPUResources optimizes CPU allocation and usage
func (ro *ResourceOptimizer) optimizeCPUResources(ctx context.Context, namespace string, metrics map[string]ResourceMetrics) ([]OptimizationAction, error) {
	var actions []OptimizationAction

	for podName, metric := range metrics {
		if metric.CPULimit == 0 {
			continue // Skip pods without CPU limits
		}

		cpuUtilization := metric.CPUUsage / metric.CPULimit

		// High CPU utilization - increase CPU limit
		if cpuUtilization > ro.config.CPUTargetUtilization {
			newLimit := metric.CPULimit * 1.2 // Increase by 20%

			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "increase_cpu_limit",
				Resource:  podName,
				OldValue:  metric.CPULimit,
				NewValue:  newLimit,
				Reason:    fmt.Sprintf("CPU utilization %.2f%% > target %.2f%%", cpuUtilization*100, ro.config.CPUTargetUtilization*100),
			}

			// Apply the change (this would require updating the deployment)
			err := ro.updatePodCPULimit(ctx, namespace, podName, newLimit)
			action.Success = err == nil
			if err != nil {
				log.Printf("Failed to update CPU limit for pod %s: %v", podName, err)
			}

			actions = append(actions, action)
		}

		// Low CPU utilization - decrease CPU limit
		if cpuUtilization < ro.config.CPUTargetUtilization*0.5 {
			newLimit := metric.CPULimit * 0.8 // Decrease by 20%

			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "decrease_cpu_limit",
				Resource:  podName,
				OldValue:  metric.CPULimit,
				NewValue:  newLimit,
				Reason:    fmt.Sprintf("CPU utilization %.2f%% < target %.2f%%", cpuUtilization*100, ro.config.CPUTargetUtilization*50),
			}

			// Apply the change
			err := ro.updatePodCPULimit(ctx, namespace, podName, newLimit)
			action.Success = err == nil

			actions = append(actions, action)
		}
	}

	return actions, nil
}

// optimizeMemoryResources optimizes memory allocation and usage
func (ro *ResourceOptimizer) optimizeMemoryResources(ctx context.Context, namespace string, metrics map[string]ResourceMetrics) ([]OptimizationAction, error) {
	var actions []OptimizationAction

	for podName, metric := range metrics {
		if metric.MemoryLimit == 0 {
			continue // Skip pods without memory limits
		}

		memoryUtilization := float64(metric.MemoryUsage) / float64(metric.MemoryLimit)

		// High memory utilization - increase memory limit
		if memoryUtilization > ro.config.MemoryTargetUtilization {
			newLimit := int64(float64(metric.MemoryLimit) * 1.2) // Increase by 20%

			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "increase_memory_limit",
				Resource:  podName,
				OldValue:  metric.MemoryLimit,
				NewValue:  newLimit,
				Reason:    fmt.Sprintf("Memory utilization %.2f%% > target %.2f%%", memoryUtilization*100, ro.config.MemoryTargetUtilization*100),
			}

			// Apply the change
			err := ro.updatePodMemoryLimit(ctx, namespace, podName, newLimit)
			action.Success = err == nil

			actions = append(actions, action)
		}

		// Low memory utilization - decrease memory limit
		if memoryUtilization < ro.config.MemoryTargetUtilization*0.5 {
			newLimit := int64(float64(metric.MemoryLimit) * 0.8) // Decrease by 20%

			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "decrease_memory_limit",
				Resource:  podName,
				OldValue:  metric.MemoryLimit,
				NewValue:  newLimit,
				Reason:    fmt.Sprintf("Memory utilization %.2f%% < target %.2f%%", memoryUtilization*100, ro.config.MemoryTargetUtilization*50),
			}

			// Apply the change
			err := ro.updatePodMemoryLimit(ctx, namespace, podName, newLimit)
			action.Success = err == nil

			actions = append(actions, action)
		}
	}

	return actions, nil
}

// optimizeReplicaCount optimizes the number of pod replicas
func (ro *ResourceOptimizer) optimizeReplicaCount(ctx context.Context, namespace string, metrics map[string]ResourceMetrics) ([]OptimizationAction, error) {
	var actions []OptimizationAction

	// Get deployments
	deployments, err := ro.kubeClient.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get deployments: %w", err)
	}

	for _, deployment := range deployments.Items {
		currentReplicas := *deployment.Spec.Replicas

		// Calculate average resource utilization across all pods
		var totalCPUUtilization, totalMemoryUtilization float64
		var podCount int

		for podName, metric := range metrics {
			if ro.belongsToDeployment(podName, deployment.Name) {
				if metric.CPULimit > 0 {
					totalCPUUtilization += metric.CPUUsage / metric.CPULimit
				}
				if metric.MemoryLimit > 0 {
					totalMemoryUtilization += float64(metric.MemoryUsage) / float64(metric.MemoryLimit)
				}
				podCount++
			}
		}

		if podCount == 0 {
			continue
		}

		avgCPUUtilization := totalCPUUtilization / float64(podCount)
		avgMemoryUtilization := totalMemoryUtilization / float64(podCount)

		// Determine if scaling is needed
		maxUtilization := avgCPUUtilization
		if avgMemoryUtilization > maxUtilization {
			maxUtilization = avgMemoryUtilization
		}

		var newReplicas int32

		// Scale up if utilization is high
		if maxUtilization > ro.config.CPUTargetUtilization {
			scaleUpFactor := maxUtilization / ro.config.CPUTargetUtilization
			newReplicas = int32(float64(currentReplicas) * scaleUpFactor)

			if newReplicas > ro.config.MaxReplicas {
				newReplicas = ro.config.MaxReplicas
			}
		}

		// Scale down if utilization is low
		if maxUtilization < ro.config.CPUTargetUtilization*0.5 {
			scaleDownFactor := (ro.config.CPUTargetUtilization * 0.5) / maxUtilization
			newReplicas = int32(float64(currentReplicas) / scaleDownFactor)

			if newReplicas < ro.config.MinReplicas {
				newReplicas = ro.config.MinReplicas
			}
		}

		// Apply scaling if needed
		if newReplicas != 0 && newReplicas != currentReplicas {
			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "scale_replicas",
				Resource:  deployment.Name,
				OldValue:  currentReplicas,
				NewValue:  newReplicas,
				Reason:    fmt.Sprintf("Average utilization %.2f%% requires scaling", maxUtilization*100),
			}

			// Apply the scaling
			err := ro.scaleDeployment(ctx, namespace, deployment.Name, newReplicas)
			action.Success = err == nil

			actions = append(actions, action)
		}
	}

	return actions, nil
}

// optimizeResourceLimits adjusts resource requests and limits
func (ro *ResourceOptimizer) optimizeResourceLimits(ctx context.Context, namespace string, metrics map[string]ResourceMetrics) ([]OptimizationAction, error) {
	var actions []OptimizationAction

	// Get current Go runtime metrics for comparison
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	// Optimize based on historical usage patterns
	for podName, metric := range metrics {
		// Adjust CPU requests based on actual usage
		if metric.CPUUsage > 0 {
			optimalCPURequest := metric.CPUUsage * 1.1 // 10% buffer

			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "optimize_cpu_request",
				Resource:  podName,
				OldValue:  "unknown",
				NewValue:  optimalCPURequest,
				Reason:    "Align CPU request with actual usage",
				Success:   true, // This is a recommendation
			}

			actions = append(actions, action)
		}

		// Adjust memory requests based on actual usage
		if metric.MemoryUsage > 0 {
			optimalMemoryRequest := int64(float64(metric.MemoryUsage) * 1.2) // 20% buffer

			action := OptimizationAction{
				Timestamp: time.Now(),
				Action:    "optimize_memory_request",
				Resource:  podName,
				OldValue:  "unknown",
				NewValue:  optimalMemoryRequest,
				Reason:    "Align memory request with actual usage",
				Success:   true,
			}

			actions = append(actions, action)
		}
	}

	return actions, nil
}

// Helper methods

// updatePodCPULimit updates the CPU limit for a pod (requires updating the deployment)
func (ro *ResourceOptimizer) updatePodCPULimit(ctx context.Context, namespace, podName string, newLimit float64) error {
	// This is a simplified implementation - in practice, you'd need to:
	// 1. Find the deployment that owns this pod
	// 2. Update the deployment's resource limits
	// 3. Let Kubernetes recreate the pods with new limits

	log.Printf("Would update CPU limit for pod %s to %.3f cores", podName, newLimit)
	return nil // Placeholder implementation
}

// updatePodMemoryLimit updates the memory limit for a pod
func (ro *ResourceOptimizer) updatePodMemoryLimit(ctx context.Context, namespace, podName string, newLimit int64) error {
	log.Printf("Would update memory limit for pod %s to %d bytes", podName, newLimit)
	return nil // Placeholder implementation
}

// scaleDeployment scales a deployment to the specified number of replicas
func (ro *ResourceOptimizer) scaleDeployment(ctx context.Context, namespace, deploymentName string, replicas int32) error {
	deployment, err := ro.kubeClient.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment %s: %w", deploymentName, err)
	}

	deployment.Spec.Replicas = &replicas

	_, err = ro.kubeClient.AppsV1().Deployments(namespace).Update(ctx, deployment, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to scale deployment %s: %w", deploymentName, err)
	}

	log.Printf("Scaled deployment %s to %d replicas", deploymentName, replicas)
	return nil
}

// belongsToDeployment checks if a pod belongs to a specific deployment
func (ro *ResourceOptimizer) belongsToDeployment(podName, deploymentName string) bool {
	// Simplified check - in practice, you'd check the owner references
	return len(podName) > len(deploymentName) && podName[:len(deploymentName)] == deploymentName
}

// StartOptimizationLoop runs continuous resource optimization
func (ro *ResourceOptimizer) StartOptimizationLoop(ctx context.Context, namespace string) error {
	ticker := time.NewTicker(ro.config.OptimizationInterval)
	defer ticker.Stop()

	log.Printf("Starting resource optimization loop for namespace: %s", namespace)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Resource optimization loop stopped")
			return ctx.Err()
		case <-ticker.C:
			actions, err := ro.OptimizeResources(ctx, namespace)
			if err != nil {
				log.Printf("Resource optimization error: %v", err)
			} else {
				log.Printf("Resource optimization completed: %d actions taken", len(actions))
			}
		}
	}
}