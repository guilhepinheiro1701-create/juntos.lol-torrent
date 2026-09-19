package objectstore

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Disk keeps the objects in a folder instead of a bucket.
//
// The cloud install needs a real bucket: the edge serves the segments, and the
// machine that writes them is not the machine that reads them. On one computer
// there is no edge and no second machine, so a bucket buys nothing and costs a
// lot — a second server to run, a password to keep, an address that has to mean
// the same thing inside the container and outside it, and cross-origin rules to
// match. Disk drops all of that: the same server that shows the page also holds
// the segments, so everything is same-origin and there is nothing else to boot.
type Disk struct {
	root   string
	base   string
	secret []byte
}

// UploadPath is where the browser writes and reads its segments. PUT and GET
// share it on purpose: that is how a bucket behaves, so only the address
// changes and the page's code does not.
const UploadPath = "/media-objects"

// NewDisk opens root, creating it if needed. base is the address the browser
// should use; empty means "the same origin as the page", which is what the
// local install wants and what removes the need to name a host at all.
//
// The signing secret is fresh at every boot and never leaves memory. Losing it
// on a restart invalidates signatures that were minted before, which is the
// same thing their fifteen-minute expiry already does.
func NewDisk(root, base string) (*Disk, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("objectstore: disk needs a folder")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("objectstore: resolve %s: %w", root, err)
	}
	if err := os.MkdirAll(absolute, 0o755); err != nil {
		return nil, fmt.Errorf("objectstore: create %s: %w", absolute, err)
	}
	// Writing once, now, rather than discovering at the first segment that the
	// folder is not ours to write in. A mounted volume belongs to whoever owns
	// it, which is not always the user this process runs as, and a store that
	// cannot be written to has to say so at boot instead of at play time.
	probe, err := os.CreateTemp(absolute, ".writable-*")
	if err != nil {
		return nil, fmt.Errorf("objectstore: %s is not writable: %w", absolute, err)
	}
	probe.Close()
	os.Remove(probe.Name())

	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("objectstore: generate signing secret: %w", err)
	}
	return &Disk{root: absolute, base: strings.TrimSuffix(base, "/"), secret: secret}, nil
}

// PublicBase is what the playlists should point at for this store.
func (d *Disk) PublicBase() string { return d.base + UploadPath }

// resolve turns an object key into a path inside root, and refuses anything
// that would land outside it. The keys this store is given are built by our own
// code from validated names, so this check should never fire; it exists because
// a path join that trusts its input is the one that is wrong later.
func (d *Disk) resolve(key string) (string, error) {
	if key == "" || strings.ContainsAny(key, "\\\x00") || strings.HasPrefix(key, "/") {
		return "", fmt.Errorf("objectstore: bad key %q", key)
	}
	clean := path.Clean(key)
	if clean != key || clean == "." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("objectstore: bad key %q", key)
	}
	full := filepath.Join(d.root, filepath.FromSlash(clean))
	if full != d.root && !strings.HasPrefix(full, d.root+string(os.PathSeparator)) {
		return "", fmt.Errorf("objectstore: bad key %q", key)
	}
	return full, nil
}

// Put writes the object whole or not at all: a reader that dies halfway leaves
// a temporary file behind, never a half-written segment under the real name.
// contentType and cacheControl are not stored; see ContentTypeFor.
func (d *Disk) Put(_ context.Context, key string, reader io.Reader, size int64,
	_, _ string) error {
	full, err := d.resolve(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("objectstore: create folder for %s: %w", key, err)
	}
	temp, err := os.CreateTemp(filepath.Dir(full), ".partial-*")
	if err != nil {
		return fmt.Errorf("objectstore: open temp for %s: %w", key, err)
	}
	name := temp.Name()
	defer os.Remove(name)
	written, err := io.Copy(temp, reader)
	if err != nil {
		temp.Close()
		return fmt.Errorf("objectstore: write %s: %w", key, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("objectstore: close %s: %w", key, err)
	}
	if size >= 0 && written != size {
		return fmt.Errorf("objectstore: %s is %d bytes, expected %d", key, written, size)
	}
	if err := os.Rename(name, full); err != nil {
		return fmt.Errorf("objectstore: publish %s: %w", key, err)
	}
	return nil
}

// Stat reports the size of an object, which is how a browser's claim that it
// uploaded a segment is checked without reading the bytes back.
func (d *Disk) Stat(_ context.Context, key string) (int64, error) {
	full, err := d.resolve(key)
	if err != nil {
		return 0, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return 0, fmt.Errorf("objectstore: stat %s: %w", key, err)
	}
	if info.IsDir() {
		return 0, fmt.Errorf("objectstore: %s is a folder", key)
	}
	return info.Size(), nil
}

// RemovePrefix deletes everything under prefix. A prefix ending in a separator
// is a whole folder; anything else matches by name inside its parent, which is
// what the same call means against a bucket.
func (d *Disk) RemovePrefix(_ context.Context, prefix string) error {
	if prefix == "" {
		return ErrEmptyPrefix
	}
	if strings.HasSuffix(prefix, "/") {
		full, err := d.resolve(strings.TrimSuffix(prefix, "/"))
		if err != nil {
			return err
		}
		if err := os.RemoveAll(full); err != nil {
			return fmt.Errorf("objectstore: remove %s: %w", prefix, err)
		}
		return nil
	}
	parent, leaf := path.Split(prefix)
	dir := d.root
	if parent != "" {
		resolved, err := d.resolve(strings.TrimSuffix(parent, "/"))
		if err != nil {
			return err
		}
		dir = resolved
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("objectstore: list %s: %w", prefix, err)
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), leaf) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
			return fmt.Errorf("objectstore: remove %s: %w", entry.Name(), err)
		}
	}
	return nil
}

// sign covers everything the upload is allowed to be: which object, what it
// contains, how it may be cached, exactly how many bytes, and until when. The
// receiving end rebuilds this from the request itself, so a body of a different
// length, or a different content type, simply fails to match.
func (d *Disk) sign(key, contentType, cacheControl string, size, expiry int64) string {
	mac := hmac.New(sha256.New, d.secret)
	fmt.Fprintf(mac, "PUT\n%s\n%s\n%s\n%d\n%d", key, contentType, cacheControl, size, expiry)
	return hex.EncodeToString(mac.Sum(nil))
}

// PresignPut hands back an address the browser can PUT to directly, in the same
// shape R2 does: a URL plus the exact headers that were signed for.
func (d *Disk) PresignPut(_ context.Context, key, contentType, cacheControl string,
	size int64, expiry time.Duration) (string, http.Header, error) {
	if _, err := d.resolve(key); err != nil {
		return "", nil, err
	}
	deadline := time.Now().Add(expiry).Unix()
	query := url.Values{}
	query.Set("exp", strconv.FormatInt(deadline, 10))
	query.Set("sig", d.sign(key, contentType, cacheControl, size, deadline))
	headers := http.Header{
		"Content-Type":   []string{contentType},
		"Cache-Control":  []string{cacheControl},
		"Content-Length": []string{strconv.FormatInt(size, 10)},
	}
	return d.PublicBase() + "/" + key + "?" + query.Encode(), headers, nil
}

// ErrNotSigned is any upload this store did not authorize: a wrong or missing
// signature, one that expired, or a body that is not the size that was signed.
var ErrNotSigned = errors.New("objectstore: upload is not signed for")

// AcceptPut stores a browser's upload after checking it is the one that was
// signed for. Everything that goes into the signature is read back from the
// request, so nothing here has to trust a caller-supplied field.
func (d *Disk) AcceptPut(ctx context.Context, key, contentType, cacheControl string,
	size int64, expiry, signature string, body io.Reader) error {
	deadline, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil || deadline <= 0 {
		return ErrNotSigned
	}
	if time.Now().Unix() > deadline {
		return ErrNotSigned
	}
	if size < 0 {
		return ErrNotSigned
	}
	want := d.sign(key, contentType, cacheControl, size, deadline)
	if !hmac.Equal([]byte(want), []byte(signature)) {
		return ErrNotSigned
	}
	return d.Put(ctx, key, io.LimitReader(body, size), size, contentType, cacheControl)
}

// Open returns the stored object for reading, along with what to say about it.
func (d *Disk) Open(key string) (*os.File, os.FileInfo, error) {
	full, err := d.resolve(key)
	if err != nil {
		return nil, nil, err
	}
	file, err := os.Open(full)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		file.Close()
		if err == nil {
			err = fmt.Errorf("objectstore: %s is a folder", key)
		}
		return nil, nil, err
	}
	return file, info, nil
}

// ContentTypeFor answers what an object is from its name, and how long it may
// be held. The content type is not stored next to each object on purpose: that
// would mean a second small file per segment — thousands of them for one film —
// and it would buy nothing, because every key this store ever sees is built by
// our own code from a closed set of names.
func ContentTypeFor(key string) (contentType, cacheControl string) {
	switch strings.ToLower(path.Ext(key)) {
	case ".m4s":
		return "video/iso.segment", "public, max-age=31536000, immutable"
	case ".mp4":
		return "video/mp4", "public, max-age=31536000, immutable"
	case ".m3u8":
		return "application/vnd.apple.mpegurl", "no-cache"
	case ".vtt":
		return "text/vtt; charset=utf-8", "no-cache"
	default:
		return "application/octet-stream", "no-cache"
	}
}
