// Package janitor reclaims rooms nobody is watching.
//
// This used to live inside the room socket, which knew a room was abandoned
// because no client held a connection to it. With one viewer and no socket
// there is nothing to hold, so abandonment is measured the other way round:
// the browser says where it is while it is watching, and a room that has said
// nothing for long enough is gone.
package janitor

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/objectstore"
	"github.com/giulianoo0/ss/internal/room"
)

const (
	storeTimeout = 5 * time.Second
	sweepEvery   = time.Minute
	// How long a freshly created room is presumed to be preparing rather than
	// abandoned, so a slow source is not swept out from under itself.
	preparingGrace = 10 * time.Minute
)

// Keeper sweeps abandoned rooms. The zero value is not usable; build one with
// New. A nil Bucket means there is no object store to clean up after.
type Keeper struct {
	store     *room.Store
	cfg       config.Config
	bucket    room.MediaStore
	idleAfter time.Duration

	// OnReclaimed runs after a room is gone, so the work behind it can be
	// cancelled. Set it before Run; it is read without a lock.
	OnReclaimed func(roomID string)

	mu   sync.Mutex
	seen map[string]time.Time
}

func New(store *room.Store, cfg config.Config, bucket room.MediaStore) *Keeper {
	idle := time.Duration(cfg.RoomIdleSeconds) * time.Second
	if idle <= 0 {
		idle = 20 * time.Minute
	}
	return &Keeper{store: store, cfg: cfg, bucket: bucket, idleAfter: idle, seen: map[string]time.Time{}}
}

// Seen records that someone is watching this room right now.
func (k *Keeper) Seen(roomID string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.seen[roomID] = time.Now()
}

// Forget drops a room's record, so a room removed by other means does not keep
// a timestamp alive in memory.
func (k *Keeper) Forget(roomID string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.seen, roomID)
}

// watched reports whether the room was seen recently enough to leave alone.
func (k *Keeper) watched(roomID string, now time.Time) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	at, ok := k.seen[roomID]
	return ok && now.Sub(at) < k.idleAfter
}

// Run sweeps until ctx is done. It is meant to be the only sweeper.
func (k *Keeper) Run(ctx context.Context) {
	ticker := time.NewTicker(sweepEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			k.Sweep(ctx)
		}
	}
}

// Sweep reclaims every stored room that nobody has been watching and that has
// no work left to protect.
func (k *Keeper) Sweep(ctx context.Context) {
	listCtx, cancel := context.WithTimeout(ctx, storeTimeout)
	ids, err := k.store.IDs(listCtx)
	cancel()
	if err != nil {
		slog.ErrorContext(ctx, "list rooms for abandoned sweep failed", "error", err)
		return
	}
	now := time.Now()
	for _, id := range ids {
		if k.watched(id, now) {
			continue
		}
		k.Reclaim(ctx, id)
	}
}

// Reclaim tears down a room nobody is in, unless it still has work running.
// It reports whether the room is gone.
func (k *Keeper) Reclaim(ctx context.Context, id string) bool {
	storeCtx, cancel := context.WithTimeout(ctx, storeTimeout)
	defer cancel()
	storedRoom, err := k.store.Get(storeCtx, id)
	if errors.Is(err, room.ErrNotFound) {
		k.Forget(id)
		return true
	}
	if err != nil {
		slog.ErrorContext(storeCtx, "load idle room before cleanup failed", "room_id", id, "error", err)
		return false
	}
	if reason := UnfinishedWork(storedRoom, time.Now()); reason != "" {
		slog.InfoContext(storeCtx, "idle room kept", "room_id", id, "reason", reason)
		return false
	}
	fileErr := os.RemoveAll(filepath.Join(k.cfg.DataDir, "rooms", id))
	mediaCtx, cancelMedia := context.WithTimeout(ctx, 2*time.Minute)
	mediaErr := k.removeMedia(mediaCtx, id)
	cancelMedia()
	if mediaErr != nil {
		slog.ErrorContext(storeCtx, "idle room media cleanup failed", "room_id", id, "error", mediaErr)
		return false
	}
	storeErr := k.store.Delete(storeCtx, id)
	if err := errors.Join(fileErr, storeErr); err != nil {
		slog.ErrorContext(storeCtx, "idle room cleanup failed", "room_id", id, "error", err)
		return false
	}
	k.Forget(id)
	if k.OnReclaimed != nil {
		k.OnReclaimed(id)
	}
	slog.InfoContext(storeCtx, "idle room reclaimed", "room_id", id, "idle_for", k.idleAfter)
	return true
}

func (k *Keeper) removeMedia(ctx context.Context, roomID string) error {
	if k.bucket == nil {
		return nil
	}
	return k.bucket.RemovePrefix(ctx, objectstore.RoomPrefix(roomID))
}

// UnfinishedWork names what an idle room still has running, or "" when
// reclaiming it destroys nothing. Status is not enough on its own: the room
// flips to ready while the source is still arriving.
func UnfinishedWork(r *room.Room, now time.Time) string {
	if r.Status == "error" || r.ErrorMessage != "" {
		return ""
	}
	if now.Sub(r.CreatedAt) > preparingGrace {
		return ""
	}
	switch {
	case r.Status == "uploading" || r.Status == "processing":
		return "upload in progress"
	case r.Preparation.SourceBytes > 0 && r.Preparation.ReceivedBytes < r.Preparation.SourceBytes:
		return "source still arriving"
	}
	return ""
}
