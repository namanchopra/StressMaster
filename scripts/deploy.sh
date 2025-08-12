#!/bin/bash

# Deployment script for StressMaster
# This script handles the complete deployment process including environment setup

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
COMPOSE_OVERRIDE_FILE="${PROJECT_DIR}/docker-compose.override.yml"

# Default configuration
DEFAULT_OLLAMA_PORT=11434
DEFAULT_APP_PORT=3000
DEFAULT_MODEL_NAME="llama3"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker >/dev/null 2>&1; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Function to create environment file
create_env_file() {
    print_status "Creating environment configuration..."
    
    if [ -f "$ENV_FILE" ]; then
        print_warning "Environment file already exists. Creating backup..."
        cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    cat > "$ENV_FILE" << EOF
# StressMaster Environment Configuration
# Generated on $(date)

# Application Configuration
NODE_ENV=production
APP_PORT=${DEFAULT_APP_PORT}

# Ollama Configuration
OLLAMA_PORT=${DEFAULT_OLLAMA_PORT}
OLLAMA_HOST=0.0.0.0
OLLAMA_ORIGINS=*
MODEL_NAME=${DEFAULT_MODEL_NAME}

# K6 Configuration
K6_RUNNER_IMAGE=grafana/k6:latest

# Directory Configuration
DATA_DIR=/app/data
SCRIPTS_DIR=/app/scripts/k6
RESULTS_DIR=/app/results

# Docker Configuration
COMPOSE_PROJECT_NAME=stressmaster
RESTART_POLICY=unless-stopped

# Resource Limits
OLLAMA_MEMORY_LIMIT=4g
APP_MEMORY_LIMIT=1g
K6_MEMORY_LIMIT=2g

# Logging Configuration
LOG_LEVEL=info
LOG_FORMAT=json
EOF
    
    print_success "Environment file created at $ENV_FILE"
}

# Function to create production override file
create_production_override() {
    print_status "Creating production configuration override..."
    
    cat > "$COMPOSE_OVERRIDE_FILE" << EOF
# Production overrides for StressMaster
version: '3.8'

services:
  ollama:
    deploy:
      resources:
        limits:
          memory: \${OLLAMA_MEMORY_LIMIT:-4g}
        reservations:
          memory: 2g
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  stressmaster:
    deploy:
      resources:
        limits:
          memory: \${APP_MEMORY_LIMIT:-1g}
        reservations:
          memory: 512m
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  k6-runner:
    deploy:
      resources:
        limits:
          memory: \${K6_MEMORY_LIMIT:-2g}
        reservations:
          memory: 512m
EOF
    
    print_success "Production override file created"
}

# Function to build images
build_images() {
    print_status "Building Docker images..."
    
    cd "$PROJECT_DIR"
    
    # Build the main application image
    docker-compose build --no-cache stressmaster
    
    print_success "Docker images built successfully"
}

# Function to initialize volumes
init_volumes() {
    print_status "Initializing Docker volumes..."
    
    # Create volumes if they don't exist
    docker volume create stressmaster_ollama_data || true
    docker volume create stressmaster_shared_data || true
    docker volume create stressmaster_k6_scripts || true
    docker volume create stressmaster_test_results || true
    
    print_success "Docker volumes initialized"
}

# Function to start services
start_services() {
    print_status "Starting services..."
    
    cd "$PROJECT_DIR"
    
    # Start Ollama first
    print_status "Starting Ollama service..."
    docker-compose up -d ollama
    
    # Wait for Ollama to be healthy
    print_status "Waiting for Ollama to be ready..."
    local max_wait=300  # 5 minutes
    local wait_time=0
    local check_interval=10
    
    while [ $wait_time -lt $max_wait ]; do
        if docker-compose exec -T ollama curl -f -s http://localhost:11434/api/tags >/dev/null 2>&1; then
            print_success "Ollama is ready"
            break
        fi
        
        print_status "Waiting for Ollama... (${wait_time}s/${max_wait}s)"
        sleep $check_interval
        wait_time=$((wait_time + check_interval))
    done
    
    if [ $wait_time -ge $max_wait ]; then
        print_warning "Ollama took longer than expected to start, continuing anyway..."
    fi
    
    # Initialize model
    print_status "Initializing AI model..."
    docker-compose --profile init up model-init
    
    # Start main application
    print_status "Starting main application..."
    docker-compose up -d stressmaster
    
    print_success "All services started successfully"
}

# Function to verify deployment
verify_deployment() {
    print_status "Verifying deployment..."
    
    cd "$PROJECT_DIR"
    
    # Check service status
    local services=("ollama" "stressmaster")
    local all_healthy=true
    
    for service in "${services[@]}"; do
        if docker-compose ps "$service" | grep -q "Up"; then
            print_success "$service is running"
        else
            print_error "$service is not running"
            all_healthy=false
        fi
    done
    
    # Check health endpoints
    sleep 10  # Give services time to fully start
    
    # Check Ollama health
    if curl -f -s "http://localhost:${DEFAULT_OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
        print_success "Ollama API is responding"
    else
        print_warning "Ollama API is not responding"
        all_healthy=false
    fi
    
    # Check main application health
    if curl -f -s "http://localhost:${DEFAULT_APP_PORT}/health" >/dev/null 2>&1; then
        print_success "Main application is responding"
    else
        print_warning "Main application is not responding yet (may still be starting)"
    fi
    
    if [ "$all_healthy" = true ]; then
        print_success "Deployment verification completed successfully"
        return 0
    else
        print_warning "Some services may not be fully ready yet"
        return 1
    fi
}

# Function to show deployment status
show_status() {
    print_status "Deployment Status:"
    echo ""
    
    cd "$PROJECT_DIR"
    docker-compose ps
    
    echo ""
    print_status "Service URLs:"
    echo "  - Main Application: http://localhost:${DEFAULT_APP_PORT}"
    echo "  - Ollama API: http://localhost:${DEFAULT_OLLAMA_PORT}"
    echo ""
    
    print_status "Useful Commands:"
    echo "  - View logs: docker-compose logs -f"
    echo "  - Stop services: docker-compose down"
    echo "  - Restart services: docker-compose restart"
    echo "  - Update services: $0 --update"
}

# Function to handle updates
update_deployment() {
    print_status "Updating deployment..."
    
    cd "$PROJECT_DIR"
    
    # Pull latest images
    docker-compose pull
    
    # Rebuild application image
    docker-compose build --no-cache stressmaster
    
    # Restart services
    docker-compose up -d --force-recreate
    
    print_success "Deployment updated successfully"
}

# Function to clean up deployment
cleanup_deployment() {
    print_status "Cleaning up deployment..."
    
    cd "$PROJECT_DIR"
    
    # Stop and remove containers
    docker-compose down -v
    
    # Remove images (optional)
    if [ "$1" = "--remove-images" ]; then
        docker-compose down --rmi all
        print_success "Images removed"
    fi
    
    # Remove volumes (optional)
    if [ "$1" = "--remove-volumes" ]; then
        docker volume rm stressmaster_ollama_data || true
        docker volume rm stressmaster_shared_data || true
        docker volume rm stressmaster_k6_scripts || true
        docker volume rm stressmaster_test_results || true
        print_success "Volumes removed"
    fi
    
    print_success "Cleanup completed"
}

# Function to show help
show_help() {
    echo "StressMaster Deployment Script"
    echo ""
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  --deploy, -d      Deploy the application (default)"
    echo "  --update, -u      Update existing deployment"
    echo "  --status, -s      Show deployment status"
    echo "  --stop            Stop all services"
    echo "  --cleanup         Clean up deployment"
    echo "  --cleanup-all     Clean up deployment including images and volumes"
    echo "  --help, -h        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                Deploy the application"
    echo "  $0 --update       Update the deployment"
    echo "  $0 --status       Check deployment status"
}

# Main deployment function
deploy() {
    print_status "Starting StressMaster deployment..."
    
    check_prerequisites
    create_env_file
    create_production_override
    init_volumes
    build_images
    start_services
    
    # Wait a bit for services to fully start
    sleep 15
    
    if verify_deployment; then
        print_success "Deployment completed successfully!"
        show_status
    else
        print_warning "Deployment completed with warnings. Check service logs for details."
        show_status
    fi
}

# Parse command line arguments
case "${1:-}" in
    --deploy|-d|"")
        deploy
        ;;
    --update|-u)
        update_deployment
        ;;
    --status|-s)
        show_status
        ;;
    --stop)
        cd "$PROJECT_DIR"
        docker-compose down
        print_success "Services stopped"
        ;;
    --cleanup)
        cleanup_deployment
        ;;
    --cleanup-all)
        cleanup_deployment --remove-volumes
        ;;
    --help|-h)
        show_help
        ;;
    *)
        print_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac