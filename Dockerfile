# Multi-stage build for CS16 WebRTC Hybrid Relay
FROM golang:1.23-alpine AS go-builder

WORKDIR /build
COPY go-webrtc-server/go.mod go-webrtc-server/go.sum ./
RUN go mod download

COPY go-webrtc-server/*.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o webrtc-server

# Final runtime image
FROM python:3.11-slim

# Install Python dependencies
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy Go binary
COPY --from=go-builder /build/webrtc-server /usr/local/bin/webrtc-server

# Copy Python server (API only, no web serving)
COPY unified_server.py /app/

# Copy dashboard HTML
COPY dashboard.html /app/

# Copy built web client to Go server's public directory
COPY yohimik-client/* /app/public/
COPY yohimik-client/assets /app/public/assets/

# Create startup script
COPY start.sh /app/
RUN chmod +x /app/start.sh

WORKDIR /app
EXPOSE 8080 3000

# Start both services
CMD ["/app/start.sh"]