package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/giulianoo0/ss/internal/room"
)

func postPosition(t *testing.T, e *gin.Engine, roomID, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+roomID+"/position", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	e.ServeHTTP(w, req)
	return w
}

func positionRoom(t *testing.T, store *room.Store, hooks PositionHooks) *gin.Engine {
	t.Helper()
	now := time.Now()
	require.NoError(t, store.Create(t.Context(), &room.Room{
		ID: "r1", FileName: "movie.mkv", Status: "ready", SourceKind: room.SourceUpload,
		ControllerID: "m1", OwnerToken: "owner-secret", CreatedAt: now, ExpiresAt: now.Add(time.Hour),
	}))
	e := gin.New()
	RegisterPositionRoute(e.Group("/api"), store, nil, hooks)
	return e
}

func TestPositionFeedsProductionAndKeepsTheRoomAlive(t *testing.T) {
	store := newTestStore(t)
	var followed []int64
	var seen []string
	e := positionRoom(t, store, PositionHooks{
		Follow: func(_ string, positionMs int64) { followed = append(followed, positionMs) },
		Seen:   func(id string) { seen = append(seen, id) },
	})

	w := postPosition(t, e, "r1", `{"ownerToken":"owner-secret","positionMs":90000}`)
	require.Equal(t, http.StatusNoContent, w.Code)
	require.Equal(t, []int64{90000}, followed)
	require.Equal(t, []string{"r1"}, seen)
}

func TestPositionRefusesWithoutTheOwnerToken(t *testing.T) {
	store := newTestStore(t)
	var followed int
	e := positionRoom(t, store, PositionHooks{Follow: func(string, int64) { followed++ }})

	require.Equal(t, http.StatusForbidden, postPosition(t, e, "r1", `{"positionMs":1000}`).Code)
	require.Equal(t, http.StatusForbidden, postPosition(t, e, "r1", `{"ownerToken":"guessed","positionMs":1000}`).Code)
	require.Zero(t, followed)
}

func TestPositionRejectsBadInput(t *testing.T) {
	store := newTestStore(t)
	e := positionRoom(t, store, PositionHooks{})

	for _, body := range []string{
		`{"ownerToken":"owner-secret"}`,
		`{"ownerToken":"owner-secret","positionMs":-1}`,
		`not json`,
	} {
		require.Equal(t, http.StatusBadRequest, postPosition(t, e, "r1", body).Code, body)
	}
}

// A position for a room that is gone must not resurrect it as a live one.
func TestPositionForAMissingRoomIsNotFound(t *testing.T) {
	store := newTestStore(t)
	e := positionRoom(t, store, PositionHooks{})

	w := postPosition(t, e, "r2", `{"ownerToken":"owner-secret","positionMs":0}`)
	require.Equal(t, http.StatusNotFound, w.Code)
}

// Nil hooks are the configuration a server without a fleet runs with.
func TestPositionSurvivesNilHooks(t *testing.T) {
	store := newTestStore(t)
	e := positionRoom(t, store, PositionHooks{})

	require.Equal(t, http.StatusNoContent,
		postPosition(t, e, "r1", `{"ownerToken":"owner-secret","positionMs":5000}`).Code)
}
