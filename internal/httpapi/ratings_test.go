package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func fakeRatings(t *testing.T, key string, tmdb, wikidata http.HandlerFunc) (*AgeRatings, *int) {
	t.Helper()
	tm := httptest.NewServer(tmdb)
	wd := httptest.NewServer(wikidata)
	t.Cleanup(tm.Close)
	t.Cleanup(wd.Close)
	a := NewAgeRatings(key)
	a.tmdbAPI, a.wdAPI = tm.URL, wd.URL
	calls := 0
	inner := a.client.Transport
	if inner == nil {
		inner = http.DefaultTransport
	}
	a.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) { calls++; return inner.RoundTrip(r) })
	return a, &calls
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func wikidataSays(cl, mpa string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		b := `{}`
		if cl != "" || mpa != "" {
			parts := []string{}
			if cl != "" {
				parts = append(parts, `"cl":{"value":"`+cl+`"}`)
			}
			if mpa != "" {
				parts = append(parts, `"mpa":{"value":"`+mpa+`"}`)
			}
			b = `{` + strings.Join(parts, ",") + `}`
		}
		_, _ = w.Write([]byte(`{"results":{"bindings":[` + b + `]}}`))
	}
}

func TestRatingsFromTMDBSeriesPreferBrazil(t *testing.T) {
	a, _ := fakeRatings(t, "k3y", func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "k3y", r.URL.Query().Get("api_key"))
		switch {
		case strings.HasPrefix(r.URL.Path, "/find/"):
			_, _ = w.Write([]byte(`{"movie_results":[],"tv_results":[{"id":84958}]}`))
		case r.URL.Path == "/tv/84958/content_ratings":
			_, _ = w.Write([]byte(`{"results":[{"iso_3166_1":"US","rating":"TV-14"},{"iso_3166_1":"BR","rating":"12"}]}`))
		default:
			http.NotFound(w, r)
		}
	}, wikidataSays("", ""))
	r, err := a.Lookup(t.Context(), "series", "tt9140554")
	require.NoError(t, err)
	require.Equal(t, AgeRating{Rating: "12", System: "ClassInd"}, r)
}

func TestRatingsFromTMDBMovieSkipsBlankCertifications(t *testing.T) {
	a, _ := fakeRatings(t, "k3y", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/find/"):
			_, _ = w.Write([]byte(`{"movie_results":[{"id":1726}],"tv_results":[]}`))
		case r.URL.Path == "/movie/1726/release_dates":
			_, _ = w.Write([]byte(`{"results":[{"iso_3166_1":"BR","release_dates":[{"certification":""},{"certification":"Livre"}]}]}`))
		default:
			http.NotFound(w, r)
		}
	}, wikidataSays("", ""))
	r, err := a.Lookup(t.Context(), "movie", "tt0371746")
	require.NoError(t, err)
	require.Equal(t, AgeRating{Rating: "L", System: "ClassInd"}, r)
}

// Sem chave, ou com o TMDB sem a brasileira: o Wikidata decide, e a
// resposta fica em cache.
func TestRatingsFallBackToWikidataAndCache(t *testing.T) {
	a, calls := fakeRatings(t, "", func(w http.ResponseWriter, r *http.Request) { t.Fatal("no key: TMDB must not be called") },
		wikidataSays("14", "PG-13"))
	r, err := a.Lookup(t.Context(), "movie", "tt1375666")
	require.NoError(t, err)
	require.Equal(t, AgeRating{Rating: "14", System: "ClassInd"}, r)
	_, _ = a.Lookup(t.Context(), "movie", "tt1375666")
	require.Equal(t, 1, *calls)

	b, _ := fakeRatings(t, "", nil, wikidataSays("", "PG-13"))
	r, _ = b.Lookup(t.Context(), "movie", "tt0816692")
	require.Equal(t, AgeRating{Rating: "PG-13", System: "US"}, r)
}

func TestRatingsRouteRejectsBadIdsAndHidesFailures(t *testing.T) {
	a, _ := fakeRatings(t, "", nil, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) })
	e := gin.New()
	e.GET("/api/ratings/:type/:id", a.handle)
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}
	require.Equal(t, http.StatusBadRequest, get("/api/ratings/movie/123").Code)
	require.Equal(t, http.StatusBadRequest, get("/api/ratings/game/tt0371746").Code)
	w := get("/api/ratings/movie/tt0371746")
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"rating":""}`, w.Body.String())
}
