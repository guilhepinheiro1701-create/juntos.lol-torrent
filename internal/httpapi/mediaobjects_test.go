package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/giulianoo0/ss/internal/objectstore"
)

func mediaObjectServer(t *testing.T) (*gin.Engine, *objectstore.Disk) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	disk, err := objectstore.NewDisk(t.TempDir(), "")
	if err != nil {
		t.Fatalf("NewDisk: %v", err)
	}
	r := gin.New()
	RegisterMediaObjectRoutes(r, disk)
	return r, disk
}

// upload walks the same road the browser does: ask for a signature, then PUT
// to exactly the address and headers that came back.
func upload(t *testing.T, r *gin.Engine, disk *objectstore.Disk, key, body string) *httptest.ResponseRecorder {
	t.Helper()
	raw, headers, err := disk.PresignPut(context.Background(), key, "video/iso.segment",
		"public, max-age=31536000, immutable", int64(len(body)), 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, raw, strings.NewReader(body))
	for name := range headers {
		req.Header.Set(name, headers.Get(name))
	}
	req.ContentLength = int64(len(body))
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	return res
}

func TestMediaObjectUploadThenServe(t *testing.T) {
	r, disk := mediaObjectServer(t)
	body := "a segment's worth of bytes"
	key := "rooms/abc/hls/g1/cs_0_1.m4s"
	if res := upload(t, r, disk, key, body); res.Code != http.StatusOK {
		t.Fatalf("PUT = %d (%s)", res.Code, res.Body.String())
	}

	res := httptest.NewRecorder()
	r.ServeHTTP(res, httptest.NewRequest(http.MethodGet, objectstore.UploadPath+"/"+key, nil))
	if res.Code != http.StatusOK || res.Body.String() != body {
		t.Fatalf("GET = %d, %q", res.Code, res.Body.String())
	}
	if got := res.Header().Get("Content-Type"); got != "video/iso.segment" {
		t.Fatalf("content type = %q", got)
	}

	// The player asks for byte ranges, so the answer has to be a real range.
	ranged := httptest.NewRequest(http.MethodGet, objectstore.UploadPath+"/"+key, nil)
	ranged.Header.Set("Range", "bytes=2-5")
	res = httptest.NewRecorder()
	r.ServeHTTP(res, ranged)
	if res.Code != http.StatusPartialContent || res.Body.String() != body[2:6] {
		t.Fatalf("range = %d, %q", res.Code, res.Body.String())
	}
}

func TestMediaObjectMissingIsNotFound(t *testing.T) {
	r, _ := mediaObjectServer(t)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, httptest.NewRequest(http.MethodGet, objectstore.UploadPath+"/rooms/abc/nothing.m4s", nil))
	if res.Code != http.StatusNotFound {
		t.Fatalf("GET = %d", res.Code)
	}
}

func TestMediaObjectRefusesUnsignedPut(t *testing.T) {
	r, disk := mediaObjectServer(t)
	body := "not mine to write"
	key := "rooms/abc/hls/g1/cs_0_1.m4s"

	bare := httptest.NewRequest(http.MethodPut, objectstore.UploadPath+"/"+key, strings.NewReader(body))
	bare.Header.Set("Content-Type", "video/iso.segment")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, bare)
	if res.Code != http.StatusForbidden {
		t.Fatalf("unsigned PUT = %d, want 403", res.Code)
	}

	// A signature for one object must not travel to another.
	raw, headers, err := disk.PresignPut(context.Background(), key, "video/iso.segment",
		"public, max-age=31536000, immutable", int64(len(body)), 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	parsed, _ := url.Parse(raw)
	moved := httptest.NewRequest(http.MethodPut,
		objectstore.UploadPath+"/rooms/other/hls/g1/cs_0_1.m4s?"+parsed.RawQuery, strings.NewReader(body))
	for name := range headers {
		moved.Header.Set(name, headers.Get(name))
	}
	moved.ContentLength = int64(len(body))
	res = httptest.NewRecorder()
	r.ServeHTTP(res, moved)
	if res.Code != http.StatusForbidden {
		t.Fatalf("moved PUT = %d, want 403", res.Code)
	}

	if _, err := disk.Stat(context.Background(), key); err == nil {
		t.Fatal("a refused upload stored the object anyway")
	}
}

// Without a length there is nothing for the signature to pin, so the upload is
// refused rather than stored at whatever size it turns out to be.
func TestMediaObjectRefusesUnknownLength(t *testing.T) {
	r, disk := mediaObjectServer(t)
	body := "chunked"
	key := "rooms/abc/hls/g1/cs_0_1.m4s"
	raw, headers, err := disk.PresignPut(context.Background(), key, "video/iso.segment",
		"public, max-age=31536000, immutable", int64(len(body)), 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, raw, strings.NewReader(body))
	for name := range headers {
		req.Header.Set(name, headers.Get(name))
	}
	req.ContentLength = -1
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusLengthRequired {
		t.Fatalf("unsized PUT = %d, want 411", res.Code)
	}
}

// A body longer than the signature allows is cut at the signed length, so a
// client cannot spend more of the room's budget than it asked for.
func TestMediaObjectStoresOnlyTheSignedLength(t *testing.T) {
	r, disk := mediaObjectServer(t)
	body := "exactly this"
	key := "rooms/abc/hls/g1/cs_0_1.m4s"
	raw, headers, err := disk.PresignPut(context.Background(), key, "video/iso.segment",
		"public, max-age=31536000, immutable", int64(len(body)), 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	longer := body + " and a great deal more"
	req := httptest.NewRequest(http.MethodPut, raw, strings.NewReader(longer))
	for name := range headers {
		req.Header.Set(name, headers.Get(name))
	}
	// The request still claims the signed length; the body does not match it.
	req.ContentLength = int64(len(body))
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("PUT = %d", res.Code)
	}
	size, err := disk.Stat(context.Background(), key)
	if err != nil || size != int64(len(body)) {
		t.Fatalf("stored %d bytes, want %d (%v)", size, len(body), err)
	}
}
