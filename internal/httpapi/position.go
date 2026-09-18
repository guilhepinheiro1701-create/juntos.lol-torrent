package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/giulianoo0/ss/internal/room"
)

const maxPositionBodyBytes = 1 << 10

// PositionHooks is what a viewer's report is good for. Both are nil-safe.
//
// Follow moves production to where the viewer actually is: seeking past what
// the fleet has produced is what makes it produce from there. The socket used
// to carry this for free, because the server saw every seek; now the browser
// has to say so.
//
// Seen keeps the room alive. Abandonment is no longer "nobody is connected" —
// it is "nobody has said anything for a while".
type PositionHooks struct {
	Follow func(roomID string, positionMs int64)
	Seen   func(roomID string)
}

type positionRequest struct {
	OwnerToken string `json:"ownerToken"`
	MemberID   string `json:"memberId"`
	Capability string `json:"capability"`
	PositionMs *int64 `json:"positionMs" binding:"required"`
}

// RegisterPositionRoute mounts the viewer's position report.
func RegisterPositionRoute(rg *gin.RouterGroup, store *room.Store, authorizer memberAuthorizer, hooks PositionHooks) {
	rg.POST("/rooms/:id/position", reportPosition(store, authorizer, hooks))
}

func reportPosition(store *room.Store, authorizer memberAuthorizer, hooks PositionHooks) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("id")
		if !validMediaRoomID(roomID) {
			c.Status(http.StatusNotFound)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPositionBodyBytes)
		var req positionRequest
		if err := c.ShouldBindJSON(&req); err != nil || *req.PositionMs < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		storedRoom, ok := loadLiveRoom(c, store, roomID)
		if !ok {
			return
		}
		if !authorizeController(c, storedRoom, authorizer, req.OwnerToken, req.MemberID, req.Capability) {
			return
		}
		if hooks.Seen != nil {
			hooks.Seen(roomID)
		}
		if hooks.Follow != nil {
			// Follow debounces on its own, so a viewer reporting on a timer
			// cannot turn a steady position into steady work.
			hooks.Follow(roomID, *req.PositionMs)
		}
		c.Status(http.StatusNoContent)
	}
}
