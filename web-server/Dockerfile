# Enhanced Go RTC Server - Single Binary Deployment
FROM golang:1.23-alpine AS builder

# Install git for go mod downloads
RUN apk add --no-cache git

WORKDIR /app

# Copy go modules and download dependencies
COPY go-webrtc-server/go.mod go-webrtc-server/go.sum ./
RUN go mod download

# Copy source code
COPY go-webrtc-server/*.go ./

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -a -installsuffix cgo \
    -ldflags="-w -s" \
    -o cs16-webrtc-server .

# Final stage - minimal runtime
FROM alpine:latest

# Install ca-certificates for HTTPS requests (if needed)
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy the binary
COPY --from=builder /app/cs16-webrtc-server ./

# Copy client files and dashboard
COPY go-webrtc-server/client/ ./client/
COPY go-webrtc-server/dashboard.html ./

# Create non-root user
RUN addgroup -g 1001 cs16 && \
    adduser -D -s /bin/sh -u 1001 -G cs16 cs16

# Change ownership
RUN chown -R cs16:cs16 /app

USER cs16

# Expose dashboard port and WebRTC port range (8000-8030)
EXPOSE 8080
# WebRTC server ports for CS servers (27000-27030 -> 8000-8030)
EXPOSE 8000-8030

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/heartbeat || exit 1

# Start the enhanced Go server
CMD ["./cs16-webrtc-server"]
