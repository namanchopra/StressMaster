#!/bin/bash

# Script to push changes to both company and personal repositories
# Usage: ./scripts/push-to-both.sh [commit_message]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🚀 Pushing to both repositories...${NC}"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Not in a git repository${NC}"
    exit 1
fi

# Check if there are changes to commit
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${YELLOW}📝 Changes detected, committing...${NC}"
    
    # Use provided commit message or default
    COMMIT_MSG="${1:-$(date '+%Y-%m-%d %H:%M:%S') - Auto commit}"
    
    git add .
    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}✅ Changes committed: $COMMIT_MSG${NC}"
else
    echo -e "${GREEN}✅ No changes to commit${NC}"
fi

# Push to company repository (origin)
echo -e "${YELLOW}📤 Pushing to company repository (mumzworld-tech/StressMaster)...${NC}"
if git push origin main; then
    echo -e "${GREEN}✅ Successfully pushed to company repository${NC}"
else
    echo -e "${RED}❌ Failed to push to company repository${NC}"
    exit 1
fi

# Push to personal repository
echo -e "${YELLOW}📤 Pushing to personal repository (namanchopra/StressMaster)...${NC}"
if git push personal main; then
    echo -e "${GREEN}✅ Successfully pushed to personal repository${NC}"
else
    echo -e "${RED}❌ Failed to push to personal repository${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 Successfully pushed to both repositories!${NC}"
echo -e "${YELLOW}Company: https://github.com/mumzworld-tech/StressMaster${NC}"
echo -e "${YELLOW}Personal: https://github.com/namanchopra/StressMaster${NC}" 