# StressMaster

A local-first AI-powered load testing tool that accepts natural language commands to perform API load testing. The system uses a local LLM (LLaMA3 via Ollama) to parse user prompts and convert them into structured load test specifications that can be executed using K6.

## 🚀 Features

- **Natural Language Interface**: Describe load tests in plain English
- **Local AI Processing**: Uses LLaMA3 model running locally via Ollama
- **Multiple Test Types**: Spike, stress, endurance, volume, and baseline testing
- **K6 Integration**: Generates and executes K6 scripts automatically
- **Real-time Monitoring**: Live progress tracking and metrics
- **Comprehensive Reporting**: Detailed analysis with AI-powered recommendations
- **Docker-based**: Fully containerized for easy deployment
- **No Cloud Dependencies**: Runs entirely on your local machine

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Input    │───▶│   AI Parser      │───▶│  K6 Generator   │
│ (Natural Lang.) │    │ (LLaMA3/Ollama)  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Results &     │◀───│  Test Executor   │◀───│  Load Test      │
│ Recommendations │    │     (K6)         │    │  Orchestrator   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📋 Prerequisites

- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **System Memory**: Minimum 8GB RAM (16GB recommended)
- **Storage**: Minimum 20GB free space
- **Network**: Internet access for initial setup

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
git clone <repository-url>
cd stressmaster

# Copy environment configuration
cp .env.example .env

# Deploy the application
./scripts/deploy.sh
```

The deployment process will:

- Build Docker images
- Download the LLaMA3 model
- Start all services
- Verify the installation

### 2. First Load Test

Once deployed, you can start using the tool:

```bash
# Access the interactive CLI
docker-compose exec stressmaster npm start

# Or use the web interface
open http://localhost:3000
```

Try your first load test:

```
Send 100 GET requests to https://httpbin.org/get over 30 seconds
```

## 💡 Usage Examples

### Basic Load Tests

#### Simple GET Request Test

```
Test https://api.example.com/users with 50 requests per second for 2 minutes
```

#### POST Request with Payload

```
Send 200 POST requests to https://api.example.com/orders with random order data
```

#### Spike Testing

```
Perform a spike test on https://api.example.com/products with 1000 requests in 10 seconds
```

### Advanced Scenarios

#### Multi-step Workflow

```
Create a user workflow test:
1. POST login to https://api.example.com/auth with credentials
2. GET user profile using the auth token
3. POST create order with random product data
4. GET order status
Run this for 100 virtual users over 5 minutes
```

#### Stress Testing with Ramp-up

```
Stress test https://api.example.com/search starting with 10 users,
ramping up to 500 users over 10 minutes, then maintain for 20 minutes
```

#### Endurance Testing

```
Run endurance test on https://api.example.com/health with 50 constant users for 2 hours
```

### Load Pattern Examples

#### Constant Load

```
Maintain 100 requests per second to https://api.example.com/data for 10 minutes
```

#### Ramp-up Pattern

```
Start with 10 RPS, increase to 200 RPS over 5 minutes, then maintain for 15 minutes
```

#### Step Pattern

```
Load test in steps: 50 users for 2 minutes, then 100 users for 2 minutes, then 200 users for 2 minutes
```

## 🔧 Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Application settings
NODE_ENV=production
APP_PORT=3000

# Ollama/AI settings
OLLAMA_PORT=11434
MODEL_NAME=llama3

# Resource limits
OLLAMA_MEMORY_LIMIT=4g
APP_MEMORY_LIMIT=1g
K6_MEMORY_LIMIT=2g
```

### Custom Payloads

The AI can generate various payload types:

- **Random IDs**: `{randomId}`, `{uuid}`
- **Timestamps**: `{timestamp}`, `{isoDate}`
- **Random Data**: `{randomString}`, `{randomNumber}`
- **Sequential Data**: `{sequence}`, `{counter}`

Example:

```
POST to https://api.example.com/users with payload:
{
  "id": "{uuid}",
  "name": "{randomString}",
  "email": "user{sequence}@example.com",
  "timestamp": "{isoDate}"
}
```

## 📊 Understanding Results

### Performance Metrics

The tool provides comprehensive metrics:

- **Response Times**: Min, max, average, and percentiles (50th, 90th, 95th, 99th)
- **Throughput**: Requests per second and bytes per second
- **Error Rates**: Success/failure ratios and error categorization
- **Resource Usage**: CPU and memory consumption during tests

### AI-Powered Recommendations

After each test, the AI analyzes results and provides:

- Performance bottleneck identification
- Optimization suggestions
- Capacity planning recommendations
- Error pattern analysis

### Export Formats

Results can be exported in multiple formats:

- **JSON**: Raw data for programmatic analysis
- **CSV**: Spreadsheet-compatible format
- **HTML**: Rich visual reports with charts

## 🛠️ Advanced Usage

### Custom Test Scenarios

#### Authentication Testing

```
Test API with JWT authentication:
1. POST login to get token
2. Use token for subsequent requests
3. Test 500 authenticated requests per minute
```

#### Database Load Testing

```
Test database performance through API:
- Create 1000 records with POST requests
- Read records with GET requests at 200 RPS
- Update 50% of records with PUT requests
- Delete 10% of records with DELETE requests
```

#### Microservices Testing

```
Test microservice chain:
1. POST to user-service to create user
2. POST to order-service with user ID
3. GET from inventory-service for stock check
4. POST to payment-service for processing
Run 100 complete workflows concurrently
```

### Performance Tuning

#### For High-Volume Testing

```bash
# Increase resource limits
OLLAMA_MEMORY_LIMIT=8g
APP_MEMORY_LIMIT=2g
K6_MEMORY_LIMIT=4g

# Restart services
docker-compose down && docker-compose up -d
```

#### For Long-Duration Tests

```bash
# Enable persistent storage
docker volume create stressmaster-results

# Monitor resources
./scripts/monitor.sh monitor
```

## 🔍 Monitoring and Troubleshooting

### Health Checks

Check system status:

```bash
# Quick status check
./scripts/monitor.sh status

# Continuous monitoring
./scripts/monitor.sh monitor

# Detailed health check
curl http://localhost:3000/health
curl http://localhost:11434/api/tags
```

### Log Analysis

Collect and analyze logs:

```bash
# Collect all logs
./scripts/monitor.sh logs

# View real-time logs
docker-compose logs -f

# Filter specific service logs
docker-compose logs -f stressmaster
docker-compose logs -f ollama
```

### Common Issues and Solutions

#### AI Model Not Responding

```bash
# Check Ollama service
docker-compose logs ollama

# Restart Ollama
docker-compose restart ollama

# Reinitialize model
docker-compose --profile init up model-init
```

#### High Memory Usage

```bash
# Check resource usage
docker stats

# Reduce memory limits
echo "OLLAMA_MEMORY_LIMIT=2g" >> .env
docker-compose restart
```

#### Test Execution Failures

```bash
# Check K6 logs
docker-compose logs k6-runner

# Verify target API accessibility
curl -I https://your-target-api.com

# Check network connectivity
docker-compose exec stressmaster ping your-target-api.com
```

## 🔒 Security Considerations

### Network Security

- Services communicate via isolated Docker network
- Only necessary ports exposed to host
- Input validation on all API endpoints

### Data Security

- No data sent to external services
- Local model processing only
- Configurable data retention policies

### Container Security

- Non-root user execution
- Read-only file systems where possible
- Resource limits to prevent DoS

## 🚀 Deployment Options

### Development

```bash
# Quick development setup
docker-compose up -d
```

### Production

```bash
# Production deployment with monitoring
./scripts/deploy.sh
./scripts/monitor.sh monitor
```

### CI/CD Integration

```bash
# Automated testing in CI
docker-compose -f docker-compose.yml -f docker-compose.ci.yml up --abort-on-container-exit
```

## 📚 API Reference

### REST API Endpoints

- `POST /api/parse` - Parse natural language command
- `POST /api/execute` - Execute load test
- `GET /api/results/{id}` - Get test results
- `GET /api/history` - Get test history
- `GET /health` - Health check endpoint

### WebSocket API

- `/ws/progress` - Real-time test progress updates
- `/ws/metrics` - Live performance metrics
- `/ws/logs` - Streaming log output

## 🤝 Contributing

### Development Setup

```bash
# Clone repository
git clone <repository-url>
cd stressmaster

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test
```

### Code Structure

```
src/
├── cli/           # Command-line interface
├── parser/        # AI command parsing
├── generator/     # K6 script generation
├── executor/      # Test execution
├── orchestrator/  # Workflow coordination
├── analyzer/      # Results analysis
└── types/         # TypeScript definitions
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Getting Help

1. Check the [troubleshooting guide](#-monitoring-and-troubleshooting)
2. Review [deployment documentation](DEPLOYMENT.md)
3. Search existing issues
4. Create a new issue with:
   - System information
   - Error logs
   - Steps to reproduce

### Useful Commands

```bash
# System diagnostics
./scripts/monitor.sh status

# Collect logs for support
./scripts/monitor.sh logs /tmp/support-logs

# Create system backup
./scripts/monitor.sh backup

# Reset to clean state
docker-compose down -v
./scripts/deploy.sh
```

---

\*\*Happy Load Tes
