#!/bin/bash

# Health check script for the main StressMaster application
# This script verifies that the application is running and responsive

set -e

# Configuration
HEALTH_ENDPOINT="http://localhost:3000/health"
TIMEOUT=5
MAX_RETRIES=3

# Function to check if the application is responsive
check_app_health() {
    local retry_count=0
    
    while [ $retry_count -lt $MAX_RETRIES ]; do
        if command -v curl >/dev/null 2>&1; then
            # Use curl if available
            if curl -f -s --max-time $TIMEOUT "$HEALTH_ENDPOINT" >/dev/null 2>&1; then
                echo "Health check passed: Application is responsive"
                return 0
            fi
        elif command -v wget >/dev/null 2>&1; then
            # Use wget as fallback
            if wget -q --timeout=$TIMEOUT --tries=1 -O /dev/null "$HEALTH_ENDPOINT" >/dev/null 2>&1; then
                echo "Health check passed: Application is responsive"
                return 0
            fi
        else
            # Fallback: check if the process is running
            if pgrep -f "node.*dist/index.js" >/dev/null 2>&1; then
                echo "Health check passed: Application process is running"
                return 0
            fi
        fi
        
        retry_count=$((retry_count + 1))
        echo "Health check attempt $retry_count failed, retrying..."
        sleep 2
    done
    
    echo "Health check failed: Application is not responsive after $MAX_RETRIES attempts"
    return 1
}

# Function to check required directories
check_directories() {
    local required_dirs=("/app/data" "/app/scripts/k6" "/app/results")
    
    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            echo "Health check failed: Required directory $dir does not exist"
            return 1
        fi
    done
    
    echo "Health check passed: All required directories exist"
    return 0
}

# Function to check environment variables
check_environment() {
    local required_vars=("OLLAMA_URL" "NODE_ENV")
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            echo "Health check failed: Required environment variable $var is not set"
            return 1
        fi
    done
    
    echo "Health check passed: All required environment variables are set"
    return 0
}

# Main health check execution
main() {
    echo "Starting health check for StressMaster application..."
    
    # Check environment variables
    if ! check_environment; then
        exit 1
    fi
    
    # Check required directories
    if ! check_directories; then
        exit 1
    fi
    
    # Check application responsiveness
    if ! check_app_health; then
        exit 1
    fi
    
    echo "All health checks passed successfully"
    exit 0
}

# Execute main function
main "$@"