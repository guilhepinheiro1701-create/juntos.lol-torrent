package httpapi

// Quantos seeds uma fonte tem AGORA, perguntado aos trackers.
//
// O numero que o plugin mostra vem do indice dele e envelhece: um torrent
// anunciado com 120 seeds pode ter 1 hoje, e foi exatamente isso que fazia o
// modo basico gastar 45 s por fonte morta antes de desistir. Um scrape UDP
// (BEP 15) responde por dezenas de torrents num pacote so, em ~1 s, e e o
// navegador que nao sabe falar UDP — por isso a pergunta passa pelo servidor.
//
// Nenhum tracker respondendo tambem e uma resposta: quase sempre e um
// firewall/antivirus segurando o UDP do Docker, e o site avisa disso.

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Trackers publicos grandes, sempre perguntados; os que o plugin indicou para
// a fonte vem por cima (limitados).
var defaultScrapeTrackers = []string{
	"udp://tracker.opentrackr.org:1337",
	"udp://open.stealth.si:80",
	"udp://tracker.torrent.eu.org:451",
	"udp://open.demonii.com:1337",
	"udp://tracker.dler.org:6969",
}

const (
	// Todas as fontes de um titulo: o Homem de Ferro tem ~190. Conferir so
	// as 40 "melhores" pelo numero do plugin deixava as outras sem conferencia,
	// e uma fonte nao conferida ganhava das conferidas vivas.
	maxHealthHashes = 300
	// Um pacote de scrape UDP leva ate ~74 hashes (BEP 15); o resto vai em
	// mais pacotes na mesma conexao.
	scrapeChunk       = 50
	maxExtraTrackers  = 6
	scrapeTimeout     = 3 * time.Second
	healthCacheMaxAge = 2 * time.Minute
)

type SwarmCount struct {
	Seeders  int `json:"seeders"`
	Leechers int `json:"leechers"`
}

type SwarmHealthResult struct {
	// Quantos trackers foram perguntados e quantos responderam. Zero de N e
	// o sinal de firewall.
	Asked    int `json:"asked"`
	Answered int `json:"answered"`
	// Veio do cache (perguntado ha menos de 2 min): Asked/Answered nao se aplicam.
	Cached bool                  `json:"cached,omitempty"`
	Swarms map[string]SwarmCount `json:"swarms"`
	// Por tracker: respondeu? quantos torrents com seed > 0? E o que o
	// diagnostico mostra para saber em quem a conferencia esta se apoiando.
	Trackers []TrackerReport `json:"trackers,omitempty"`
}

type TrackerReport struct {
	Tracker string `json:"tracker"`
	OK      bool   `json:"ok"`
	Seeded  int    `json:"seeded"`
	Error   string `json:"error,omitempty"`
}

// scrapeFunc existe para os testes trocarem a rede por um tracker falso.
type scrapeFunc func(ctx context.Context, tracker string, hashes []string) (map[string]SwarmCount, error)

type SwarmHealth struct {
	scrape   scrapeFunc
	trackers []string

	mu    sync.Mutex
	cache map[string]cachedSwarm
}

type cachedSwarm struct {
	at    time.Time
	count SwarmCount
}

func NewSwarmHealth() *SwarmHealth {
	return &SwarmHealth{scrape: udpScrape, trackers: defaultScrapeTrackers, cache: map[string]cachedSwarm{}}
}

// Check pergunta a todos os trackers em paralelo e fica com o MAIOR numero de
// cada torrent: um tracker que nao conhece o torrent responde zero, e isso
// nao pode apagar o que outro viu.
func (h *SwarmHealth) Check(ctx context.Context, hashes []string, extra []string) SwarmHealthResult {
	trackers := mergeTrackers(h.trackers, extra)
	result := SwarmHealthResult{Asked: len(trackers), Swarms: map[string]SwarmCount{}}

	type answer struct {
		tracker string
		counts  map[string]SwarmCount
		err     error
	}
	answers := make(chan answer, len(trackers))
	for _, tracker := range trackers {
		go func(tracker string) {
			c, cancel := context.WithTimeout(ctx, scrapeTimeout)
			defer cancel()
			counts, err := h.scrape(c, tracker, hashes)
			answers <- answer{tracker, counts, err}
		}(tracker)
	}
	for range trackers {
		a := <-answers
		report := TrackerReport{Tracker: strings.TrimPrefix(a.tracker, "udp://"), OK: a.err == nil}
		if a.err != nil {
			report.Error = a.err.Error()
			result.Trackers = append(result.Trackers, report)
			continue
		}
		for _, count := range a.counts {
			if count.Seeders > 0 {
				report.Seeded++
			}
		}
		result.Trackers = append(result.Trackers, report)
		result.Answered++
		for hash, count := range a.counts {
			best := result.Swarms[hash]
			if count.Seeders > best.Seeders {
				best.Seeders = count.Seeders
			}
			if count.Leechers > best.Leechers {
				best.Leechers = count.Leechers
			}
			result.Swarms[hash] = best
		}
	}
	seeded := 0
	for _, count := range result.Swarms {
		if count.Seeders > 0 {
			seeded++
		}
	}
	slog.Info("swarm health", "hashes", len(hashes), "asked", result.Asked, "answered", result.Answered,
		"seeded", seeded, "trackers", trackerSummary(result.Trackers))
	// Tudo zerado com dezenas de fontes nao e um titulo morto, e uma
	// conferencia que nao funcionou (os trackers grandes nao responderam
	// direito). Nao vai para o cache, para a proxima tentar de novo.
	if result.Answered > 0 && (seeded > 0 || len(hashes) < 5) {
		h.remember(result.Swarms, hashes)
	}
	return result
}

func (h *SwarmHealth) remember(swarms map[string]SwarmCount, asked []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	for _, hash := range asked {
		h.cache[hash] = cachedSwarm{at: now, count: swarms[hash]}
	}
	for hash, entry := range h.cache {
		if now.Sub(entry.at) > healthCacheMaxAge {
			delete(h.cache, hash)
		}
	}
}

func (h *SwarmHealth) cached(hashes []string) (map[string]SwarmCount, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[string]SwarmCount{}
	for _, hash := range hashes {
		entry, ok := h.cache[hash]
		if !ok || time.Since(entry.at) > healthCacheMaxAge {
			return nil, false
		}
		out[hash] = entry.count
	}
	return out, true
}

func mergeTrackers(base, extra []string) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(t string) {
		t = strings.TrimSpace(t)
		u, err := url.Parse(t)
		if err != nil || u.Scheme != "udp" || u.Hostname() == "" || u.Port() == "" || seen[u.Host] {
			return
		}
		seen[u.Host] = true
		out = append(out, "udp://"+u.Host)
	}
	for _, t := range base {
		add(t)
	}
	added := 0
	for _, t := range extra {
		if added >= maxExtraTrackers {
			break
		}
		before := len(out)
		add(t)
		if len(out) > before {
			added++
		}
	}
	return out
}

// O endereco do tracker passa pelo mesmo filtro do salto de plugins
// (publicAddr, em pluginfetch.go): a lista vem de plugins, e sem isto um
// plugin poderia usar o servidor para sondar a rede da casa.
var errNotPublic = errors.New("tracker resolves to a non-public address")

func udpScrape(ctx context.Context, tracker string, hashes []string) (map[string]SwarmCount, error) {
	u, err := url.Parse(tracker)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip4", u.Hostname())
	if err != nil || len(ips) == 0 {
		return nil, errors.New("tracker does not resolve")
	}
	addr, ok := netip.AddrFromSlice(ips[0])
	if !ok || !publicAddr(addr) {
		return nil, errNotPublic
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port <= 0 || port > 65535 {
		return nil, errors.New("bad port")
	}
	return scrapeAt(ctx, &net.UDPAddr{IP: ips[0], Port: port}, hashes)
}

// scrapeAt fala o protocolo (BEP 15: connect, depois scrape) com um endereco
// ja resolvido e ja conferido.
func scrapeAt(ctx context.Context, target *net.UDPAddr, hashes []string) (map[string]SwarmCount, error) {
	conn, err := net.DialUDP("udp4", nil, target)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	tid := randomU32()
	req := make([]byte, 16)
	binary.BigEndian.PutUint64(req[0:], 0x41727101980)
	binary.BigEndian.PutUint32(req[8:], 0) // connect
	binary.BigEndian.PutUint32(req[12:], tid)
	if _, err := conn.Write(req); err != nil {
		return nil, err
	}
	buf := make([]byte, 8+12*scrapeChunk+64)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	if n < 16 || binary.BigEndian.Uint32(buf[0:]) != 0 || binary.BigEndian.Uint32(buf[4:]) != tid {
		return nil, errors.New("bad connect reply")
	}
	connID := binary.BigEndian.Uint64(buf[8:])

	out := map[string]SwarmCount{}
	for start := 0; start < len(hashes); start += scrapeChunk {
		chunk := hashes[start:min(start+scrapeChunk, len(hashes))]
		tid = randomU32()
		scrape := make([]byte, 16, 16+20*len(chunk))
		binary.BigEndian.PutUint64(scrape[0:], connID)
		binary.BigEndian.PutUint32(scrape[8:], 2) // scrape
		binary.BigEndian.PutUint32(scrape[12:], tid)
		for _, hash := range chunk {
			raw, _ := hex.DecodeString(hash)
			scrape = append(scrape, raw...)
		}
		if _, err := conn.Write(scrape); err != nil {
			return partial(out, err)
		}
		n, err = conn.Read(buf)
		if err != nil {
			return partial(out, err)
		}
		if n < 8 || binary.BigEndian.Uint32(buf[0:]) != 2 || binary.BigEndian.Uint32(buf[4:]) != tid {
			return partial(out, errors.New("bad scrape reply"))
		}
		for i, hash := range chunk {
			off := 8 + 12*i
			if off+12 > n {
				break
			}
			out[hash] = SwarmCount{
				Seeders:  int(binary.BigEndian.Uint32(buf[off:])),
				Leechers: int(binary.BigEndian.Uint32(buf[off+8:])),
			}
		}
	}
	return out, nil
}

// partial: o que ja voltou de pacotes anteriores vale; so sem nada e erro.
func partial(out map[string]SwarmCount, err error) (map[string]SwarmCount, error) {
	if len(out) > 0 {
		return out, nil
	}
	return nil, err
}

func randomU32() uint32 {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return binary.BigEndian.Uint32(b[:])
}

type swarmHealthRequest struct {
	InfoHashes []string `json:"infoHashes"`
	Trackers   []string `json:"trackers"`
}

func (h *SwarmHealth) handle(c *gin.Context) {
	var req swarmHealthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	hashes := []string{}
	seen := map[string]bool{}
	for _, raw := range req.InfoHashes {
		hash := strings.ToLower(strings.TrimSpace(raw))
		if len(hash) != 40 || seen[hash] {
			continue
		}
		if _, err := hex.DecodeString(hash); err != nil {
			continue
		}
		seen[hash] = true
		hashes = append(hashes, hash)
		if len(hashes) == maxHealthHashes {
			break
		}
	}
	if len(hashes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no_infohashes"})
		return
	}
	if swarms, ok := h.cached(hashes); ok {
		c.JSON(http.StatusOK, SwarmHealthResult{Cached: true, Swarms: swarms})
		return
	}
	c.JSON(http.StatusOK, h.Check(c.Request.Context(), hashes, req.Trackers))
}

func trackerSummary(reports []TrackerReport) string {
	parts := make([]string, 0, len(reports))
	for _, r := range reports {
		if r.OK {
			parts = append(parts, fmt.Sprintf("%s=ok(%d com seed)", r.Tracker, r.Seeded))
		} else {
			parts = append(parts, fmt.Sprintf("%s=falhou(%s)", r.Tracker, r.Error))
		}
	}
	return strings.Join(parts, " ")
}
