package objectstore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newDisk(t *testing.T) *Disk {
	t.Helper()
	disk, err := NewDisk(t.TempDir(), "")
	if err != nil {
		t.Fatalf("NewDisk: %v", err)
	}
	return disk
}

func TestDiskPutStatOpen(t *testing.T) {
	disk := newDisk(t)
	body := []byte("segment bytes")
	key := "rooms/abc/hls/g1/cs_0_1.m4s"
	if err := disk.Put(context.Background(), key, bytes.NewReader(body), int64(len(body)), "video/iso.segment", ""); err != nil {
		t.Fatalf("Put: %v", err)
	}
	size, err := disk.Stat(context.Background(), key)
	if err != nil || size != int64(len(body)) {
		t.Fatalf("Stat = %d, %v", size, err)
	}
	file, info, err := disk.Open(key)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer file.Close()
	got, _ := io.ReadAll(file)
	if !bytes.Equal(got, body) || info.Size() != int64(len(body)) {
		t.Fatalf("read back %q", got)
	}
}

// A body that is not the length it claimed must leave nothing behind: a
// half-written segment under the real name is worse than no segment at all.
func TestDiskPutRejectsWrongLength(t *testing.T) {
	disk := newDisk(t)
	key := "rooms/abc/short.m4s"
	if err := disk.Put(context.Background(), key, strings.NewReader("ab"), 10, "", ""); err == nil {
		t.Fatal("expected a length mismatch to fail")
	}
	if _, err := disk.Stat(context.Background(), key); err == nil {
		t.Fatal("a failed put must not publish the object")
	}
	entries, _ := os.ReadDir(filepath.Join(disk.root, "rooms", "abc"))
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".partial-") {
			continue
		}
		t.Fatalf("left a temporary file behind: %s", entry.Name())
	}
}

func TestDiskRefusesKeysOutsideTheFolder(t *testing.T) {
	disk := newDisk(t)
	for _, key := range []string{
		"../escape", "rooms/../../escape", "/absolute", "", ".",
		"rooms//double", "rooms/./here", "back\\slash",
	} {
		if err := disk.Put(context.Background(), key, strings.NewReader("x"), 1, "", ""); err == nil {
			t.Fatalf("accepted key %q", key)
		}
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(disk.root), "escape")); err == nil {
		t.Fatal("wrote outside the folder")
	}
}

func TestDiskRemovePrefix(t *testing.T) {
	disk := newDisk(t)
	write := func(key string) {
		if err := disk.Put(context.Background(), key, strings.NewReader("x"), 1, "", ""); err != nil {
			t.Fatalf("Put %s: %v", key, err)
		}
	}
	write("rooms/one/a.m4s")
	write("rooms/one/deep/b.m4s")
	write("rooms/oneother/c.m4s")
	write("rooms/two/d.m4s")

	// The trailing separator is load-bearing: without it the prefix would also
	// reach the room whose id merely starts with this one's.
	if err := disk.RemovePrefix(context.Background(), RoomPrefix("one")); err != nil {
		t.Fatalf("RemovePrefix: %v", err)
	}
	for _, gone := range []string{"rooms/one/a.m4s", "rooms/one/deep/b.m4s"} {
		if _, err := disk.Stat(context.Background(), gone); err == nil {
			t.Fatalf("%s survived", gone)
		}
	}
	for _, kept := range []string{"rooms/oneother/c.m4s", "rooms/two/d.m4s"} {
		if _, err := disk.Stat(context.Background(), kept); err != nil {
			t.Fatalf("%s should have survived: %v", kept, err)
		}
	}
	if err := disk.RemovePrefix(context.Background(), ""); !errors.Is(err, ErrEmptyPrefix) {
		t.Fatalf("empty prefix: %v", err)
	}
	// A prefix that is not a whole folder still matches by name, the way the
	// same call does against a bucket.
	if err := disk.RemovePrefix(context.Background(), "rooms/oneo"); err != nil {
		t.Fatalf("RemovePrefix by name: %v", err)
	}
	if _, err := disk.Stat(context.Background(), "rooms/oneother/c.m4s"); err == nil {
		t.Fatal("name prefix did not match")
	}
	// Removing something that was never there is not an error: the sweeper runs
	// on a timer and would otherwise log a failure for every already-clean room.
	if err := disk.RemovePrefix(context.Background(), RoomPrefix("never")); err != nil {
		t.Fatalf("missing prefix: %v", err)
	}
}

type signed struct {
	key, contentType, cacheControl, exp, sig string
	size                                     int64
}

func presign(t *testing.T, disk *Disk, key string, size int64) signed {
	t.Helper()
	raw, headers, err := disk.PresignPut(context.Background(), key, "video/iso.segment",
		"public, max-age=31536000, immutable", size, 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	if parsed.Path != UploadPath+"/"+key {
		t.Fatalf("url path = %q", parsed.Path)
	}
	return signed{
		key:          key,
		contentType:  headers.Get("Content-Type"),
		cacheControl: headers.Get("Cache-Control"),
		exp:          parsed.Query().Get("exp"),
		sig:          parsed.Query().Get("sig"),
		size:         size,
	}
}

func (s signed) accept(disk *Disk, body string) error {
	return disk.AcceptPut(context.Background(), s.key, s.contentType, s.cacheControl,
		s.size, s.exp, s.sig, strings.NewReader(body))
}

func TestDiskPresignRoundTrip(t *testing.T) {
	disk := newDisk(t)
	body := "the segment"
	ticket := presign(t, disk, "rooms/abc/hls/g1/cs_0_1.m4s", int64(len(body)))
	if err := ticket.accept(disk, body); err != nil {
		t.Fatalf("AcceptPut: %v", err)
	}
	if size, err := disk.Stat(context.Background(), ticket.key); err != nil || size != int64(len(body)) {
		t.Fatalf("Stat = %d, %v", size, err)
	}
}

// Everything the signature covers is read back from the request, so changing
// any of it has to fail rather than store something nobody signed for.
func TestDiskAcceptRefusesAnythingElse(t *testing.T) {
	disk := newDisk(t)
	body := "the segment"
	base := presign(t, disk, "rooms/abc/hls/g1/cs_0_1.m4s", int64(len(body)))

	tampered := map[string]signed{}
	other := base
	other.key = "rooms/abc/hls/g1/cs_0_2.m4s"
	tampered["another object"] = other

	retyped := base
	retyped.contentType = "text/html"
	tampered["another content type"] = retyped

	recached := base
	recached.cacheControl = "no-store"
	tampered["another cache control"] = recached

	resized := base
	resized.size = base.size + 1
	tampered["another length"] = resized

	forged := base
	forged.sig = strings.Repeat("0", len(base.sig))
	tampered["a forged signature"] = forged

	unsigned := base
	unsigned.sig = ""
	tampered["no signature"] = unsigned

	garbled := base
	garbled.exp = "not-a-time"
	tampered["an unreadable deadline"] = garbled

	for name, ticket := range tampered {
		if err := ticket.accept(disk, body); !errors.Is(err, ErrNotSigned) {
			t.Fatalf("%s: err = %v, want ErrNotSigned", name, err)
		}
		if _, err := disk.Stat(context.Background(), ticket.key); err == nil {
			t.Fatalf("%s: stored the object anyway", name)
		}
	}
}

func TestDiskAcceptRefusesExpired(t *testing.T) {
	disk := newDisk(t)
	body := "late"
	key := "rooms/abc/hls/g1/cs_0_9.m4s"
	_, headers, err := disk.PresignPut(context.Background(), key, "video/iso.segment", "", int64(len(body)), -time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	deadline := time.Now().Add(-time.Minute).Unix()
	sig := disk.sign(key, headers.Get("Content-Type"), "", int64(len(body)), deadline)
	err = disk.AcceptPut(context.Background(), key, headers.Get("Content-Type"), "",
		int64(len(body)), formatUnix(deadline), sig, strings.NewReader(body))
	if !errors.Is(err, ErrNotSigned) {
		t.Fatalf("expired upload: %v", err)
	}
}

// Two installs must not be able to sign for each other, and a restart must not
// keep honouring what the run before it signed.
func TestDiskSecretsDiffer(t *testing.T) {
	first := newDisk(t)
	second, err := NewDisk(first.root, "")
	if err != nil {
		t.Fatalf("NewDisk: %v", err)
	}
	ticket := presign(t, first, "rooms/abc/hls/g1/cs_0_1.m4s", 4)
	if err := ticket.accept(second, "abcd"); !errors.Is(err, ErrNotSigned) {
		t.Fatalf("a second store honoured the first one's signature: %v", err)
	}
}

func TestDiskPublicBase(t *testing.T) {
	disk, err := NewDisk(t.TempDir(), "http://localhost:8099/")
	if err != nil {
		t.Fatalf("NewDisk: %v", err)
	}
	if got := disk.PublicBase(); got != "http://localhost:8099"+UploadPath {
		t.Fatalf("PublicBase = %q", got)
	}
}

func TestContentTypeFor(t *testing.T) {
	for key, want := range map[string]string{
		"rooms/a/cs_0_1.m4s":  "video/iso.segment",
		"rooms/a/cinit_0.mp4": "video/mp4",
		"rooms/a/master.m3u8": "application/vnd.apple.mpegurl",
		"rooms/a/subs.VTT":    "text/vtt; charset=utf-8",
		"rooms/a/whatever":    "application/octet-stream",
	} {
		if got, _ := ContentTypeFor(key); got != want {
			t.Fatalf("ContentTypeFor(%q) = %q, want %q", key, got, want)
		}
	}
	// Playlists and subtitles are rewritten in place; segments never are.
	if _, cache := ContentTypeFor("a/master.m3u8"); cache != "no-cache" {
		t.Fatalf("playlist cache control = %q", cache)
	}
	if _, cache := ContentTypeFor("a/cs_0_1.m4s"); !strings.Contains(cache, "immutable") {
		t.Fatalf("segment cache control = %q", cache)
	}
}

func formatUnix(seconds int64) string { return strconv.FormatInt(seconds, 10) }

// A folder that cannot be written to is a store that fails at play time, hours
// after the boot that should have caught it.
func TestNewDiskRefusesAFolderItCannotWriteTo(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root writes anywhere, so there is nothing to refuse")
	}
	parent := t.TempDir()
	readOnly := filepath.Join(parent, "locked")
	if err := os.Mkdir(readOnly, 0o500); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	if _, err := NewDisk(readOnly, ""); err == nil {
		t.Fatal("opened a folder it cannot write to")
	}
}
