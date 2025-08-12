# Docker Setup for StressMaster

This document provides instructions for running StressMaster using Docker containers.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB of available RAM (for Ollama model)
- At least 10GB of free disk space

## Quick Start

1. **Build and start all services:**

   ```bash
   docker-compose up --build
   ```

2. **Initialize the AI model (first time only):**

   ```bash
   docker-compose --profile init up model-init
   ```

3. **Access the application:**
   - Main application: http://localhost:3000
   - Ollama API: http://localhost:11434

## Services Overview

### Main Application (`ai-load-tester`)

- **Purpose**: Core application with CLI interface and orchestration logic
- **Port**: 3000
- **Health Check**: `/health` endpoint
- **Dependencies**: Ollama service

### Ollama Service (`ollama`)

- **Purpose**: AI model hosting for natural language processing
- **Port**: 11434
- **Model**: LLaMA3 (downloaded on first run)
- **Storage**: Persistent volume for model data

### K6 Runner (`k6-runner`)

- **Purpose**: Load test script execution
- **Usage**: On-demand container for running generated K6 scripts
- **Profile**: `k6-execution` (not started by default)

### Model Initialization (`model-init`)

- **Purpose**: Downloads and configures the LLaMA3 model
- **Usage**: Run once during initial setup
- **Profile**: `init`

## Volume Management

### Persistent Volumes

- `ollama_data`: Stores downloaded AI models
- `shared_data`: Application data and configuration
- `k6_scripts`: Generated K6 test scripts
- `test_results`: Load test execution results

### Volume Locations

```
/var/lib/docker/volumes/ai-load-tester_ollama_data
/var/lib/docker/volumes/ai-load-tester_shared_data
/var/lib/docker/volumes/ai-load-tester_k6_scripts
/var/lib/docker/volumes/ai-load-tester_test_results
```

## Common Commands

### Development

```bash
# Start services in development mode
docker-compose up --build

# View logs
docker-compose logs -f ai-load-tester
docker-compose logs -f ollama

# Restart a specific service
docker-compose restart ai-load-tester
```

### Production

```bash
# Start services in detached mode
docker-compose up -d --build

# Check service status
docker-compose ps

# Stop all services
docker-compose down
```

### Model Management

```bash
# Initialize model (first time setup)
docker-compose --profile init up model-init

# Check available models
docker exec ai-load-tester-ollama ollama list

# Pull a specific model
docker exec ai-load-tester-ollama ollama pull llama3
```

### K6 Execution

```bash
# Run K6 tests (when scripts are available)
docker-compose --profile k6-execution up k6-runner

# Execute specific K6 script
docker run --rm -v ai-load-tester_k6_scripts:/scripts \
  -v ai-load-tester_test_results:/results \
  grafana/k6:latest run /scripts/test-script.js
```

## Environment Variables

### Main Application

- `NODE_ENV`: Application environment (production/development)
- `OLLAMA_URL`: Ollama service URL (default: http://ollama:11434)
- `DATA_DIR`: Data directory path (default: /app/data)
- `SCRIPTS_DIR`: K6 scripts directory (default: /app/scripts/k6)
- `RESULTS_DIR`: Test results directory (default: /app/results)

### Ollama Service

- `OLLAMA_HOST`: Host binding (default: 0.0.0.0)
- `OLLAMA_ORIGINS`: CORS origins (default: \*)

### K6 Runner

- `K6_OUT`: Output format and location

## Health Checks

All services include health checks:

- **ai-load-tester**: HTTP endpoint check on port 3000
- **ollama**: API tags endpoint check on port 11434
- **Automatic restarts**: Services restart automatically on failure

## Troubleshooting

### Common Issues

1. **Ollama model not downloading:**

   ```bash
   # Check Ollama logs
   docker-compose logs ollama

   # Manually initialize model
   docker-compose --profile init up model-init
   ```

2. **Application not starting:**

   ```bash
   # Check application logs
   docker-compose logs ai-load-tester

   # Verify Ollama is running
   curl http://localhost:11434/api/tags
   ```

3. **Permission issues:**

   ```bash
   # Fix volume permissions
   docker-compose down
   docker volume rm ai-load-tester_shared_data
   docker-compose up --build
   ```

4. **Out of disk space:**
   ```bash
   # Clean up Docker resources
   docker system prune -a
   docker volume prune
   ```

### Resource Requirements

- **Minimum RAM**: 4GB (2GB for Ollama + 1GB for application + 1GB system)
- **Recommended RAM**: 8GB or more
- **Disk Space**: 10GB (5GB for model + 5GB for containers and data)
- **CPU**: 2+ cores recommended

### Performance Tuning

1. **Increase Ollama memory:**

   ```yaml
   # In docker-compose.yml
   ollama:
     deploy:
       resources:
         limits:
           memory: 4G
   ```

2. **Optimize Docker settings:**
   - Increase Docker Desktop memory allocation
   - Enable Docker BuildKit for faster builds
   - Use SSD storage for better I/O performance

## Security Considerations

- Application runs as non-root user (nodejs:1001)
- Network isolation using custom bridge network
- Read-only script mounts where possible
- Health checks prevent unhealthy containers from receiving traffic

## Backup and Recovery

### Backup Important Data

```bash
# Backup Ollama models
docker run --rm -v ai-load-tester_ollama_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/ollama-models.tar.gz -C /data .

# Backup application data
docker run --rm -v ai-load-tester_shared_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/app-data.tar.gz -C /data .
```

### Restore Data

```bash
# Restore Ollama models
docker run --rm -v ai-load-tester_ollama_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/ollama-models.tar.gz -C /data

# Restore application data
docker run --rm -v ai-load-tester_shared_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/app-data.tar.gz -C /data
```
