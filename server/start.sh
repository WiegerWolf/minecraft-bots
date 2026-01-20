#!/bin/bash
# Start Paper server for simulation testing
# Automatically runs setup if needed

set -e
cd "$(dirname "$0")"

INSTANCE_DIR="instance"

# Run setup if instance doesn't exist or paper.jar is missing
if [ ! -f "$INSTANCE_DIR/paper.jar" ]; then
    echo "Instance not found, running setup..."
    ./setup.sh
fi

# Start server
cd "$INSTANCE_DIR"
echo ""
echo "Starting Paper server..."
echo "  Port: 25566"
echo "  RCON: 25575 (password: simulation)"
echo ""
exec java -Xms512M -Xmx1G -jar paper.jar --nogui
