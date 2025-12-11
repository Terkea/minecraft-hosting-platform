package controllers

import (
	"bytes"
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/log"

	minecraftv1 "minecraft-platform-operator/api/v1"
	"minecraft-platform-operator/pkg/events"
	"minecraft-platform-operator/pkg/rcon"
)

// MinecraftServerReconciler reconciles a MinecraftServer object
type MinecraftServerReconciler struct {
	client.Client
	Scheme         *runtime.Scheme
	EventPublisher *events.EventPublisher
	Clientset      *kubernetes.Clientset
	RestConfig     *rest.Config
}

// +kubebuilder:rbac:groups=minecraft.platform.com,resources=minecraftservers,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=minecraft.platform.com,resources=minecraftservers/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=minecraft.platform.com,resources=minecraftservers/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=statefulsets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=services,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=configmaps,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=persistentvolumeclaims,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=pods,verbs=get;list;watch

// Reconcile handles the reconciliation loop for MinecraftServer resources
func (r *MinecraftServerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx).WithValues("minecraftserver", req.NamespacedName)

	// Fetch the MinecraftServer instance
	var minecraftServer minecraftv1.MinecraftServer
	if err := r.Get(ctx, req.NamespacedName, &minecraftServer); err != nil {
		if errors.IsNotFound(err) {
			logger.Info("MinecraftServer resource not found. Ignoring since object must be deleted")
			return ctrl.Result{}, nil
		}
		logger.Error(err, "Failed to get MinecraftServer")
		return ctrl.Result{}, err
	}

	logger.Info("Reconciling MinecraftServer", "spec", minecraftServer.Spec)

	// Handle deletion
	if minecraftServer.DeletionTimestamp != nil {
		return r.handleDeletion(ctx, &minecraftServer)
	}

	// Add finalizer if not present
	if !controllerutil.ContainsFinalizer(&minecraftServer, "minecraft.platform.com/finalizer") {
		controllerutil.AddFinalizer(&minecraftServer, "minecraft.platform.com/finalizer")
		if err := r.Update(ctx, &minecraftServer); err != nil {
			return ctrl.Result{}, err
		}
	}

	// Reconcile the ConfigMap
	if err := r.reconcileConfigMap(ctx, &minecraftServer); err != nil {
		logger.Error(err, "Failed to reconcile ConfigMap")
		return r.updateStatus(ctx, &minecraftServer, "Error", err.Error())
	}

	// Reconcile the Service
	if err := r.reconcileService(ctx, &minecraftServer); err != nil {
		logger.Error(err, "Failed to reconcile Service")
		return r.updateStatus(ctx, &minecraftServer, "Error", err.Error())
	}

	// Reconcile the StatefulSet
	if err := r.reconcileStatefulSet(ctx, &minecraftServer); err != nil {
		logger.Error(err, "Failed to reconcile StatefulSet")
		return r.updateStatus(ctx, &minecraftServer, "Error", err.Error())
	}

	// Update status based on StatefulSet readiness
	if err := r.updateServerStatus(ctx, &minecraftServer); err != nil {
		logger.Error(err, "Failed to update server status")
		return ctrl.Result{RequeueAfter: 30 * time.Second}, err
	}

	logger.Info("Successfully reconciled MinecraftServer")
	// Reconcile every 2 minutes to reduce RCON spam from player count queries
	return ctrl.Result{RequeueAfter: 120 * time.Second}, nil
}

// handleDeletion handles the deletion of MinecraftServer resources
func (r *MinecraftServerReconciler) handleDeletion(ctx context.Context, server *minecraftv1.MinecraftServer) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	// Perform cleanup tasks here
	logger.Info("Cleaning up MinecraftServer resources", "server", server.Name)

	// Remove finalizer to allow deletion
	controllerutil.RemoveFinalizer(server, "minecraft.platform.com/finalizer")
	if err := r.Update(ctx, server); err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

// reconcileConfigMap ensures the ConfigMap exists and is up to date
func (r *MinecraftServerReconciler) reconcileConfigMap(ctx context.Context, server *minecraftv1.MinecraftServer) error {
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-config", server.Name),
			Namespace: server.Namespace,
		},
	}

	op, err := controllerutil.CreateOrUpdate(ctx, r.Client, configMap, func() error {
		// Set owner reference
		if err := controllerutil.SetControllerReference(server, configMap, r.Scheme); err != nil {
			return err
		}

		// Configure server properties
		serverProperties := r.buildServerProperties(server)
		configMap.Data = map[string]string{
			"server.properties": serverProperties,
			"eula.txt":          "eula=true",
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to create/update ConfigMap: %w", err)
	}

	log.FromContext(ctx).Info("ConfigMap reconciled", "operation", op)
	return nil
}

// reconcileService ensures the Service exists and is configured correctly
func (r *MinecraftServerReconciler) reconcileService(ctx context.Context, server *minecraftv1.MinecraftServer) error {
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-service", server.Name),
			Namespace: server.Namespace,
		},
	}

	op, err := controllerutil.CreateOrUpdate(ctx, r.Client, service, func() error {
		// Set owner reference
		if err := controllerutil.SetControllerReference(server, service, r.Scheme); err != nil {
			return err
		}

		// Configure service
		service.Spec = corev1.ServiceSpec{
			Selector: map[string]string{
				"app": server.Name,
			},
			Ports: []corev1.ServicePort{
				{
					Name:       "minecraft",
					Protocol:   corev1.ProtocolTCP,
					Port:       25565,
					TargetPort: intstr.FromInt(25565),
				},
				{
					Name:       "rcon",
					Protocol:   corev1.ProtocolTCP,
					Port:       25575,
					TargetPort: intstr.FromInt(25575),
				},
			},
			Type: corev1.ServiceTypeLoadBalancer,
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to create/update Service: %w", err)
	}

	log.FromContext(ctx).Info("Service reconciled", "operation", op)
	return nil
}

// reconcileStatefulSet ensures the StatefulSet exists and is configured correctly
func (r *MinecraftServerReconciler) reconcileStatefulSet(ctx context.Context, server *minecraftv1.MinecraftServer) error {
	statefulSet := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      server.Name,
			Namespace: server.Namespace,
		},
	}

	op, err := controllerutil.CreateOrUpdate(ctx, r.Client, statefulSet, func() error {
		// Set owner reference
		if err := controllerutil.SetControllerReference(server, statefulSet, r.Scheme); err != nil {
			return err
		}

		// Configure StatefulSet - set replicas based on Stopped field
		replicas := int32(1)
		if server.Spec.Stopped {
			replicas = int32(0)
		}
		statefulSet.Spec = appsv1.StatefulSetSpec{
			Replicas:    &replicas,
			ServiceName: fmt.Sprintf("%s-service", server.Name),
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": server.Name,
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app":       server.Name,
						"tenant":    server.Spec.TenantID,
						"server-id": server.Spec.ServerID,
					},
				},
				Spec: r.buildPodSpec(server),
			},
			VolumeClaimTemplates: r.buildVolumeClaimTemplates(server),
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to create/update StatefulSet: %w", err)
	}

	log.FromContext(ctx).Info("StatefulSet reconciled", "operation", op)
	return nil
}

// buildPodSpec creates the pod specification for the Minecraft server
func (r *MinecraftServerReconciler) buildPodSpec(server *minecraftv1.MinecraftServer) corev1.PodSpec {
	// The itzg/minecraft-server image uses environment variables for configuration
	// instead of mounting config files (which would be read-only)
	return corev1.PodSpec{
		Containers: []corev1.Container{
			{
				Name:  "minecraft-server",
				Image: server.Spec.Image,
				Ports: []corev1.ContainerPort{
					{
						ContainerPort: 25565,
						Protocol:      corev1.ProtocolTCP,
					},
					{
						ContainerPort: 25575,
						Protocol:      corev1.ProtocolTCP,
					},
				},
				Env: []corev1.EnvVar{
					{
						Name:  "EULA",
						Value: "TRUE",
					},
					{
						Name:  "TYPE",
						Value: "VANILLA",
					},
					{
						Name:  "VERSION",
						Value: server.Spec.Version,
					},
					{
						Name:  "MEMORY",
						Value: server.Spec.Resources.Memory,
					},
					{
						Name:  "MAX_PLAYERS",
						Value: fmt.Sprintf("%d", server.Spec.Config.MaxPlayers),
					},
					{
						Name:  "DIFFICULTY",
						Value: server.Spec.Config.Difficulty,
					},
					{
						Name:  "MODE",
						Value: server.Spec.Config.Gamemode,
					},
					{
						Name:  "LEVEL",
						Value: server.Spec.Config.LevelName,
					},
					{
						Name:  "MOTD",
						Value: server.Spec.Config.MOTD,
					},
					{
						Name:  "PVP",
						Value: fmt.Sprintf("%t", server.Spec.Config.PVP),
					},
					{
						Name:  "ONLINE_MODE",
						Value: fmt.Sprintf("%t", server.Spec.Config.OnlineMode),
					},
					{
						Name:  "ENABLE_COMMAND_BLOCK",
						Value: fmt.Sprintf("%t", server.Spec.Config.EnableCommandBlock),
					},
					{
						Name:  "ENFORCE_WHITELIST",
						Value: fmt.Sprintf("%t", server.Spec.Config.WhiteList),
					},
					// RCON configuration for remote console access
					{
						Name:  "ENABLE_RCON",
						Value: "true",
					},
					{
						Name:  "RCON_PASSWORD",
						Value: "minecraft",
					},
					{
						Name:  "RCON_PORT",
						Value: "25575",
					},
				},
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    server.Spec.Resources.CPURequest,
						corev1.ResourceMemory: server.Spec.Resources.MemoryRequest,
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    server.Spec.Resources.CPULimit,
						corev1.ResourceMemory: server.Spec.Resources.MemoryLimit,
					},
				},
				VolumeMounts: []corev1.VolumeMount{
					{
						Name:      "minecraft-data",
						MountPath: "/data",
					},
				},
				LivenessProbe: &corev1.Probe{
					ProbeHandler: corev1.ProbeHandler{
						TCPSocket: &corev1.TCPSocketAction{
							Port: intstr.FromInt(25565),
						},
					},
					InitialDelaySeconds: 120, // MC server takes time to start
					PeriodSeconds:       30,
					TimeoutSeconds:      5,
					FailureThreshold:    3,
				},
				ReadinessProbe: &corev1.Probe{
					ProbeHandler: corev1.ProbeHandler{
						TCPSocket: &corev1.TCPSocketAction{
							Port: intstr.FromInt(25565),
						},
					},
					InitialDelaySeconds: 60,
					PeriodSeconds:       10,
					TimeoutSeconds:      5,
					FailureThreshold:    6, // Give more time for initial startup
				},
			},
		},
		RestartPolicy: corev1.RestartPolicyAlways,
	}
}

// buildVolumeClaimTemplates creates the volume claim templates for persistent storage
func (r *MinecraftServerReconciler) buildVolumeClaimTemplates(server *minecraftv1.MinecraftServer) []corev1.PersistentVolumeClaim {
	return []corev1.PersistentVolumeClaim{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name: "minecraft-data",
			},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{
					corev1.ReadWriteOnce,
				},
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceStorage: server.Spec.Resources.Storage,
					},
				},
				StorageClassName: &server.Spec.StorageClass,
			},
		},
	}
}

// buildServerProperties generates the server.properties configuration
func (r *MinecraftServerReconciler) buildServerProperties(server *minecraftv1.MinecraftServer) string {
	properties := fmt.Sprintf(`# Minecraft server properties - Generated by operator
server-port=25565
max-players=%d
gamemode=%s
difficulty=%s
level-name=%s
motd=%s
white-list=%t
online-mode=%t
pvp=%t
enable-command-block=%t
op-permission-level=4
player-idle-timeout=0
max-world-size=29999984
`,
		server.Spec.Config.MaxPlayers,
		server.Spec.Config.Gamemode,
		server.Spec.Config.Difficulty,
		server.Spec.Config.LevelName,
		server.Spec.Config.MOTD,
		server.Spec.Config.WhiteList,
		server.Spec.Config.OnlineMode,
		server.Spec.Config.PVP,
		server.Spec.Config.EnableCommandBlock,
	)

	return properties
}

// updateServerStatus updates the MinecraftServer status based on StatefulSet status
func (r *MinecraftServerReconciler) updateServerStatus(ctx context.Context, server *minecraftv1.MinecraftServer) error {
	logger := log.FromContext(ctx)

	// Get StatefulSet status
	statefulSet := &appsv1.StatefulSet{}
	if err := r.Get(ctx, types.NamespacedName{
		Name:      server.Name,
		Namespace: server.Namespace,
	}, statefulSet); err != nil {
		return fmt.Errorf("failed to get StatefulSet: %w", err)
	}

	// Get Service to find external IP
	service := &corev1.Service{}
	var externalIP string
	var externalPort int32 = 25565
	if err := r.Get(ctx, types.NamespacedName{
		Name:      fmt.Sprintf("%s-service", server.Name),
		Namespace: server.Namespace,
	}, service); err == nil {
		// Try to get external IP from LoadBalancer
		if len(service.Status.LoadBalancer.Ingress) > 0 {
			if service.Status.LoadBalancer.Ingress[0].IP != "" {
				externalIP = service.Status.LoadBalancer.Ingress[0].IP
			} else if service.Status.LoadBalancer.Ingress[0].Hostname != "" {
				externalIP = service.Status.LoadBalancer.Ingress[0].Hostname
			}
		}
		// Get NodePort if set
		for _, port := range service.Spec.Ports {
			if port.Name == "minecraft" && port.NodePort > 0 {
				externalPort = port.NodePort
			}
		}
	}

	// Determine server status
	var phase string
	var message string
	previousPhase := server.Status.Phase

	// Check if server is intentionally stopped
	if server.Spec.Stopped {
		if statefulSet.Status.Replicas > 0 {
			phase = "Stopping"
			message = "Server is stopping"
		} else {
			phase = "Stopped"
			message = "Server is stopped"
		}
	} else if *statefulSet.Spec.Replicas > 0 && statefulSet.Status.ReadyReplicas == *statefulSet.Spec.Replicas {
		phase = "Running"
		message = "Server is running and ready"
	} else if statefulSet.Status.Replicas > 0 || *statefulSet.Spec.Replicas > 0 {
		phase = "Starting"
		message = "Server is starting up"
	} else {
		phase = "Pending"
		message = "Server is pending"
	}

	// Update status directly
	server.Status.Phase = phase
	server.Status.Message = message
	server.Status.LastUpdated = metav1.Now()
	server.Status.ExternalIP = externalIP
	server.Status.Port = externalPort

	// Query player count via RCON if server is running
	if phase == "Running" {
		playerInfo := r.queryPlayerCount(ctx, server)
		if playerInfo != nil {
			server.Status.PlayerCount = playerInfo.Online
			server.Status.MaxPlayers = playerInfo.Max
		}
	} else {
		// Reset player count when not running
		server.Status.PlayerCount = 0
	}

	// Set max players from config if not set from RCON
	if server.Status.MaxPlayers == 0 {
		server.Status.MaxPlayers = server.Spec.Config.MaxPlayers
	}

	if err := r.Status().Update(ctx, server); err != nil {
		return fmt.Errorf("failed to update status: %w", err)
	}

	// Publish state change event to NATS if phase changed
	if r.EventPublisher != nil && previousPhase != phase {
		logger.Info("Publishing state change event", "serverID", server.Spec.ServerID, "phase", phase)

		switch phase {
		case "Running":
			if err := r.EventPublisher.PublishServerRunning(
				server.Spec.ServerID,
				server.Spec.TenantID,
				server.Namespace,
				externalIP,
				int(externalPort),
				statefulSet.Status.ReadyReplicas,
				*statefulSet.Spec.Replicas,
			); err != nil {
				logger.Error(err, "Failed to publish server running event")
			}
		case "Starting":
			if err := r.EventPublisher.PublishServerStarting(
				server.Spec.ServerID,
				server.Spec.TenantID,
				server.Namespace,
				server.Name,
			); err != nil {
				logger.Error(err, "Failed to publish server starting event")
			}
		case "Stopped":
			if err := r.EventPublisher.PublishServerStopped(
				server.Spec.ServerID,
				server.Spec.TenantID,
				server.Namespace,
			); err != nil {
				logger.Error(err, "Failed to publish server stopped event")
			}
		}
	}

	return nil
}

// queryPlayerCount queries the Minecraft server via kubectl exec to run rcon-cli
func (r *MinecraftServerReconciler) queryPlayerCount(ctx context.Context, server *minecraftv1.MinecraftServer) *rcon.PlayerInfo {
	logger := log.FromContext(ctx)

	if r.Clientset == nil || r.RestConfig == nil {
		logger.V(1).Info("Clientset or RestConfig not available for exec")
		return nil
	}

	podName := fmt.Sprintf("%s-0", server.Name)

	// Check if pod exists and is running
	pod := &corev1.Pod{}
	if err := r.Get(ctx, types.NamespacedName{
		Name:      podName,
		Namespace: server.Namespace,
	}, pod); err != nil {
		logger.V(1).Info("Could not get pod for RCON query", "error", err)
		return nil
	}

	if pod.Status.Phase != corev1.PodRunning {
		logger.V(1).Info("Pod not running yet", "phase", pod.Status.Phase)
		return nil
	}

	// Execute rcon-cli list command inside the pod
	req := r.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(server.Namespace).
		SubResource("exec").
		Param("container", "minecraft-server").
		Param("command", "rcon-cli").
		Param("command", "list").
		Param("stdout", "true").
		Param("stderr", "true")

	exec, err := remotecommand.NewSPDYExecutor(r.RestConfig, "POST", req.URL())
	if err != nil {
		logger.V(1).Info("Failed to create executor", "error", err)
		return nil
	}

	var stdout, stderr bytes.Buffer
	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if err != nil {
		logger.V(1).Info("Failed to execute rcon-cli", "error", err, "stderr", stderr.String())
		return nil
	}

	response := stdout.String()
	logger.V(1).Info("RCON list response", "response", response)

	playerInfo, err := rcon.ParsePlayerList(response)
	if err != nil {
		logger.V(1).Info("Failed to parse player list", "error", err, "response", response)
		return nil
	}

	logger.V(1).Info("Got player count", "online", playerInfo.Online, "max", playerInfo.Max)
	return playerInfo
}

// updateStatus updates the MinecraftServer status
func (r *MinecraftServerReconciler) updateStatus(ctx context.Context, server *minecraftv1.MinecraftServer, status, message string) (ctrl.Result, error) {
	server.Status.Phase = status
	server.Status.Message = message
	server.Status.LastUpdated = metav1.Now()

	if err := r.Status().Update(ctx, server); err != nil {
		return ctrl.Result{}, fmt.Errorf("failed to update status: %w", err)
	}

	// Determine requeue interval based on status
	var requeueAfter time.Duration
	switch status {
	case "Starting":
		requeueAfter = 10 * time.Second
	case "Error":
		requeueAfter = 30 * time.Second
	default:
		requeueAfter = 60 * time.Second
	}

	return ctrl.Result{RequeueAfter: requeueAfter}, nil
}

// SetupWithManager sets up the controller with the Manager
func (r *MinecraftServerReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&minecraftv1.MinecraftServer{}).
		Owns(&appsv1.StatefulSet{}).
		Owns(&corev1.Service{}).
		Owns(&corev1.ConfigMap{}).
		Complete(r)
}
