package httpapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

const hashA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const hashB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// fakeTracker answers BEP 15 connect and scrape with fixed counts per hash.
func fakeTracker(t *testing.T, counts map[string]SwarmCount) *net.UDPAddr {
	t.Helper()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	go func() {
		buf := make([]byte, 4096)
		for {
			n, from, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			action := binary.BigEndian.Uint32(buf[8:])
			tid := buf[12:16]
			switch action {
			case 0:
				out := make([]byte, 16)
				copy(out[4:], tid)
				binary.BigEndian.PutUint64(out[8:], 42)
				_, _ = conn.WriteToUDP(out, from)
			case 2:
				out := make([]byte, 8)
				binary.BigEndian.PutUint32(out[0:], 2)
				copy(out[4:], tid)
				for off := 16; off+20 <= n; off += 20 {
					c := counts[hex.EncodeToString(buf[off:off+20])]
					row := make([]byte, 12)
					binary.BigEndian.PutUint32(row[0:], uint32(c.Seeders))
					binary.BigEndian.PutUint32(row[8:], uint32(c.Leechers))
					out = append(out, row...)
				}
				_, _ = conn.WriteToUDP(out, from)
			}
		}
	}()
	return conn.LocalAddr().(*net.UDPAddr)
}

func TestScrapeAtSpeaksBEP15(t *testing.T) {
	addr := fakeTracker(t, map[string]SwarmCount{hashA: {Seeders: 120, Leechers: 7}})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	got, err := scrapeAt(ctx, addr, []string{hashA, hashB})
	require.NoError(t, err)
	require.Equal(t, SwarmCount{Seeders: 120, Leechers: 7}, got[hashA])
	require.Equal(t, SwarmCount{}, got[hashB])
}

func TestUDPScrapeRefusesLocalTrackers(t *testing.T) {
	_, err := udpScrape(context.Background(), "udp://127.0.0.1:6969", []string{hashA})
	require.ErrorIs(t, err, errNotPublic)
	_, err = udpScrape(context.Background(), "udp://192.168.0.1:6969", []string{hashA})
	require.ErrorIs(t, err, errNotPublic)
}

func TestCheckKeepsTheBestCountAndCountsAnswers(t *testing.T) {
	h := NewSwarmHealth()
	h.trackers = []string{"udp://one.example:1", "udp://two.example:2", "udp://dead.example:3"}
	h.scrape = func(_ context.Context, tracker string, hashes []string) (map[string]SwarmCount, error) {
		switch tracker {
		case "udp://one.example:1":
			return map[string]SwarmCount{hashA: {Seeders: 3}}, nil
		case "udp://two.example:2":
			return map[string]SwarmCount{hashA: {Seeders: 50, Leechers: 2}, hashB: {}}, nil
		}
		return nil, errors.New("timeout")
	}
	res := h.Check(context.Background(), []string{hashA, hashB}, []string{"udp://two.example:2", "http://not-udp:1", "udp://extra.example:9"})
	require.Equal(t, 4, res.Asked) // three base + one extra; duplicates and non-UDP dropped
	require.Equal(t, 2, res.Answered)
	require.Equal(t, 50, res.Swarms[hashA].Seeders)
	require.Equal(t, 0, res.Swarms[hashB].Seeders)
}

func TestHealthHandlerValidatesAndCaches(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewSwarmHealth()
	calls := 0
	h.trackers = []string{"udp://one.example:1"}
	h.scrape = func(_ context.Context, _ string, hashes []string) (map[string]SwarmCount, error) {
		calls++
		return map[string]SwarmCount{hashA: {Seeders: 9}}, nil
	}
	r := gin.New()
	r.POST("/health", h.handle)
	post := func(body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/health", bytes.NewReader(raw)))
		return w
	}
	require.Equal(t, http.StatusBadRequest, post(map[string]any{"infoHashes": []string{"nope"}}).Code)

	first := post(map[string]any{"infoHashes": []string{hashA, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}})
	require.Equal(t, http.StatusOK, first.Code)
	var res SwarmHealthResult
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &res))
	require.Equal(t, 1, res.Answered)
	require.Equal(t, 9, res.Swarms[hashA].Seeders)

	second := post(map[string]any{"infoHashes": []string{hashA}})
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &res))
	require.True(t, res.Cached)
	require.Equal(t, 1, calls)
}

// Um titulo com ~190 fontes: todas conferidas, em varios pacotes.
func TestScrapeAtCoversEveryHashAcrossPackets(t *testing.T) {
	counts := map[string]SwarmCount{}
	hashes := []string{}
	for i := 0; i < 190; i++ {
		h := fmt.Sprintf("%040x", i+1)
		hashes = append(hashes, h)
		counts[h] = SwarmCount{Seeders: i + 1}
	}
	addr := fakeTracker(t, counts)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got, err := scrapeAt(ctx, addr, hashes)
	require.NoError(t, err)
	require.Len(t, got, 190)
	require.Equal(t, 190, got[hashes[189]].Seeders)
	require.Equal(t, 71, got[hashes[70]].Seeders)
}
