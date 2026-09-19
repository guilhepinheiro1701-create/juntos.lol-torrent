package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/giulianoo0/ss/internal/objectstore"
)

// RegisterMediaObjectRoutes serves the local install's object folder from the
// same server that serves the page. PUT and GET share one address because that
// is what a bucket looks like from the browser's side: only the host changes,
// and being same-origin is what removes the cross-origin rules, the signed
// host name and the second server along with it.
func RegisterMediaObjectRoutes(r gin.IRouter, disk *objectstore.Disk) {
	if disk == nil {
		return
	}
	r.PUT(objectstore.UploadPath+"/*key", putMediaObject(disk))
	r.GET(objectstore.UploadPath+"/*key", getMediaObject(disk))
	r.HEAD(objectstore.UploadPath+"/*key", getMediaObject(disk))
}

// objectKey undoes gin's wildcard, which always hands back a leading slash.
func objectKey(c *gin.Context) string {
	return strings.TrimPrefix(c.Param("key"), "/")
}

func putMediaObject(disk *objectstore.Disk) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := objectKey(c)
		// A known length is required: the signature covers the exact number of
		// bytes, so a body of unannounced length has nothing to be checked
		// against and is refused rather than stored at whatever size it is.
		size := c.Request.ContentLength
		if size < 0 {
			c.Status(http.StatusLengthRequired)
			return
		}
		err := disk.AcceptPut(c.Request.Context(), key,
			c.GetHeader("Content-Type"), c.GetHeader("Cache-Control"),
			size, c.Query("exp"), c.Query("sig"), c.Request.Body)
		switch {
		case errors.Is(err, objectstore.ErrNotSigned):
			c.Status(http.StatusForbidden)
		case err != nil:
			slog.ErrorContext(c.Request.Context(), "store media object failed",
				"key", key, "error", err)
			c.Status(http.StatusInternalServerError)
		default:
			c.Status(http.StatusOK)
		}
	}
}

func getMediaObject(disk *objectstore.Disk) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := objectKey(c)
		file, info, err := disk.Open(key)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				slog.ErrorContext(c.Request.Context(), "read media object failed",
					"key", key, "error", err)
			}
			c.Status(http.StatusNotFound)
			return
		}
		defer file.Close()
		contentType, cacheControl := objectstore.ContentTypeFor(key)
		c.Header("Content-Type", contentType)
		c.Header("Cache-Control", cacheControl)
		// ServeContent, and not a plain copy, because the player asks for byte
		// ranges and expects them to be honoured.
		http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
	}
}
