package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/giulianoo0/ss/internal/config"
	"github.com/giulianoo0/ss/internal/room"
)

const maxSourceBodyBytes = 4 << 10

// memberAuthorizer proves that a memberId+capability pair belongs to a seat
// the room's socket handed out; the hub is the only implementation.
type memberAuthorizer interface {
	AuthorizeMember(roomID, memberID, capability string) bool
}

// authorizeController answers whether the caller may act as the room's
// controller and writes the refusal itself when it may not. The owner token is
// tried first because it needs no socket: the browser that created the room
// holds it from the moment the room exists, so a single-viewer session never
// has to be connected to change what it is watching.
func authorizeController(c *gin.Context, storedRoom *room.Room, authorizer memberAuthorizer,
	ownerToken, memberID, capability string) bool {
	if storedRoom.OwnedBy(ownerToken) {
		return true
	}
	if memberID == "" || capability == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "member_not_found"})
		return false
	}
	if authorizer == nil || !authorizer.AuthorizeMember(storedRoom.ID, memberID, capability) {
		c.JSON(http.StatusForbidden, gin.H{"error": "member_not_found"})
		return false
	}
	if storedRoom.ControllerID != memberID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not_controller"})
		return false
	}
	return true
}

// SourceHooks lets a room change what it is playing without httpapi depending on
// the media pipeline. Both are nil-safe, and CancelMedia runs before the old files
// are removed so ffmpeg is not left writing into a directory being deleted.
// ResetPlayback runs once the room points at the new source, before its status
// is announced, so members drop the old clock before they look for new media.
type SourceHooks struct {
	CancelMedia   func(roomID string)
	NotifyStatus  func(roomID, status string)
	ResetPlayback func(roomID string)
}

// changeSourceRequest carries one of two proofs that the caller may repoint
// the room: the owner token the creating browser kept, or a memberId plus the
// capability its socket seat was given. Neither field is individually
// required, so the binding cannot demand either; authorizeController does.
type changeSourceRequest struct {
	OwnerToken string `json:"ownerToken"`
	MemberID   string `json:"memberId"`
	Capability string `json:"capability"`
	Kind       string `json:"kind" binding:"required"`
	FileName   string `json:"fileName"`
}

// RegisterSourceRoute mounts the controller-only endpoint that repoints a live room
// at a new source; members, chat and the controller all survive the swap.
func RegisterSourceRoute(rg *gin.RouterGroup, store *room.Store, cfg config.Config,
	authorizer memberAuthorizer, hooks SourceHooks) {
	rg.POST("/rooms/:id/source", changeSource(store, cfg, authorizer, hooks))
}

func changeSource(store *room.Store, cfg config.Config, authorizer memberAuthorizer,
	hooks SourceHooks) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("id")
		if !validMediaRoomID(roomID) {
			c.Status(http.StatusNotFound)
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSourceBodyBytes)
		var req changeSourceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		status, fileName, ok := sourceTarget(req)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		storedRoom, err := store.Get(c.Request.Context(), roomID)
		if errors.Is(err, room.ErrNotFound) || err == nil && !storedRoom.ExpiresAt.After(time.Now()) {
			c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
			return
		}
		if err != nil {
			slog.ErrorContext(c.Request.Context(), "load room for source change", "room_id", roomID, "error", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		if !authorizeController(c, storedRoom, authorizer, req.OwnerToken, req.MemberID, req.Capability) {
			return
		}

		if hooks.CancelMedia != nil {
			hooks.CancelMedia(roomID)
		}
		if err := os.RemoveAll(filepath.Join(cfg.DataDir, "rooms", roomID)); err != nil {
			slog.ErrorContext(c.Request.Context(), "remove previous room media", "room_id", roomID, "error", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		kind := req.Kind
		if kind == room.SourceYoutube {
			kind = room.SourceUpload
		}
		_, generation, err := store.SwapSource(
			c.Request.Context(), roomID, kind, fileName, status, time.Now())
		if errors.Is(err, room.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
			return
		}
		if err != nil {
			slog.ErrorContext(c.Request.Context(), "swap room source", "room_id", roomID, "error", err)
			c.Status(http.StatusInternalServerError)
			return
		}

		if hooks.ResetPlayback != nil {
			hooks.ResetPlayback(roomID)
		}
		if hooks.NotifyStatus != nil {
			hooks.NotifyStatus(roomID, status)
		}
		c.JSON(http.StatusOK, gin.H{
			"status":          status,
			"sourceKind":      kind,
			"fileName":        fileName,
			"mediaGeneration": generation,
		})
	}
}

// sourceTarget validates the requested source and reports the status the room should
// land in: an upload must be prepared first, a shared screen is live immediately.
func sourceTarget(req changeSourceRequest) (status, fileName string, ok bool) {
	switch req.Kind {
	case room.SourceUpload:
		if !validFileName(req.FileName) {
			return "", "", false
		}
		return "uploading", req.FileName, true
	case room.SourceScreen:
		return "ready", "", true
	case room.SourceYoutube:
		if !validRoomText(req.FileName, maxFileNameBytes) {
			return "", "", false
		}
		return "uploading", req.FileName, true
	default:
		return "", "", false
	}
}
