package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	v1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var (
	mcServerGVR = schema.GroupVersionResource{
		Group:    "minecraft.platform",
		Version:  "v1",
		Resource: "minecraftservers",
	}
)

type MinecraftServerSpec struct {
	Version   string            `json:"version"`
	Resources ResourceRequirements `json:"resources"`
	ServerProperties map[string]string `json:"serverProperties"`
}

type ResourceRequirements struct {
	CPU     string `json:"cpu"`
	Memory  string `json:"memory"`
	Storage string `json:"storage"`
}

type MinecraftServerStatus struct {
	Phase string `json:"phase"`
}

type MinecraftServerController struct {
	clientset     kubernetes.Interface
	dynamicClient dynamic.Interface
}

func main() {
	log.Println("🎮 Starting Minecraft Platform Operator")

	// Create Kubernetes client
	config, err := getKubernetesConfig()
	if err != nil {
		log.Fatalf("Failed to get Kubernetes config: %v", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Fatalf("Failed to create Kubernetes clientset: %v", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		log.Fatalf("Failed to create dynamic client: %v", err)
	}

	controller := &MinecraftServerController{
		clientset:     clientset,
		dynamicClient: dynamicClient,
	}

	log.Println("✅ Kubernetes clients initialized")
	log.Println("🔍 Starting to watch MinecraftServer resources...")

	// Start watching MinecraftServer resources
	wait.Forever(func() {
		controller.watchMinecraftServers()
	}, time.Second*30)
}

func getKubernetesConfig() (*rest.Config, error) {
	// Try in-cluster config first
	config, err := rest.InClusterConfig()
	if err == nil {
		return config, nil
	}

	// Fall back to kubeconfig file
	kubeconfig := os.Getenv("KUBECONFIG")
	if kubeconfig == "" {
		kubeconfig = os.Getenv("HOME") + "/.kube/config"
	}

	return clientcmd.BuildConfigFromFlags("", kubeconfig)
}

func (c *MinecraftServerController) watchMinecraftServers() {
	log.Println("🔄 Checking for MinecraftServer resources...")

	// List all MinecraftServer resources
	resources, err := c.dynamicClient.Resource(mcServerGVR).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		log.Printf("❌ Error listing MinecraftServer resources: %v", err)
		return
	}

	log.Printf("📋 Found %d MinecraftServer resources", len(resources.Items))

	for _, resource := range resources.Items {
		err := c.reconcileMinecraftServer(resource.Object)
		if err != nil {
			log.Printf("❌ Error reconciling MinecraftServer %s: %v", resource.GetName(), err)
		}
	}
}

func (c *MinecraftServerController) reconcileMinecraftServer(obj map[string]interface{}) error {
	name := obj["metadata"].(map[string]interface{})["name"].(string)
	namespace := obj["metadata"].(map[string]interface{})["namespace"].(string)

	log.Printf("🎯 Reconciling MinecraftServer: %s/%s", namespace, name)

	// Check if deployment exists
	deploymentName := fmt.Sprintf("minecraft-%s", name)
	_, err := c.clientset.AppsV1().Deployments(namespace).Get(context.TODO(), deploymentName, metav1.GetOptions{})

	if errors.IsNotFound(err) {
		// Create deployment
		log.Printf("🚀 Creating deployment for MinecraftServer: %s", name)
		return c.createMinecraftDeployment(obj, namespace, deploymentName)
	} else if err != nil {
		return fmt.Errorf("error checking deployment: %v", err)
	}

	log.Printf("✅ Deployment already exists for MinecraftServer: %s", name)
	return nil
}

func (c *MinecraftServerController) createMinecraftDeployment(obj map[string]interface{}, namespace, deploymentName string) error {
	spec := obj["spec"].(map[string]interface{})

	// Extract spec details
	version := spec["version"].(string)
	resources := spec["resources"].(map[string]interface{})

	// Create deployment
	deployment := &v1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      deploymentName,
			Namespace: namespace,
			Labels: map[string]string{
				"app":                          "minecraft",
				"minecraft.platform/server":   obj["metadata"].(map[string]interface{})["name"].(string),
				"minecraft.platform/version":  version,
			},
		},
		Spec: v1.DeploymentSpec{
			Replicas: int32Ptr(1),
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "minecraft",
					"minecraft.platform/server": obj["metadata"].(map[string]interface{})["name"].(string),
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app": "minecraft",
						"minecraft.platform/server": obj["metadata"].(map[string]interface{})["name"].(string),
					},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "minecraft",
							Image: "itzg/minecraft-server:latest",
							Ports: []corev1.ContainerPort{
								{
									ContainerPort: 25565,
									Protocol:      corev1.ProtocolTCP,
								},
							},
							Env: []corev1.EnvVar{
								{
									Name:  "EULA",
									Value: "TRUE",
								},
								{
									Name:  "VERSION",
									Value: version,
								},
								{
									Name:  "MEMORY",
									Value: resources["memory"].(string),
								},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceMemory: parseQuantity(resources["memory"].(string)),
									corev1.ResourceCPU:    parseQuantity(resources["cpu"].(string)),
								},
								Limits: corev1.ResourceList{
									corev1.ResourceMemory: parseQuantity(resources["memory"].(string)),
									corev1.ResourceCPU:    parseQuantity(resources["cpu"].(string)),
								},
							},
						},
					},
				},
			},
		},
	}

	_, err := c.clientset.AppsV1().Deployments(namespace).Create(context.TODO(), deployment, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to create deployment: %v", err)
	}

	// Create service
	serviceName := fmt.Sprintf("minecraft-%s-service", obj["metadata"].(map[string]interface{})["name"].(string))
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: namespace,
			Labels: map[string]string{
				"app": "minecraft",
				"minecraft.platform/server": obj["metadata"].(map[string]interface{})["name"].(string),
			},
		},
		Spec: corev1.ServiceSpec{
			Type: corev1.ServiceTypeNodePort,
			Ports: []corev1.ServicePort{
				{
					Port:       25565,
					TargetPort: intstr.FromInt(25565),
					Protocol:   corev1.ProtocolTCP,
				},
			},
			Selector: map[string]string{
				"app": "minecraft",
				"minecraft.platform/server": obj["metadata"].(map[string]interface{})["name"].(string),
			},
		},
	}

	_, err = c.clientset.CoreV1().Services(namespace).Create(context.TODO(), service, metav1.CreateOptions{})
	if err != nil {
		log.Printf("⚠️  Failed to create service (may already exist): %v", err)
	}

	log.Printf("✅ Created Minecraft deployment and service for: %s", obj["metadata"].(map[string]interface{})["name"].(string))
	return nil
}

func int32Ptr(i int32) *int32 {
	return &i
}

func parseQuantity(s string) resource.Quantity {
	qty, err := resource.ParseQuantity(s)
	if err != nil {
		log.Printf("⚠️  Failed to parse quantity %s, using default: %v", s, err)
		// Return a default quantity
		return resource.MustParse("1")
	}
	return qty
}