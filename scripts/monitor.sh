#!/bin/bash

# Monitoring and maintenance script for StressMaster
# This script provides monitoring, logging, and maintenance capabilities

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_DIR}/logs"
BACKUP_DIR="${PROJECT_DIR}/backups"

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

# Function to check service health
check_service_health() {
    local service_name="$1"
    local health_url="$2"
    
    print_status "Checking health of $service_name..."
    
    if curl -f -s --max-time 10 "$health_url" >/dev/null 2>&1; then
        print_success "$service_name is healthy"
        return 0
    else
        print_error "$service_name is not responding"
        return 1
    fi
}

# Function to check container status
check_containers() {
    print_status "Checking container status..."
    
    cd "$PROJECT_DIR"
    
    local containers=("stressmaster-ollama" "stressmaster-app")
    local all_running=true
    
    for container in "${containers[@]}"; do
        if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "$container.*Up"; then
            print_success "$container is running"
        else
            print_error "$container is not running"
            all_running=false
        fi
    done
    
    return $all_running
}

# Function to check resource usage
check_resources() {
    print_status "Checking resource usage..."
    
    cd "$PROJECT_DIR"
    
    # Get container resource usage
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" \
        stressmaster-ollama stressmaster-app 2>/dev/null || {
        print_warning "Could not retrieve container stats"
        return 1
    }
    
    # Check disk usage for volumes
    print_status "Volume disk usage:"
    docker system df -v | grep "stressmaster" || true
}

# Function to collect logs
collect_logs() {
    local output_dir="${1:-$LOG_DIR}"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    
    print_status "Collecting logs to $output_dir..."
    
    mkdir -p "$output_dir"
    
    cd "$PROJECT_DIR"
    
    # Collect container logs
    local services=("ollama" "stressmaster")
    
    for service in "${services[@]}"; do
        local log_file="$output_dir/${service}_${timestamp}.log"
        print_status "Collecting logs for $service..."
        
        docker-compose logs --no-color --timestamps "$service" > "$log_file" 2>&1 || {
            print_warning "Could not collect logs for $service"
        }
    done
    
    # Collect system information
    local system_info_file="$output_dir/system_info_${timestamp}.txt"
    {
        echo "=== System Information ==="
        echo "Date: $(date)"
        echo "Docker version: $(docker --version)"
        echo "Docker Compose version: $(docker-compose --version 2>/dev/null || docker compose version)"
        echo ""
        echo "=== Container Status ==="
        docker-compose ps
        echo ""
        echo "=== Resource Usage ==="
        docker stats --no-stream
        echo ""
        echo "=== Volume Information ==="
        docker volume ls | grep stressmaster
        echo ""
        echo "=== Network Information ==="
        docker network ls | grep stressmaster
    } > "$system_info_file"
    
    print_success "Logs collected in $output_dir"
}

# Function to backup data
backup_data() {
    local backup_name="stressmaster-backup-$(date +%Y%m%d_%H%M%S)"
    local backup_path="$BACKUP_DIR/$backup_name"
    
    print_status "Creating backup: $backup_name"
    
    mkdir -p "$backup_path"
    
    cd "$PROJECT_DIR"
    
    # Backup volumes
    print_status "Backing up Docker volumes..."
    
    local volumes=("stressmaster_ollama_data" "stressmaster_shared_data" "stressmaster_test_results")
    
    for volume in "${volumes[@]}"; do
        local volume_backup="$backup_path/${volume}.tar.gz"
        print_status "Backing up volume: $volume"
        
        docker run --rm \
            -v "$volume:/data:ro" \
            -v "$backup_path:/backup" \
            alpine:latest \
            tar czf "/backup/$(basename "$volume_backup")" -C /data . || {
            print_warning "Could not backup volume: $volume"
        }
    done
    
    # Backup configuration files
    print_status "Backing up configuration files..."
    cp -r .env* docker-compose*.yml "$backup_path/" 2>/dev/null || true
    
    # Create backup manifest
    {
        echo "StressMaster Backup Manifest"
        echo "Created: $(date)"
        echo "Backup Path: $backup_path"
        echo ""
        echo "Contents:"
        ls -la "$backup_path"
    } > "$backup_path/MANIFEST.txt"
    
    print_success "Backup created: $backup_path"
}

# Function to restore from backup
restore_backup() {
    local backup_path="$1"
    
    if [ -z "$backup_path" ] || [ ! -d "$backup_path" ]; then
        print_error "Invalid backup path: $backup_path"
        return 1
    fi
    
    print_warning "This will restore data from backup and may overwrite current data."
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Restore cancelled"
        return 0
    fi
    
    print_status "Restoring from backup: $backup_path"
    
    cd "$PROJECT_DIR"
    
    # Stop services
    print_status "Stopping services..."
    docker-compose down
    
    # Restore volumes
    local volumes=("stressmaster_ollama_data" "stressmaster_shared_data" "stressmaster_test_results")
    
    for volume in "${volumes[@]}"; do
        local volume_backup="$backup_path/${volume}.tar.gz"
        
        if [ -f "$volume_backup" ]; then
            print_status "Restoring volume: $volume"
            
            # Remove existing volume
            docker volume rm "$volume" 2>/dev/null || true
            
            # Create new volume
            docker volume create "$volume"
            
            # Restore data
            docker run --rm \
                -v "$volume:/data" \
                -v "$backup_path:/backup:ro" \
                alpine:latest \
                tar xzf "/backup/$(basename "$volume_backup")" -C /data || {
                print_error "Could not restore volume: $volume"
            }
        else
            print_warning "Backup file not found: $volume_backup"
        fi
    done
    
    # Restore configuration files
    print_status "Restoring configuration files..."
    cp "$backup_path"/.env* "$backup_path"/docker-compose*.yml . 2>/dev/null || true
    
    # Restart services
    print_status "Restarting services..."
    docker-compose up -d
    
    print_success "Restore completed"
}

# Function to clean up old data
cleanup() {
    print_status "Cleaning up old data..."
    
    cd "$PROJECT_DIR"
    
    # Clean up old logs
    if [ -d "$LOG_DIR" ]; then
        find "$LOG_DIR" -name "*.log" -mtime +7 -delete 2>/dev/null || true
        print_status "Cleaned up old log files"
    fi
    
    # Clean up old backups (keep last 5)
    if [ -d "$BACKUP_DIR" ]; then
        ls -t "$BACKUP_DIR" | tail -n +6 | xargs -I {} rm -rf "$BACKUP_DIR/{}" 2>/dev/null || true
        print_status "Cleaned up old backup files"
    fi
    
    # Clean up Docker system
    docker system prune -f >/dev/null 2>&1 || true
    print_status "Cleaned up Docker system"
    
    print_success "Cleanup completed"
}

# Function to show system status
show_status() {
    print_status "StressMaster System Status"
    echo ""
    
    # Check containers
    check_containers
    echo ""
    
    # Check service health
    check_service_health "Ollama API" "http://localhost:11434/api/tags"
    check_service_health "Main Application" "http://localhost:3000/health"
    echo ""
    
    # Show resource usage
    check_resources
    echo ""
    
    # Show recent logs (last 10 lines)
    print_status "Recent log entries:"
    cd "$PROJECT_DIR"
    docker-compose logs --tail=10 --timestamps 2>/dev/null || true
}

# Function to restart services
restart_services() {
    print_status "Restarting StressMaster services..."
    
    cd "$PROJECT_DIR"
    
    # Restart services
    docker-compose restart
    
    # Wait for services to be ready
    sleep 10
    
    # Check health
    if check_service_health "Ollama API" "http://localhost:11434/api/tags" && \
       check_service_health "Main Application" "http://localhost:3000/health"; then
        print_success "Services restarted successfully"
    else
        print_warning "Services restarted but may not be fully ready yet"
    fi
}

# Function to show help
show_help() {
    echo "StressMaster Monitoring and Maintenance Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  status          Show system status and health"
    echo "  logs [DIR]      Collect logs to specified directory (default: ./logs)"
    echo "  backup          Create a backup of data and configuration"
    echo "  restore PATH    Restore from backup at specified path"
    echo "  cleanup         Clean up old logs, backups, and Docker data"
    echo "  restart         Restart all services"
    echo "  monitor         Continuous monitoring (runs status every 30 seconds)"
    echo "  help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 status                    Check system status"
    echo "  $0 logs /tmp/ai-logs         Collect logs to /tmp/ai-logs"
    echo "  $0 backup                    Create a backup"
    echo "  $0 restore ./backups/backup1 Restore from backup"
}

# Function for continuous monitoring
continuous_monitor() {
    print_status "Starting continuous monitoring (Press Ctrl+C to stop)..."
    
    while true; do
        clear
        echo "=== StressMaster Continuous Monitor ==="
        echo "Last updated: $(date)"
        echo ""
        
        show_status
        
        echo ""
        print_status "Next update in 30 seconds..."
        sleep 30
    done
}

# Main function
main() {
    case "${1:-status}" in
        status)
            show_status
            ;;
        logs)
            collect_logs "$2"
            ;;
        backup)
            backup_data
            ;;
        restore)
            if [ -z "$2" ]; then
                print_error "Please specify backup path"
                echo "Usage: $0 restore <backup_path>"
                exit 1
            fi
            restore_backup "$2"
            ;;
        cleanup)
            cleanup
            ;;
        restart)
            restart_services
            ;;
        monitor)
            continuous_monitor
            ;;
        help)
            show_help
            ;;
        *)
            print_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

# Handle script termination
cleanup_on_exit() {
    print_status "Monitoring stopped"
    exit 0
}

trap cleanup_on_exit SIGINT SIGTERM

# Execute main function
main "$@"