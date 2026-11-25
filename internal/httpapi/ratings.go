package httpapi

// Classificacao indicativa de um titulo, pelo id do IMDb.
//
// Nenhum catalogo que o site usa traz isso (o addon do TMDB tem o campo, mas
// sempre vazio). Duas fontes, nesta ordem:
//   - a API do TMDB, se houver TMDB_API_KEY: a classificacao brasileira
//     (ClassInd) de filmes e series, com a americana como reserva;
//   - o Wikidata, aberto e sem chave: ClassInd da maioria dos filmes, e
//     a MPA americana quando a brasileira falta.
// A resposta fica guardada um dia: classificacao nao muda de uma hora para
// outra, e o detalhe de um titulo e aberto muitas vezes.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type AgeRating struct {
	// Rating e o que aparece no selo: "L", "10", "12", "14", "16", "18" na
	// ClassInd; "PG-13", "TV-MA"... nas americanas. Vazio: nao se sabe.
	Rating string `json:"rating"`
	// System e "ClassInd" ou "US".
	System string `json:"system,omitempty"`
}

type AgeRatings struct {
	tmdbKey string
	client  *http.Client
	tmdbAPI string
	wdAPI   string

	mu    sync.Mutex
	cache map[string]cachedRating
}

type cachedRating struct {
	at     time.Time
	rating AgeRating
}

const ratingCacheFor = 24 * time.Hour

var imdbID = regexp.MustCompile(`^tt\d{5,10}$`)

func NewAgeRatings(tmdbKey string) *AgeRatings {
	return &AgeRatings{
		tmdbKey: strings.TrimSpace(tmdbKey),
		client:  &http.Client{Timeout: 8 * time.Second},
		tmdbAPI: "https://api.themoviedb.org/3",
		wdAPI:   "https://query.wikidata.org/sparql",
		cache:   map[string]cachedRating{},
	}
}

func (a *AgeRatings) handle(c *gin.Context) {
	kind, id := c.Param("type"), c.Param("id")
	if (kind != "movie" && kind != "series") || !imdbID.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	rating, err := a.Lookup(c.Request.Context(), kind, id)
	if err != nil {
		// Sem classificacao nao e erro para quem esta olhando: o selo so nao aparece.
		c.JSON(http.StatusOK, AgeRating{})
		return
	}
	c.JSON(http.StatusOK, rating)
}

func (a *AgeRatings) Lookup(ctx context.Context, kind, id string) (AgeRating, error) {
	key := kind + "/" + id
	a.mu.Lock()
	if hit, ok := a.cache[key]; ok && time.Since(hit.at) < ratingCacheFor {
		a.mu.Unlock()
		return hit.rating, nil
	}
	a.mu.Unlock()

	var rating AgeRating
	var err error
	if a.tmdbKey != "" {
		rating, err = a.fromTMDB(ctx, kind, id)
	}
	if a.tmdbKey == "" || err != nil || rating.Rating == "" {
		var wd AgeRating
		wd, err = a.fromWikidata(ctx, id)
		if err == nil && (rating.Rating == "" || rating.System != "ClassInd" && wd.System == "ClassInd") {
			rating = wd
		}
	}
	if err != nil && rating.Rating == "" {
		return AgeRating{}, err
	}
	a.mu.Lock()
	a.cache[key] = cachedRating{at: time.Now(), rating: rating}
	a.mu.Unlock()
	return rating, nil
}

func (a *AgeRatings) getJSON(ctx context.Context, rawURL string, header map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "juntos-local/1.0")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

// ClassInd: o que o TMDB grava para o Brasil, normalizado ("Livre" -> "L").
func classInd(raw string) string {
	v := strings.ToUpper(strings.TrimSpace(raw))
	switch v {
	case "L", "LIVRE", "AL", "ER":
		return "L"
	case "10", "12", "14", "16", "18":
		return v
	case "A10", "A12", "A14", "A16", "A18":
		return v[1:]
	}
	return ""
}

func (a *AgeRatings) tmdb(ctx context.Context, path string, out any) error {
	u := a.tmdbAPI + path
	header := map[string]string{}
	// Chave v4 (um JWT longo) vai no cabecalho; a v3 (32 hex) na URL.
	if strings.Count(a.tmdbKey, ".") == 2 {
		header["Authorization"] = "Bearer " + a.tmdbKey
	} else {
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		u += sep + "api_key=" + url.QueryEscape(a.tmdbKey)
	}
	return a.getJSON(ctx, u, header, out)
}

func (a *AgeRatings) fromTMDB(ctx context.Context, kind, id string) (AgeRating, error) {
	var found struct {
		Movies []struct {
			ID int `json:"id"`
		} `json:"movie_results"`
		TV []struct {
			ID int `json:"id"`
		} `json:"tv_results"`
	}
	if err := a.tmdb(ctx, "/find/"+id+"?external_source=imdb_id", &found); err != nil {
		return AgeRating{}, err
	}
	pick := func(byCountry map[string]string) AgeRating {
		if r := classInd(byCountry["BR"]); r != "" {
			return AgeRating{Rating: r, System: "ClassInd"}
		}
		if us := strings.TrimSpace(byCountry["US"]); us != "" && us != "NR" {
			return AgeRating{Rating: us, System: "US"}
		}
		return AgeRating{}
	}
	if kind == "series" && len(found.TV) > 0 {
		var body struct {
			Results []struct {
				Country string `json:"iso_3166_1"`
				Rating  string `json:"rating"`
			} `json:"results"`
		}
		if err := a.tmdb(ctx, fmt.Sprintf("/tv/%d/content_ratings", found.TV[0].ID), &body); err != nil {
			return AgeRating{}, err
		}
		by := map[string]string{}
		for _, r := range body.Results {
			by[r.Country] = r.Rating
		}
		return pick(by), nil
	}
	if len(found.Movies) > 0 {
		var body struct {
			Results []struct {
				Country string `json:"iso_3166_1"`
				Dates   []struct {
					Certification string `json:"certification"`
				} `json:"release_dates"`
			} `json:"results"`
		}
		if err := a.tmdb(ctx, fmt.Sprintf("/movie/%d/release_dates", found.Movies[0].ID), &body); err != nil {
			return AgeRating{}, err
		}
		by := map[string]string{}
		for _, r := range body.Results {
			for _, d := range r.Dates {
				if strings.TrimSpace(d.Certification) != "" {
					by[r.Country] = d.Certification
					break
				}
			}
		}
		return pick(by), nil
	}
	return AgeRating{}, errors.New("not on tmdb")
}

// No Wikidata: P345 e o id do IMDb, P3216 a ClassInd, P1657 a MPA.
func (a *AgeRatings) fromWikidata(ctx context.Context, id string) (AgeRating, error) {
	query := `SELECT ?cl ?mpa WHERE { ?item wdt:P345 "` + id + `" .
OPTIONAL { ?item wdt:P3216 ?c . ?c rdfs:label ?cl FILTER(lang(?cl) = "pt-br" || lang(?cl) = "pt" || lang(?cl) = "en") }
OPTIONAL { ?item wdt:P1657 ?m . ?m rdfs:label ?mpa FILTER(lang(?mpa) = "en") } } LIMIT 6`
	var body struct {
		Results struct {
			Bindings []map[string]struct {
				Value string `json:"value"`
			} `json:"bindings"`
		} `json:"results"`
	}
	u := a.wdAPI + "?format=json&query=" + url.QueryEscape(query)
	if err := a.getJSON(ctx, u, map[string]string{"Accept": "application/sparql-results+json"}, &body); err != nil {
		return AgeRating{}, err
	}
	us := ""
	for _, b := range body.Results.Bindings {
		if r := classInd(strings.TrimSuffix(b["cl"].Value, " anos")); r != "" {
			return AgeRating{Rating: r, System: "ClassInd"}, nil
		}
		if v := b["mpa"].Value; v != "" && us == "" {
			us = v
		}
	}
	if us != "" {
		return AgeRating{Rating: us, System: "US"}, nil
	}
	return AgeRating{}, nil
}
