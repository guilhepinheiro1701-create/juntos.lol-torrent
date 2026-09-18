// Package httpapi assembles the HTTP API of the server.
package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/room"
)

type ServerOption func(*serverOptions)

type serverOptions struct {
	sourceHooks       SourceHooks
	subtitlePublisher SubtitlePublisher
	clientMediaBucket ClientMediaBucket
	clientMediaHooks  ClientMediaHooks
	torrentAccess     TorrentAccess
	workerLink        gin.HandlerFunc
	pluginSessions    *Sessions
	pluginQuota       *Quota
	positionHooks     PositionHooks
}

// WithPosition receives the viewer's playback position: what production should
// follow, and the sign that the room is still being watched.
func WithPosition(hooks PositionHooks) ServerOption {
	return func(o *serverOptions) { o.positionHooks = hooks }
}

// WithPluginFetch puts a session and an hourly budget on the plugin hop.
func WithPluginFetch(sessions *Sessions, quota *Quota) ServerOption {
	return func(o *serverOptions) {
		o.pluginSessions = sessions
		o.pluginQuota = quota
	}
}

func WithTorrents(access TorrentAccess, workerLink gin.HandlerFunc) ServerOption {
	return func(o *serverOptions) {
		o.torrentAccess = access
		o.workerLink = workerLink
	}
}

func WithSourceHooks(hooks SourceHooks) ServerOption {
	return func(o *serverOptions) { o.sourceHooks = hooks }
}

// WithSubtitlePublisher sends browser-extracted subtitles to the bucket they are
// served from; without it they are stored but never delivered.
func WithSubtitlePublisher(publisher SubtitlePublisher) ServerOption {
	return func(o *serverOptions) { o.subtitlePublisher = publisher }
}

// WithClientMedia enables the only path by which media reaches a room: the host's
// browser remuxes the source and writes segments into the bucket via presigned URLs.
func WithClientMedia(bucket ClientMediaBucket, hooks ClientMediaHooks) ServerOption {
	return func(o *serverOptions) {
		o.clientMediaBucket = bucket
		o.clientMediaHooks = hooks
	}
}

func NewServer(cfg config.Config, store *room.Store, opts ...ServerOption) *gin.Engine {
	var options serverOptions
	for _, apply := range opts {
		apply(&options)
	}
	r := gin.Default()
	if err := r.SetTrustedProxies(nil); err != nil {
		panic("configure trusted proxies: " + err.Error())
	}
	r.Use(privacyHeaders())
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	RegisterRoomRoutes(r.Group("/api"), store, cfg)
	waiter := newPlaylistWaiter()
	RegisterMediaRoutes(r, store, waiter)
	options.clientMediaHooks.NotifyPlaylists = waiter.Notify
	// The room no longer pushes anything: the page polls for what it needs, so
	// there is nobody left to notify that subtitles landed.
	RegisterSubtitlesRoute(r.Group("/api"), store, cfg, options.subtitlePublisher, nil)
	RegisterSourceRoute(r.Group("/api"), store, cfg, nil, options.sourceHooks)
	RegisterPositionRoute(r.Group("/api"), store, nil, options.positionHooks)
	RegisterClientMediaRoutes(r.Group("/api"), store, cfg, options.clientMediaBucket, options.clientMediaHooks)
	RegisterTorrentRoutes(r.Group("/api"), cfg, options.torrentAccess)
	RegisterYoutubeRoutes(r.Group("/api"), cfg, options.torrentAccess)
	if options.workerLink != nil {
		r.GET("/ws/worker-link", options.workerLink)
	}
	RegisterRelayRoute(r, options.torrentAccess.Service)
	RegisterPluginFetchRoute(r.Group("/api"), NewPluginFetcher(cfg), options.pluginSessions, options.pluginQuota)
	registerFrontend(r, cfg.WebDir)
	return r
}

func privacyHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		if strings.HasPrefix(c.Request.URL.Path, "/assets/plugin-worker/") {
			c.Header("Content-Security-Policy", "default-src 'none'; script-src blob:")
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api/") || strings.HasPrefix(c.Request.URL.Path, "/ws/") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	}
}

func registerFrontend(r *gin.Engine, webDir string) {
	if webDir == "" {
		return
	}
	r.Static("/assets", filepath.Join(webDir, "assets"))
	r.Static("/docs", filepath.Join(webDir, "docs"))
	entries, _ := os.ReadDir(webDir)
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == "index.html" {
			continue
		}
		r.StaticFile("/"+entry.Name(), filepath.Join(webDir, entry.Name()))
	}
	r.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet || strings.HasPrefix(c.Request.URL.Path, "/api/") ||
			strings.HasPrefix(c.Request.URL.Path, "/media/") || strings.HasPrefix(c.Request.URL.Path, "/ws/") ||
			strings.HasPrefix(c.Request.URL.Path, "/docs/") {
			c.Status(http.StatusNotFound)
			return
		}
		c.File(filepath.Join(webDir, "index.html"))
	})
}
