#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Hindi Voice Agent...${NC}"

# Load env vars
source .env

# Check if ngrok URL is set
if [[ "$SERVER_HOST" == "localhost"* ]]; then
    echo -e "${YELLOW}WARNING: SERVER_HOST is set to localhost.${NC}"
    echo "Please update .env with your ngrok URL first:"
    echo "  1. Run: ngrok http 3000"
    echo "  2. Copy the URL (e.g., abc123.ngrok-free.app)"
    echo "  3. Update SERVER_HOST in .env"
    echo ""
fi

# Update Plivo webhook
echo -e "${GREEN}Updating Plivo webhook to: https://${SERVER_HOST}/incoming-call${NC}"
curl -s -X POST --user "${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"answer_url\": \"https://${SERVER_HOST}/incoming-call\", \"answer_method\": \"POST\"}" \
  "https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Number/912268093678/" > /dev/null

echo -e "${GREEN}Webhook configured!${NC}"
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Call +91 22 6809 3678 to test your voice agent!          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Start the server
npx tsx src/index.ts
