package performance

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/cloudfront"
	"github.com/aws/aws-sdk-go/service/s3"
)

// CDNConfig holds CDN configuration settings
type CDNConfig struct {
	Provider         string            `json:"provider"`
	DistributionID   string            `json:"distribution_id"`
	Domain           string            `json:"domain"`
	S3Bucket         string            `json:"s3_bucket"`
	S3Region         string            `json:"s3_region"`
	CacheTTL         map[string]int64  `json:"cache_ttl"`
	CompressionTypes []string          `json:"compression_types"`
	Headers          map[string]string `json:"headers"`
}

// CDNManager handles CDN operations for static asset delivery
type CDNManager struct {
	config       CDNConfig
	s3Client     *s3.S3
	cloudfrontClient *cloudfront.CloudFront
	httpClient   *http.Client
}

// AssetType represents different types of assets that can be cached
type AssetType string

const (
	AssetTypeStatic     AssetType = "static"
	AssetTypeImage      AssetType = "image"
	AssetTypeJavascript AssetType = "javascript"
	AssetTypeCSS        AssetType = "css"
	AssetTypeFonts      AssetType = "fonts"
	AssetTypePlugins    AssetType = "plugins"
	AssetTypeWorlds     AssetType = "worlds"
)

// CacheInvalidation represents a CDN cache invalidation request
type CacheInvalidation struct {
	Paths         []string  `json:"paths"`
	CallerReference string  `json:"caller_reference"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
}

// NewCDNManager creates a new CDN manager instance
func NewCDNManager(config CDNConfig) (*CDNManager, error) {
	// Initialize AWS session
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(config.S3Region),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create AWS session: %w", err)
	}

	return &CDNManager{
		config:           config,
		s3Client:         s3.New(sess),
		cloudfrontClient: cloudfront.New(sess),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// UploadAsset uploads an asset to S3 with CDN-optimized settings
func (cdn *CDNManager) UploadAsset(ctx context.Context, key string, content io.Reader, assetType AssetType) error {
	// Read content into buffer to get size
	buf := &bytes.Buffer{}
	size, err := buf.ReadFrom(content)
	if err != nil {
		return fmt.Errorf("failed to read asset content: %w", err)
	}

	// Determine content type
	contentType := cdn.getContentType(key, assetType)

	// Set up S3 upload parameters
	uploadParams := &s3.PutObjectInput{
		Bucket:      aws.String(cdn.config.S3Bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(buf.Bytes()),
		ContentType: aws.String(contentType),
		ACL:         aws.String("public-read"),
	}

	// Set caching headers based on asset type
	cacheTTL := cdn.getCacheTTL(assetType)
	cacheControl := fmt.Sprintf("public, max-age=%d", cacheTTL)
	uploadParams.CacheControl = aws.String(cacheControl)

	// Set compression if applicable
	if cdn.shouldCompress(assetType) {
		uploadParams.ContentEncoding = aws.String("gzip")
	}

	// Add custom headers
	metadata := make(map[string]*string)
	for k, v := range cdn.config.Headers {
		metadata[k] = aws.String(v)
	}
	uploadParams.Metadata = metadata

	// Upload to S3
	_, err = cdn.s3Client.PutObjectWithContext(ctx, uploadParams)
	if err != nil {
		return fmt.Errorf("failed to upload asset to S3: %w", err)
	}

	log.Printf("Successfully uploaded asset: %s (%d bytes)", key, size)
	return nil
}

// GetAssetURL returns the CDN URL for an asset
func (cdn *CDNManager) GetAssetURL(key string) string {
	return fmt.Sprintf("https://%s/%s", cdn.config.Domain, key)
}

// InvalidateCache invalidates CDN cache for specified paths
func (cdn *CDNManager) InvalidateCache(ctx context.Context, paths []string) (*CacheInvalidation, error) {
	callerReference := fmt.Sprintf("invalidation-%d", time.Now().Unix())

	// Create CloudFront invalidation
	invalidationInput := &cloudfront.CreateInvalidationInput{
		DistributionId: aws.String(cdn.config.DistributionID),
		InvalidationBatch: &cloudfront.InvalidationBatch{
			CallerReference: aws.String(callerReference),
			Paths: &cloudfront.Paths{
				Quantity: aws.Int64(int64(len(paths))),
				Items:    aws.StringSlice(paths),
			},
		},
	}

	result, err := cdn.cloudfrontClient.CreateInvalidationWithContext(ctx, invalidationInput)
	if err != nil {
		return nil, fmt.Errorf("failed to create cache invalidation: %w", err)
	}

	invalidation := &CacheInvalidation{
		Paths:           paths,
		CallerReference: callerReference,
		Status:          *result.Invalidation.Status,
		CreatedAt:       time.Now(),
	}

	log.Printf("Created cache invalidation: %s for %d paths", callerReference, len(paths))
	return invalidation, nil
}

// PurgeAssetCache purges cache for specific asset types
func (cdn *CDNManager) PurgeAssetCache(ctx context.Context, assetType AssetType) error {
	var paths []string

	switch assetType {
	case AssetTypeStatic:
		paths = []string{"/static/*"}
	case AssetTypeImage:
		paths = []string{"/images/*", "/textures/*"}
	case AssetTypeJavascript:
		paths = []string{"/js/*", "/scripts/*"}
	case AssetTypeCSS:
		paths = []string{"/css/*", "/styles/*"}
	case AssetTypeFonts:
		paths = []string{"/fonts/*"}
	case AssetTypePlugins:
		paths = []string{"/plugins/*"}
	case AssetTypeWorlds:
		paths = []string{"/worlds/*"}
	default:
		return fmt.Errorf("unknown asset type: %s", assetType)
	}

	_, err := cdn.InvalidateCache(ctx, paths)
	return err
}

// OptimizeImages optimizes and uploads images with multiple formats
func (cdn *CDNManager) OptimizeImages(ctx context.Context, originalKey string, imageData io.Reader) error {
	// TODO: Implement image optimization
	// - Resize to multiple dimensions (thumbnail, medium, large)
	// - Convert to modern formats (WebP, AVIF)
	// - Compress with optimal quality settings
	// - Generate responsive image variants

	log.Printf("Image optimization for %s (placeholder implementation)", originalKey)
	return nil
}

// PreloadAssets preloads frequently accessed assets
func (cdn *CDNManager) PreloadAssets(ctx context.Context, assetKeys []string) error {
	log.Printf("Preloading %d assets...", len(assetKeys))

	for _, key := range assetKeys {
		assetURL := cdn.GetAssetURL(key)

		// Make HEAD request to warm CDN cache
		req, err := http.NewRequestWithContext(ctx, "HEAD", assetURL, nil)
		if err != nil {
			log.Printf("Warning: Could not create request for %s: %v", assetURL, err)
			continue
		}

		resp, err := cdn.httpClient.Do(req)
		if err != nil {
			log.Printf("Warning: Could not preload %s: %v", assetURL, err)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("Warning: Unexpected status for %s: %d", assetURL, resp.StatusCode)
		}
	}

	log.Printf("Asset preloading completed")
	return nil
}

// GetCacheStatistics returns CDN cache performance statistics
func (cdn *CDNManager) GetCacheStatistics(ctx context.Context) (map[string]interface{}, error) {
	// Get CloudFront statistics
	statsInput := &cloudfront.GetDistributionInput{
		Id: aws.String(cdn.config.DistributionID),
	}

	result, err := cdn.cloudfrontClient.GetDistributionWithContext(ctx, statsInput)
	if err != nil {
		return nil, fmt.Errorf("failed to get distribution statistics: %w", err)
	}

	stats := map[string]interface{}{
		"distribution_id":     *result.Distribution.Id,
		"domain_name":         *result.Distribution.DomainName,
		"status":              *result.Distribution.Status,
		"enabled":             *result.Distribution.DistributionConfig.Enabled,
		"price_class":         *result.Distribution.DistributionConfig.PriceClass,
		"default_root_object": "",
	}

	if result.Distribution.DistributionConfig.DefaultRootObject != nil {
		stats["default_root_object"] = *result.Distribution.DistributionConfig.DefaultRootObject
	}

	// TODO: Get more detailed statistics from CloudWatch
	// - Request count
	// - Data transfer
	// - Cache hit ratio
	// - Error rates

	return stats, nil
}

// Helper methods

// getContentType determines the appropriate content type for an asset
func (cdn *CDNManager) getContentType(key string, assetType AssetType) string {
	// Try to detect from file extension first
	ext := strings.ToLower(filepath.Ext(key))
	if contentType := mime.TypeByExtension(ext); contentType != "" {
		return contentType
	}

	// Fall back to asset type defaults
	switch assetType {
	case AssetTypeJavascript:
		return "application/javascript"
	case AssetTypeCSS:
		return "text/css"
	case AssetTypeImage:
		return "image/png" // Default, should be detected by extension
	case AssetTypeFonts:
		return "font/woff2"
	case AssetTypePlugins:
		return "application/java-archive"
	case AssetTypeWorlds:
		return "application/zip"
	default:
		return "application/octet-stream"
	}
}

// getCacheTTL returns the cache TTL for an asset type
func (cdn *CDNManager) getCacheTTL(assetType AssetType) int64 {
	if ttl, exists := cdn.config.CacheTTL[string(assetType)]; exists {
		return ttl
	}

	// Default TTL values (in seconds)
	switch assetType {
	case AssetTypeStatic:
		return 31536000 // 1 year
	case AssetTypeImage:
		return 2592000 // 30 days
	case AssetTypeJavascript:
		return 604800 // 7 days
	case AssetTypeCSS:
		return 604800 // 7 days
	case AssetTypeFonts:
		return 31536000 // 1 year
	case AssetTypePlugins:
		return 86400 // 1 day
	case AssetTypeWorlds:
		return 3600 // 1 hour
	default:
		return 3600 // 1 hour
	}
}

// shouldCompress determines if an asset type should be compressed
func (cdn *CDNManager) shouldCompress(assetType AssetType) bool {
	compressibleTypes := map[AssetType]bool{
		AssetTypeJavascript: true,
		AssetTypeCSS:        true,
		AssetTypeStatic:     true, // HTML, JSON, etc.
	}

	return compressibleTypes[assetType]
}

// MinecraftAssetManager handles Minecraft-specific asset management
type MinecraftAssetManager struct {
	cdn *CDNManager
}

// NewMinecraftAssetManager creates a new Minecraft asset manager
func NewMinecraftAssetManager(cdn *CDNManager) *MinecraftAssetManager {
	return &MinecraftAssetManager{
		cdn: cdn,
	}
}

// UploadPluginJar uploads a plugin JAR file to CDN
func (mam *MinecraftAssetManager) UploadPluginJar(ctx context.Context, pluginID, version string, jarData io.Reader) error {
	key := fmt.Sprintf("plugins/%s/%s/%s-%s.jar", pluginID, version, pluginID, version)
	return mam.cdn.UploadAsset(ctx, key, jarData, AssetTypePlugins)
}

// UploadWorldData uploads world data archive to CDN
func (mam *MinecraftAssetManager) UploadWorldData(ctx context.Context, worldID string, worldData io.Reader) error {
	key := fmt.Sprintf("worlds/%s/world.zip", worldID)
	return mam.cdn.UploadAsset(ctx, key, worldData, AssetTypeWorlds)
}

// UploadServerIcon uploads server icon to CDN with optimization
func (mam *MinecraftAssetManager) UploadServerIcon(ctx context.Context, serverID string, iconData io.Reader) error {
	key := fmt.Sprintf("server-icons/%s/icon.png", serverID)

	// Upload original icon
	err := mam.cdn.UploadAsset(ctx, key, iconData, AssetTypeImage)
	if err != nil {
		return err
	}

	// TODO: Generate thumbnail versions
	// - 64x64 for server list
	// - 32x32 for compact view
	// - 16x16 for favicon

	return nil
}

// GetPluginDownloadURL returns the CDN URL for plugin download
func (mam *MinecraftAssetManager) GetPluginDownloadURL(pluginID, version string) string {
	key := fmt.Sprintf("plugins/%s/%s/%s-%s.jar", pluginID, version, pluginID, version)
	return mam.cdn.GetAssetURL(key)
}

// GetWorldDownloadURL returns the CDN URL for world download
func (mam *MinecraftAssetManager) GetWorldDownloadURL(worldID string) string {
	key := fmt.Sprintf("worlds/%s/world.zip", worldID)
	return mam.cdn.GetAssetURL(key)
}

// GetServerIconURL returns the CDN URL for server icon
func (mam *MinecraftAssetManager) GetServerIconURL(serverID string) string {
	key := fmt.Sprintf("server-icons/%s/icon.png", serverID)
	return mam.cdn.GetAssetURL(key)
}

// InvalidatePluginCache invalidates cache for a specific plugin
func (mam *MinecraftAssetManager) InvalidatePluginCache(ctx context.Context, pluginID string) error {
	paths := []string{fmt.Sprintf("/plugins/%s/*", pluginID)}
	_, err := mam.cdn.InvalidateCache(ctx, paths)
	return err
}

// InvalidateServerAssets invalidates all assets for a server
func (mam *MinecraftAssetManager) InvalidateServerAssets(ctx context.Context, serverID string) error {
	paths := []string{
		fmt.Sprintf("/server-icons/%s/*", serverID),
		fmt.Sprintf("/worlds/%s/*", serverID),
	}
	_, err := mam.cdn.InvalidateCache(ctx, paths)
	return err
}