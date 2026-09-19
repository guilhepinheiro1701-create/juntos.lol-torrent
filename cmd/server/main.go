// The ss server does no media work: it creates rooms, keeps their members in step
// over WebSocket, signs the bucket writes the host's browser makes while remuxing
// its own source, and accepts the playlists that come out of that.
package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/httpapi"
	"github.com/giulianoo0/ss/internal/janitor"
	"github.com/giulianoo0/ss/internal/media"
	"github.com/giulianoo0/ss/internal/objectstore"
	"github.com/giulianoo0/ss/internal/room"
	"github.com/giulianoo0/ss/internal/worker"
)

// mediaStore is everything the server asks of its object store, whether that
// is a bucket far away or a folder on this disk.
type mediaStore interface {
	objectstore.Store
	room.MediaStore
	httpapi.ClientMediaBucket
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatal(err)
	}
	rdb := redis.NewClient(opts)
	store := room.NewStore(rdb, time.Duration(cfg.RoomTTLHours)*time.Hour)

	// One store, four jobs: it publishes, it hands segments back, it is swept
	// and it is reclaimed. Which one is behind the interface is the only thing
	// that separates the cloud install from the one on a single computer.
	var bucket mediaStore
	var localMedia *objectstore.Disk
	if cfg.MediaDir != "" {
		localMedia, err = objectstore.NewDisk(cfg.MediaDir,
			strings.TrimSuffix(cfg.MediaPublicURL, objectstore.UploadPath))
		if err != nil {
			log.Fatal(err)
		}
		bucket = localMedia
	} else {
		r2, err := objectstore.NewR2(objectstore.R2Config{
			AccountID: cfg.R2AccountID,
			Bucket:    cfg.R2Bucket,
			AccessKey: cfg.R2AccessKeyID,
			SecretKey: cfg.R2SecretAccessKey,
			Endpoint:  cfg.R2Endpoint,
			Insecure:  cfg.R2Insecure,
		})
		if err != nil {
			log.Fatal(err)
		}
		bucket = r2
	}
	publisher := media.NewPublisher(store, bucket, cfg.MediaPublicURL)

	ctx := context.Background()
	go room.StartSweeper(ctx, store, cfg.DataDir, bucket, time.Minute,
		time.Duration(cfg.UploadIdleMinutes)*time.Minute)
	keeper := janitor.New(store, cfg, bucket)
	go keeper.Run(ctx)

	signer, err := worker.LoadOrCreateSigner(cfg.WorkerSigningKeyFile)
	if err != nil {
		log.Fatal(err)
	}
	blocklist, err := worker.LoadBlocklist(cfg.TorrentBlocklistFile)
	if err != nil {
		log.Fatal(err)
	}
	registry := worker.NewRegistry(rdb)
	workerHub := worker.NewHub(registry, signer, cfg.WorkerEnrollmentSecret)
	quota := httpapi.NewQuota(rdb, cfg.TorrentDispatchPerHour, cfg.TorrentConcurrentJobs, cfg.TorrentBytesPerDayGB<<30, cfg.PluginFetchPerHour)
	torrents := &worker.Service{
		Registry:  registry,
		Hub:       workerHub,
		Signer:    signer,
		Blocklist: blocklist,
		Quota:     quota,
		TicketTTL: time.Duration(cfg.WorkerTicketMinutes) * time.Minute,
		RelayBase: cfg.WorkerRelayBase,
		JobTTL:    time.Duration(cfg.RoomTTLHours) * time.Hour,
	}
	var swarmMu sync.Mutex
	lastSwarm := map[string]worker.SwarmStats{}
	torrents.OnSwarm = func(roomID string, stats worker.SwarmStats) {
		swarmMu.Lock()
		same := lastSwarm[roomID] == stats
		lastSwarm[roomID] = stats
		swarmMu.Unlock()
		if same {
			return
		}
		swarmCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		if err := store.SetSwarm(swarmCtx, roomID, room.SwarmStats{
			Peers: stats.Peers, DownSpeed: stats.DownSpeed, HaveBytes: stats.HaveBytes,
			SelectedBytes: stats.SelectedBytes, DiskBytes: stats.DiskBytes,
		}); err != nil {
			return
		}
	}
	remuxOrch := worker.NewRemuxOrchestrator(torrents, store, cfg)
	keeper.OnReclaimed = func(roomID string) {
		remuxOrch.CancelRoom(roomID)
		torrents.CancelRoom(roomID)
	}
	workerHub.OnHeartbeat(func(workerID string, hb worker.Heartbeat) {
		torrents.Charge(workerID, hb)
		torrents.ObserveLives(workerID, hb)
		remuxOrch.ObserveHeartbeat(workerID, hb)
	})
	go torrents.StartSweeper(ctx, time.Minute, time.Duration(cfg.UploadIdleMinutes)*time.Minute)
	sessions := httpapi.NewSessions(rdb, time.Duration(cfg.SessionTTLDays)*24*time.Hour, cfg.SessionsPerIPPerHour, cfg.BehindCloudflare)

	r := httpapi.NewServer(cfg, store,
		httpapi.WithSubtitlePublisher(publisher),
		httpapi.WithClientMedia(bucket, httpapi.ClientMediaHooks{}),
		httpapi.WithLocalMedia(localMedia),
		httpapi.WithSourceHooks(httpapi.SourceHooks{CancelMedia: func(roomID string) {
			remuxOrch.CancelRoom(roomID)
			torrents.CancelRoom(roomID)
		}}),
		httpapi.WithPosition(httpapi.PositionHooks{Follow: remuxOrch.Follow, Seen: keeper.Seen}),
		httpapi.WithTorrents(httpapi.TorrentAccess{Sessions: sessions, Quota: quota, Service: torrents,
			Remux: remuxOrch}, workerHub.HandleLink),
		httpapi.WithPluginFetch(sessions, quota),
	)

	if err := r.Run(fmt.Sprintf(":%d", cfg.Port)); err != nil {
		log.Fatal(err)
	}
}
