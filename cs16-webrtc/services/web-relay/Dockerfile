# CS1.6 WebRTC Relay Service
FROM golang:1.23-alpine AS go-builder

WORKDIR /build
COPY services/web-relay/src/go/go.mod services/web-relay/src/go/go.sum ./
RUN go mod download

COPY services/web-relay/src/go/*.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o webrtc-server

# Final runtime image
FROM python:3.11-slim

# Install Python dependencies
COPY services/web-relay/src/python/requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy Go binary
COPY --from=go-builder /build/webrtc-server /usr/local/bin/webrtc-server

# Copy Python relay server
COPY services/web-relay/src/python/unified_server.py /app/relay_server.py

# Copy web assets
COPY services/web-relay/web/dashboard.html /app/
COPY services/web-relay/web/client /app/web/client/

# Copy startup script from context root
COPY scripts/start.sh /app/
RUN chmod +x /app/start.sh

WORKDIR /app
EXPOSE 8080 3000

CMD ["/app/start.sh"]