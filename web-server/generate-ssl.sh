#!/bin/bash
# Generate self-signed SSL certificate for LAN access

# Create SSL directory
mkdir -p ssl

# Generate private key
openssl genrsa -out ssl/server.key 2048

# Generate certificate signing request
openssl req -new -key ssl/server.key -out ssl/server.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=mainbrain"

# Generate self-signed certificate (valid for 365 days)
openssl x509 -req -in ssl/server.csr -signkey ssl/server.key -out ssl/server.crt -days 365

echo "✅ SSL certificate generated for 'mainbrain'"
echo "📁 Files created:"
echo "   - ssl/server.key (private key)"
echo "   - ssl/server.crt (certificate)"
echo ""
echo "🌐 To use HTTPS:"
echo "   1. Update docker-compose.yml to expose port 8443"
echo "   2. Configure Go server to serve HTTPS"
echo "   3. Access via https://mainbrain:8443/"
echo ""
echo "⚠️  Browser will show security warning - click 'Advanced' -> 'Proceed to mainbrain'"
