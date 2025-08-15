FROM golang:1.23-alpine AS go-builder

WORKDIR /app/go
COPY go-webrtc-server/go.mod go-webrtc-server/go.sum ./
RUN go mod download
COPY go-webrtc-server/*.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o webrtc-server .

FROM python:3.11-slim

# Install supervisor to manage both processes
RUN apt-get update && apt-get install -y supervisor && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
WORKDIR /app
COPY python-udp-relay/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python UDP relay
COPY python-udp-relay/*.py ./

# Copy Go WebRTC server binary
COPY --from=go-builder /app/go/webrtc-server ./

# Copy client files and dashboard
COPY go-webrtc-server/client/ ./client/
COPY go-webrtc-server/dashboard.html ./

# Create supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports
EXPOSE 8080 3000

# Start supervisor to manage both Go WebRTC server and Python UDP relay
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
