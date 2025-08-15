# CS1.6 Game Server

Counter-Strike 1.6 dedicated server using the timoxo/cs1.6 Docker image.

## Setup

### Option 1: Using Environment Variables (Recommended)

1. **Set up your environment:**
   ```bash
   # Edit the environment file in the parent directory
   nano ../.env.local
   # Set RCON_PASSWORD=your_secure_password_here
   # Set CS_SERVER_HOST=mainbrain (or your hostname)
   ```

2. **Run the setup script:**
   ```bash
   ./setup.sh
   ```

3. **Start the server:**
   ```bash
   docker-compose up -d
   ```

### Option 2: Manual Configuration

1. **Create server configuration:**
   ```bash
   cp server.cfg.template server.cfg
   ```

2. **Edit your RCON password:**
   ```bash
   nano server.cfg
   # Change: rcon_password "REPLACE_WITH_YOUR_PASSWORD"
   # To:     rcon_password "your_secure_password_here"
   ```

3. **Start the server:**
   ```bash
   docker-compose up -d
   ```

## Configuration

- **Host Port**: `27015/udp`
- **Container**: `cs-server`
- **Image**: `timoxo/cs1.6:1.9.0817`
- **Default Map**: `cs_747`
- **Max Players**: `8`

## Security Note

- `server.cfg` is ignored by git for security
- Always use `server.cfg.template` as your starting point
- Never commit your actual RCON password
