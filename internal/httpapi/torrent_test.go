package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/worker"
)

func TestTorrentRoutesWithoutService(t *testing.T) {
	r := gin.New()
	RegisterTorrentRoutes(r.Group("/api"), config.Config{}, TorrentAccess{})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/torrents/capacity", nil))
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Body.String(), `"disabled"`)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/torrents", strings.NewReader(`{}`)))
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestTorrentRoutesWithoutWorkers(t *testing.T) {
	mr, rdb := newRedis(t)
	_ = mr
	signer, err := worker.LoadOrCreateSigner("")
	require.NoError(t, err)
	registry := worker.NewRegistry(rdb)
	service := &worker.Service{Registry: registry, Hub: worker.NewHub(registry, signer, "secret"), Signer: signer, Blocklist: &worker.Blocklist{}}
	r := gin.New()
	RegisterTorrentRoutes(r.Group("/api"), config.Config{}, TorrentAccess{
		Sessions: NewSessions(rdb, 1e9, 0, false),
		Quota:    NewQuota(rdb, 5, 2, 0),
		Service:  service,
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/torrents/capacity", nil))
	require.Contains(t, w.Body.String(), `"no_workers"`)

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/torrents", strings.NewReader(`{"infoHash":"nope"}`)))
	require.Equal(t, http.StatusBadRequest, w.Code)

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/torrents", strings.NewReader(`{"infoHash":"`+strings.Repeat("a", 40)+`"}`)))
	require.Equal(t, http.StatusServiceUnavailable, w.Code)
	require.Contains(t, w.Body.String(), "no_workers")
	require.NotEmpty(t, w.Result().Cookies(), "the session was minted on first sight")

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/torrents/j_missing", nil))
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestCleanTrackers(t *testing.T) {
	kept, err := cleanTrackers([]string{
		"udp://tracker.opentrackr.org:1337/announce",
		"https://tracker.example/announce",
		"wss://tracker.example/ws",
		"not a url",
		"udp://",
		"http://1.2.3.4:6969/announce",
	})
	require.NoError(t, err)
	require.Equal(t, []string{
		"udp://tracker.opentrackr.org:1337/announce",
		"https://tracker.example/announce",
		"http://1.2.3.4:6969/announce",
	}, kept)

	for _, bad := range []string{
		"http://169.254.169.254/latest/meta-data",
		"http://10.0.0.5:8080/admin",
		"udp://127.0.0.1:53/announce",
		"http://[::1]:9999/",
		"http://[::ffff:10.1.2.3]:80/",
		"udp://239.1.1.1:9999/announce",
	} {
		_, err := cleanTrackers([]string{bad})
		require.Error(t, err, bad)
	}
}

// A torrent can only be kept once the worker holds it: before a file is
// chosen there is nothing on disk to keep, and answering 200 there would
// promise an offline copy that never arrives.
func TestKeepRefusesAJobThatIsNotServing(t *testing.T) {
	_, rdb := newRedis(t)
	signer, err := worker.LoadOrCreateSigner("")
	require.NoError(t, err)
	registry := worker.NewRegistry(rdb)
	service := &worker.Service{Registry: registry, Hub: worker.NewHub(registry, signer, "secret"), Signer: signer, Blocklist: &worker.Blocklist{}}
	sessions := NewSessions(rdb, 1e9, 0, false)
	r := gin.New()
	RegisterTorrentRoutes(r.Group("/api"), config.Config{}, TorrentAccess{Sessions: sessions, Service: service})

	// Mint a session the way the first request would, then hang a listed job
	// off it: listed means the files came back but none was chosen.
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/torrents/j_missing", nil))
	cookies := w.Result().Cookies()
	require.NotEmpty(t, cookies)
	sid := cookies[0].Value

	require.NoError(t, registry.SaveJob(t.Context(), &worker.JobRecord{
		ID: "j_listed", SessionID: sid, Infohash: strings.Repeat("a", 40),
		WorkerID: "w1", State: worker.JobListed,
	}, time.Minute))

	req := httptest.NewRequest(http.MethodPost, "/api/torrents/j_listed/keep", strings.NewReader(`{"keep":true}`))
	req.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusConflict, w.Code, "body: %s", w.Body.String())

	// And the record was not quietly marked anyway.
	stored, err := registry.LoadJob(t.Context(), "j_listed")
	require.NoError(t, err)
	require.False(t, stored.Keep)
}
