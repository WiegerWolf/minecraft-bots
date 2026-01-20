#!/bin/bash
# Setup Paper server for simulation testing
# This script downloads Paper and prepares the instance folder

set -e
cd "$(dirname "$0")"

PAPER_VERSION="1.21.4"
INSTANCE_DIR="instance"

echo "=== Paper Server Setup ==="
echo ""

# Create instance directory
mkdir -p "$INSTANCE_DIR"
cd "$INSTANCE_DIR"

# Download Paper if not present
if [ ! -f "paper.jar" ]; then
    echo "Downloading Paper $PAPER_VERSION..."

    # Get latest build number
    BUILD=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/$PAPER_VERSION/builds" | grep -o '"build":[0-9]*' | head -1 | grep -o '[0-9]*')

    if [ -z "$BUILD" ]; then
        echo "Error: Could not fetch Paper build info"
        exit 1
    fi

    echo "Latest build: $BUILD"

    # Download
    curl -L -o paper.jar "https://api.papermc.io/v2/projects/paper/versions/$PAPER_VERSION/builds/$BUILD/downloads/paper-$PAPER_VERSION-$BUILD.jar"

    echo "Downloaded paper.jar"
else
    echo "paper.jar already exists, skipping download"
fi

# Copy config files
echo "Copying configuration files..."
cp -n ../config/server.properties . 2>/dev/null || cp ../config/server.properties .
cp -n ../config/bukkit.yml . 2>/dev/null || true
cp -n ../config/eula.txt . 2>/dev/null || cp ../config/eula.txt .

# Copy Paper configs if they exist
cp -n ../config/paper-global.yml . 2>/dev/null || true
cp -n ../config/paper-world-defaults.yml . 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo "Instance ready at: server/$INSTANCE_DIR/"
echo ""
echo "To start: cd server && ./start.sh"
echo "Or:       bun run server:start"
