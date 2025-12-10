package main

import (
	"flag"
	"os"
	"path/filepath"

	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	minecraftv1 "minecraft-platform-operator/api/v1"
	"minecraft-platform-operator/controllers"
	"minecraft-platform-operator/pkg/events"
)

var (
	scheme   = runtime.NewScheme()
	setupLog = ctrl.Log.WithName("setup")
)

func init() {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(minecraftv1.AddToScheme(scheme))
}

func main() {
	var metricsAddr string
	var enableLeaderElection bool
	var probeAddr string
	var natsURL string
	var enableEvents bool

	// Default kubeconfig path
	var kubeconfig string
	if home := os.Getenv("USERPROFILE"); home != "" {
		kubeconfig = filepath.Join(home, ".kube", "config")
	} else if home := os.Getenv("HOME"); home != "" {
		kubeconfig = filepath.Join(home, ".kube", "config")
	}

	flag.StringVar(&metricsAddr, "metrics-bind-address", ":8080", "The address the metric endpoint binds to.")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "The address the probe endpoint binds to.")
	flag.BoolVar(&enableLeaderElection, "leader-elect", false,
		"Enable leader election for controller manager. "+
			"Enabling this will ensure there is only one active controller manager.")
	flag.StringVar(&natsURL, "nats-url", "nats://nats.minecraft-system:4222", "NATS server URL for event publishing")
	flag.BoolVar(&enableEvents, "enable-events", true, "Enable NATS event publishing")

	opts := zap.Options{
		Development: true,
	}
	opts.BindFlags(flag.CommandLine)
	flag.Parse()

	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts)))

	// Initialize event publisher if enabled
	var eventPublisher *events.EventPublisher
	if enableEvents {
		var err error
		eventPublisher, err = events.NewEventPublisher(&events.EventPublisherConfig{
			NATSUrl:    natsURL,
			StreamName: "MINECRAFT_EVENTS",
			Enabled:    true,
		})
		if err != nil {
			setupLog.Info("Warning: Could not connect to NATS, events will be disabled", "error", err)
			eventPublisher = nil
		} else {
			defer eventPublisher.Close()
		}
	}

	// Get the rest config - try in-cluster first, then kubeconfig file
	var restConfig *rest.Config
	var configErr error

	// Try in-cluster config first
	restConfig, configErr = rest.InClusterConfig()
	if configErr != nil {
		// Not in cluster, use kubeconfig file
		setupLog.Info("Not running in cluster, using kubeconfig", "path", kubeconfig)
		restConfig, configErr = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if configErr != nil {
			setupLog.Error(configErr, "unable to load kubeconfig")
			os.Exit(1)
		}
	}

	mgr, err := ctrl.NewManager(restConfig, ctrl.Options{
		Scheme:                  scheme,
		Metrics:                 metricsserver.Options{BindAddress: metricsAddr},
		HealthProbeBindAddress:  probeAddr,
		LeaderElection:          enableLeaderElection,
		LeaderElectionID:        "minecraft-platform-operator.minecraft.platform.com",
	})
	if err != nil {
		setupLog.Error(err, "unable to start manager")
		os.Exit(1)
	}

	// Create kubernetes clientset for exec operations (player count query)
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		setupLog.Error(err, "unable to create kubernetes clientset")
		os.Exit(1)
	}

	if err = (&controllers.MinecraftServerReconciler{
		Client:         mgr.GetClient(),
		Scheme:         mgr.GetScheme(),
		EventPublisher: eventPublisher,
		Clientset:      clientset,
		RestConfig:     restConfig,
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create controller", "controller", "MinecraftServer")
		os.Exit(1)
	}

	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		setupLog.Error(err, "unable to set up health check")
		os.Exit(1)
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		setupLog.Error(err, "unable to set up ready check")
		os.Exit(1)
	}

	setupLog.Info("starting manager")
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		setupLog.Error(err, "problem running manager")
		os.Exit(1)
	}
}
