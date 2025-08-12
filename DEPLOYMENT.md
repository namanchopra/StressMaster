# StressMaster Deployment Guide

This document provides comprehensive instructions for deploying StressMaster in production environments.

## Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, or Windows with WSL2
- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **Memory**: Minimum 8GB RAM (16GB recommended)
- **Storage**: Minimum 20GB free space
- **CPU**: 4+ cores recommended

### Network Requirements

- Internet access for initial model download
- Ports 3000 and 11434 available (or configure alternatives)
- Access to target APIs for load testing

## Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd stressmaster
cp .env.example .env
```

### 2. Configure Environment

Edit the `.env` file to match your environment:

```bash
# Basic configuration
NODE_ENV=production
APP_PORT=3000
OLLAMA_PORT=11434

# Resource limits (adjust based on your system)
OLLAMA_MEMORY_LIMIT=4g
APP_MEMORY_LIMIT=1g
K6_MEMORY_LIMIT=2g
```

### 3. Deploy

```bash
./scripts/deploy.sh
```

The deployment script will:

- Check prerequisites
- Build Docker images
- Initialize volumes
- Start services
- Download and configure the AI model
- Verify deployment

## Manual Deployment

### 1. Build Images

```bash
# Build the main application image
docker-compose build stressmaster
```

### 2. Start Services

```bash
# Start Ollama service first
docker-compose up -d ollama

# Wait for Ollama to be ready
docker-compose logs -f ollama

# Initialize the AI model
docker-compose --profile init up model-init

# Start the main application
docker-compose up -d stressmaster
```

### 3. Verify Deployment

```bash
# Check service status
docker-compose ps

# Check health endpoints
curl http://localhost:11434/api/tags
curl http://localhost:3000/health

# View logs
docker-compose logs -f
```

## Production Configuration

### Environment Variables

| Variable              | Description              | Default          | Required |
| --------------------- | ------------------------ | ---------------- | -------- |
| `NODE_ENV`            | Application environment  | `production`     | Yes      |
| `APP_PORT`            | Application port         | `3000`           | No       |
| `OLLAMA_PORT`         | Ollama service port      | `11434`          | No       |
| `OLLAMA_MEMORY_LIMIT` | Memory limit for Ollama  | `4g`             | No       |
| `APP_MEMORY_LIMIT`    | Memory limit for app     | `1g`             | No       |
| `K6_MEMORY_LIMIT`     | Memory limit for K6      | `2g`             | No       |
| `RESTART_POLICY`      | Container restart policy | `unless-stopped` | No       |

### Resource Limits

The application includes resource limits to prevent system overload:

```yaml
# Ollama service
deploy:
  resources:
    limits:
      memory: 4g
      cpus: '2.0'
    reservations:
      memory: 2g
      cpus: '1.0'

# Main application
deploy:
  resources:
    limits:
      memory: 1g
      cpus: '1.0'
    reservations:
      memory: 512m
      cpus: '0.5'
```

### Health Checks

All services include comprehensive health checks:

- **Ollama**: API endpoint availability
- **Main App**: Application responsiveness and directory structure
- **Automatic Restart**: Services restart automatically on failure

### Logging Configuration

Production logging is configured with:

- JSON format for structured logging
- Log rotation (10MB max, 3 files)
- Centralized log collection support

## Security Considerations

### Container Security

- **Non-root User**: Application runs as `nodejs` user (UID 1001)
- **Read-only Volumes**: Scripts mounted as read-only
- **Resource Limits**: Prevents resource exhaustion attacks
- **Signal Handling**: Proper signal handling with dumb-init

### Network Security

- **Internal Network**: Services communicate via dedicated Docker network
- **Port Exposure**: Only necessary ports exposed to host
- **API Validation**: Input validation on all API endpoints

### Data Security

- **Volume Isolation**: Data stored in isolated Docker volumes
- **Backup Encryption**: Backup data can be encrypted at rest
- **Access Control**: File permissions properly configured

## Monitoring and Maintenance

### Health Monitoring

Use the monitoring script for ongoing maintenance:

```bash
# Check system status
./scripts/monitor.sh status

# Continuous monitoring
./scripts/monitor.sh monitor

# Collect logs
./scripts/monitor.sh logs

# Create backup
./scripts/monitor.sh backup

# Clean up old data
./scripts/monitor.sh cleanup
```

### Log Management

Logs are automatically rotated and can be collected:

```bash
# View real-time logs
docker-compose logs -f

# Collect logs for analysis
./scripts/monitor.sh logs /path/to/log/directory
```

### Backup and Restore

Regular backups are recommended:

```bash
# Create backup
./scripts/monitor.sh backup

# Restore from backup
./scripts/monitor.sh restore /path/to/backup
```

Backups include:

- Ollama model data
- Application data and configuration
- Test results and history
- Configuration files

## Scaling and Performance

### Vertical Scaling

Adjust resource limits in `.env`:

```bash
# For high-performance systems
OLLAMA_MEMORY_LIMIT=8g
APP_MEMORY_LIMIT=2g
K6_MEMORY_LIMIT=4g
```

### Horizontal Scaling

For multiple instances:

1. Use external load balancer
2. Shared storage for results
3. Separate Ollama instances per region

### Performance Tuning

- **Model Caching**: Models are cached after first download
- **Connection Pooling**: HTTP connections are pooled
- **Resource Monitoring**: Built-in resource usage monitoring

## Troubleshooting

### Common Issues

#### Ollama Service Not Starting

```bash
# Check logs
docker-compose logs ollama

# Restart service
docker-compose restart ollama

# Check available memory
free -h
```

#### Model Download Fails

```bash
# Check internet connectivity
curl -I https://ollama.ai

# Manually pull model
docker-compose exec ollama ollama pull llama3

# Check disk space
df -h
```

#### Application Not Responding

```bash
# Check health endpoint
curl http://localhost:3000/health

# Check application logs
docker-compose logs stressmaster

# Restart application
docker-compose restart stressmaster
```

#### High Memory Usage

```bash
# Check resource usage
docker stats

# Adjust memory limits in .env
OLLAMA_MEMORY_LIMIT=2g
APP_MEMORY_LIMIT=512m

# Restart with new limits
docker-compose down && docker-compose up -d
```

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
echo "LOG_LEVEL=debug" >> .env

# Restart services
docker-compose restart
```

### Performance Issues

Monitor performance:

```bash
# Check resource usage
./scripts/monitor.sh status

# View detailed stats
docker stats --no-stream

# Check for bottlenecks
docker-compose logs | grep -i error
```

## Updates and Maintenance

### Updating the Application

```bash
# Update deployment
./scripts/deploy.sh --update
```

### Updating Dependencies

```bash
# Rebuild images
docker-compose build --no-cache

# Restart services
docker-compose up -d --force-recreate
```

### Model Updates

```bash
# Update AI model
docker-compose --profile init up model-init --force-recreate
```

## Support and Documentation

### Getting Help

1. Check this deployment guide
2. Review application logs
3. Use the monitoring script for diagnostics
4. Check Docker and system resources

### Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Ollama Documentation](https://ollama.ai/docs)
- [K6 Documentation](https://k6.io/docs/)

### Reporting Issues

When reporting issues, include:

1. System information (`./scripts/monitor.sh status`)
2. Application logs (`./scripts/monitor.sh logs`)
3. Docker version and system specs
4. Steps to reproduce the issue
