package janitor

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/room"
)

func newTestStore(t *testing.T) *room.Store {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	return room.NewStore(rdb, 5*time.Hour)
}

func newKeeper(t *testing.T) (*Keeper, *room.Store) {
	t.Helper()
	store := newTestStore(t)
	return New(store, config.Config{DataDir: t.TempDir(), RoomIdleSeconds: 1200}, nil), store
}

func TestUnfinishedWorkProtectsAPreparingRoom(t *testing.T) {
	now := time.Now()
	r := &room.Room{Status: "uploading", CreatedAt: now.Add(-2 * time.Minute)}

	require.NotEmpty(t, UnfinishedWork(r, now))
}

func TestUnfinishedWorkGivesUpOnARoomStuckPreparing(t *testing.T) {
	now := time.Now()
	r := &room.Room{Status: "uploading", CreatedAt: now.Add(-11 * time.Minute)}

	require.Empty(t, UnfinishedWork(r, now))
}

func TestUnfinishedWorkReclaimsAFailedRoomAtOnce(t *testing.T) {
	now := time.Now()
	for _, r := range []*room.Room{
		{Status: "error", CreatedAt: now},
		{Status: "uploading", ErrorMessage: "plan failed", CreatedAt: now},
	} {
		require.Empty(t, UnfinishedWork(r, now))
	}
}

func TestUnfinishedWorkKeepsARoomWhoseSourceIsStillArriving(t *testing.T) {
	now := time.Now()
	r := &room.Room{
		Status:      "ready",
		CreatedAt:   now.Add(-time.Minute),
		Preparation: room.Preparation{SourceBytes: 1000, ReceivedBytes: 400},
	}

	require.NotEmpty(t, UnfinishedWork(r, now))
}

func TestUnfinishedWorkReleasesAFinishedRoom(t *testing.T) {
	now := time.Now()
	r := &room.Room{
		Status:      "ready",
		CreatedAt:   now.Add(-time.Minute),
		Preparation: room.Preparation{SourceBytes: 1000, ReceivedBytes: 1000},
	}

	require.Empty(t, UnfinishedWork(r, now))
}

func TestSweepReclaimsARoomNobodyIsWatchingAndSparesOneStillPreparing(t *testing.T) {
	keeper, store := newKeeper(t)
	now := time.Now()
	require.NoError(t, store.Create(t.Context(), &room.Room{
		ID: "done", Status: "ready",
		CreatedAt: now.Add(-preparingGrace - time.Minute), ExpiresAt: now.Add(time.Hour),
	}))
	require.NoError(t, store.Create(t.Context(), &room.Room{
		ID: "busy", Status: "ready",
		CreatedAt: now.Add(-time.Minute), ExpiresAt: now.Add(time.Hour),
	}))
	for _, id := range []string{"done", "busy"} {
		require.NoError(t, store.SetIngestProgress(t.Context(), id, 400, 1000))
	}
	var reclaimed []string
	keeper.OnReclaimed = func(id string) { reclaimed = append(reclaimed, id) }

	keeper.Sweep(t.Context())

	_, err := store.Get(t.Context(), "done")
	require.ErrorIs(t, err, room.ErrNotFound)
	_, err = store.Get(t.Context(), "busy")
	require.NoError(t, err)
	require.Equal(t, []string{"done"}, reclaimed)
}

// This is the whole point of the package: the room survives because someone
// said they were watching it, not because a connection was open.
func TestSweepSparesARoomSomeoneIsWatching(t *testing.T) {
	keeper, store := newKeeper(t)
	now := time.Now()
	require.NoError(t, store.Create(t.Context(), &room.Room{
		ID: "watched", Status: "ready",
		CreatedAt: now.Add(-preparingGrace - time.Minute), ExpiresAt: now.Add(time.Hour),
	}))
	keeper.Seen("watched")

	keeper.Sweep(t.Context())

	_, err := store.Get(t.Context(), "watched")
	require.NoError(t, err)
}

// A report that has gone stale stops protecting the room.
func TestSweepReclaimsARoomWhoseViewerWentQuiet(t *testing.T) {
	store := newTestStore(t)
	keeper := New(store, config.Config{DataDir: t.TempDir(), RoomIdleSeconds: 1}, nil)
	now := time.Now()
	require.NoError(t, store.Create(t.Context(), &room.Room{
		ID: "quiet", Status: "ready",
		CreatedAt: now.Add(-preparingGrace - time.Minute), ExpiresAt: now.Add(time.Hour),
	}))
	keeper.Seen("quiet")
	keeper.mu.Lock()
	keeper.seen["quiet"] = now.Add(-time.Hour)
	keeper.mu.Unlock()

	keeper.Sweep(t.Context())

	_, err := store.Get(t.Context(), "quiet")
	require.ErrorIs(t, err, room.ErrNotFound)
}

func TestReclaimForgetsTheRoomItRemoved(t *testing.T) {
	keeper, store := newKeeper(t)
	now := time.Now()
	require.NoError(t, store.Create(t.Context(), &room.Room{
		ID: "gone", Status: "ready",
		CreatedAt: now.Add(-preparingGrace - time.Minute), ExpiresAt: now.Add(time.Hour),
	}))
	keeper.Seen("gone")

	require.True(t, keeper.Reclaim(t.Context(), "gone"))

	keeper.mu.Lock()
	_, held := keeper.seen["gone"]
	keeper.mu.Unlock()
	require.False(t, held)
}
