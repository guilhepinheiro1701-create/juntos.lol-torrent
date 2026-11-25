package worker

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/remux"
	"github.com/giulianoo0/ss/internal/room"
)

func slotOrchestrator(t *testing.T, seen map[string]time.Time) (*RemuxOrchestrator, []string) {
	t.Helper()
	r := newRegistry(t)
	signer, err := LoadOrCreateSigner("")
	require.NoError(t, err)
	service := &Service{Registry: r, Hub: NewHub(r, signer, "secret"), Signer: signer, Blocklist: &Blocklist{}}
	o := NewRemuxOrchestrator(service, room.NewStore(r.rdb, time.Hour), config.Config{RoomTTLHours: 1})
	o.SeenAt = func(id string) time.Time { return seen[id] }
	var released []string
	o.Released = func(id string) { released = append(released, id) }
	return o, released
}

func addRun(t *testing.T, o *RemuxOrchestrator, roomID string) {
	t.Helper()
	require.NoError(t, o.saveRun(t.Context(), &RemuxRun{
		RunID: "run_" + roomID, RoomID: roomID, WorkerID: "w1", State: remux.RunAccepted, UpdatedAt: time.Now(),
	}))
}

func runOf(t *testing.T, o *RemuxOrchestrator, roomID string) *RemuxRun {
	t.Helper()
	run, err := o.LoadRun(t.Context(), roomID)
	require.NoError(t, err)
	return run
}

// Browsing title after title: every room the viewer already left gives its
// slot back, and the one still open is left alone.
func TestFreeSlotEndsEveryAbandonedRoom(t *testing.T) {
	now := time.Now()
	o, _ := slotOrchestrator(t, map[string]time.Time{
		"left": {}, "stale": now.Add(-time.Minute), "open": now,
	})
	for _, id := range []string{"left", "stale", "open"} {
		addRun(t, o, id)
	}

	require.Equal(t, 2, o.freeSlot(t.Context(), "w1", "new"))
	require.Nil(t, runOf(t, o, "left"))
	require.Nil(t, runOf(t, o, "stale"))
	require.NotNil(t, runOf(t, o, "open"))
}

// Every room still watched (several tabs open): the newest title still gets
// in, and the room watched longest ago is the one that gives way.
func TestFreeSlotTakesTheLeastRecentlyWatchedWhenAllAreOpen(t *testing.T) {
	now := time.Now()
	o, _ := slotOrchestrator(t, map[string]time.Time{
		"older": now.Add(-15 * time.Second), "newer": now.Add(-2 * time.Second),
	})
	addRun(t, o, "older")
	addRun(t, o, "newer")

	require.Equal(t, 1, o.freeSlot(t.Context(), "w1", "new"))
	require.Nil(t, runOf(t, o, "older"))
	require.NotNil(t, runOf(t, o, "newer"))
}

func TestFreeSlotNeverTakesTheRoomBeingStarted(t *testing.T) {
	o, _ := slotOrchestrator(t, map[string]time.Time{})
	addRun(t, o, "new")

	require.Zero(t, o.freeSlot(t.Context(), "w1", "new"))
	require.NotNil(t, runOf(t, o, "new"))
}
