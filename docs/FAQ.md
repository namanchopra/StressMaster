# Frequently Asked Questions (FAQ)

## General Questions

### What is StressMaster?

StressMaster is a local-first load testing tool that uses natural language processing to convert plain English commands into executable load tests. It runs entirely on your local machine using Docker containers and doesn't require any cloud services.

### How does it work?

1. You describe your load test in natural language (e.g., "Send 100 POST requests to my API")
2. The local AI model (LLaMA3 via Ollama) parses your command
3. The system generates a K6 script based on your requirements
4. The script is executed and results are analyzed
5. You receive detailed performance metrics and AI-powered recommendations

### Why use StressMaster instead of writing K6 scripts directly?

- **Accessibility**: No need to learn K6 scripting syntax
- **Speed**: Describe tests in seconds instead of writing scripts for hours
- **Intelligence**: AI understands context and generates appropriate test scenarios
- **Recommendations**: Get AI-powered insights on your test results
- **Flexibility**: Easily modify tests by changing your natural language description

## Installation and Setup

### What are the system requirements?

- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **Memory**: Minimum 8GB RAM (16GB recommended)
- **Storage**: Minimum 20GB free space
- **CPU**: 4+ cores recommended
- **Network**: Internet access for initial model download

### How long does the initial setup take?

The initial setup typically takes 10-30 minutes, depending on your internet connection speed. Most of this time is spent downloading the LLaMA3 model (approximately 4GB).

### Can I run this on Windows?

Yes, StressMaster runs on Windows using Docker Desktop. Make sure you have:

- Windows 10/11 with WSL2 enabled
- Docker Desktop for Windows
- At least 8GB RAM allocated to Docker

### Can I run this on macOS?

Yes, StressMaster runs on macOS using Docker Desktop. Both Intel and Apple Silicon (M1/M2) Macs are supported.

### Do I need an internet connection to use it?

You need internet access for:

- Initial setup and model download
- Testing external APIs
- Pulling Docker images

Once set up, the AI processing runs entirely offline. You can test local APIs without internet connectivity.

## Usage Questions

### What types of load tests can I create?

StressMaster supports various test types:

- **Spike Testing**: Sudden load increases
- **Stress Testing**: Gradual load increases to find breaking points
- **Endurance Testing**: Sustained load over extended periods
- **Volume Testing**: High concurrent user simulation
- **Baseline Testing**: Performance benchmarking

### Can I test APIs that require authentication?

Yes, StressMaster supports various authentication methods:

- API keys in headers
- JWT tokens
- OAuth 2.0 flows
- Basic authentication
- Custom authentication schemes

Example: "Test my API with JWT authentication: login first, then use the token for 100 requests"

### How do I test complex multi-step workflows?

Describe the workflow in natural language:

```
Create a user journey test:
1. POST login to get auth token
2. GET user profile with the token
3. POST create order with random data
4. GET order status
Run this for 50 users over 10 minutes
```

The AI will generate a script that maintains state between steps and correlates data.

### Can I test GraphQL APIs?

Yes, you can test GraphQL APIs:

```
Test GraphQL API at https://api.example.com/graphql:
Send query to get user with posts and comments
Run 100 concurrent queries for 5 minutes
```

### How do I test WebSocket connections?

WebSocket testing is supported:

```
Test WebSocket at wss://api.example.com/ws:
Connect 50 concurrent connections
Send message every 10 seconds
Maintain connections for 30 minutes
```

### Can I use custom payloads?

Yes, the AI can generate various payload types:

- Random data: `{randomString}`, `{randomNumber}`
- UUIDs: `{uuid}`
- Timestamps: `{timestamp}`, `{isoDate}`
- Sequential data: `{sequence}`, `{counter}`

Example: "Send POST requests with payload containing random user ID, current timestamp, and sequential order number"

## Technical Questions

### Which AI model does it use?

StressMaster uses LLaMA3 running locally via Ollama. The default model is `llama3:8b`, but you can configure different models:

```bash
# Use larger model for better accuracy
echo "MODEL_NAME=llama3:70b" >> .env

# Use smaller model for faster responses
echo "MODEL_NAME=llama3:8b" >> .env
```

### How accurate is the AI parsing?

The AI parsing is highly accurate for common load testing scenarios. It includes:

- Fallback parsing for when AI is unavailable
- Validation of generated specifications
- Suggestion system for ambiguous commands
- Context awareness for complex scenarios

### Can I modify the generated K6 scripts?

Yes, generated scripts are stored in `/app/scripts/k6/` and can be modified. However, modifications will be overwritten if you regenerate the script.

For persistent customizations, describe your requirements in natural language instead of modifying scripts.

### How does it handle errors in my commands?

The system includes multiple error handling layers:

1. **AI Validation**: The AI identifies ambiguous or incomplete commands
2. **Suggestion Engine**: Provides suggestions for unclear commands
3. **Fallback Parser**: Rule-based parsing when AI is unavailable
4. **Script Validation**: Validates generated K6 scripts before execution

### What happens if the AI model is unavailable?

StressMaster includes a fallback parser that can handle common load testing patterns using rule-based parsing. While less flexible than AI parsing, it ensures basic functionality remains available.

## Performance and Scaling

### How many concurrent users can I simulate?

The limit depends on your system resources:

- **8GB RAM**: Up to 500-1000 virtual users
- **16GB RAM**: Up to 2000-5000 virtual users
- **32GB+ RAM**: 10,000+ virtual users

You can also adjust resource limits:

```bash
echo "K6_MEMORY_LIMIT=4g" >> .env
docker-compose restart
```

### How do I optimize performance?

1. **Increase Resources**:

   ```bash
   echo "OLLAMA_MEMORY_LIMIT=8g" >> .env
   echo "K6_MEMORY_LIMIT=4g" >> .env
   ```

2. **Use Faster Model**:

   ```bash
   echo "MODEL_NAME=llama3:8b" >> .env
   ```

3. **Enable Caching**:
   ```bash
   echo "ENABLE_RESPONSE_CACHE=true" >> .env
   ```

### Can I run multiple tests simultaneously?

Yes, StressMaster supports concurrent test execution. Each test runs in its own K6 container instance.

### How do I test high-traffic scenarios?

For high-traffic testing:

1. Use step load patterns to gradually increase load
2. Monitor system resources during tests
3. Consider distributed testing for very high loads
4. Use realistic think times between requests

## Data and Security

### Where is my data stored?

All data is stored locally in Docker volumes:

- **Model Data**: Ollama models and configurations
- **Test Scripts**: Generated K6 scripts
- **Results**: Test results and metrics
- **Application Data**: Configuration and history

### Is my data secure?

Yes, StressMaster prioritizes security:

- All processing happens locally
- No data is sent to external services
- Containers run with non-root users
- Network isolation between services
- Configurable data retention policies

### Can I backup my data?

Yes, use the built-in backup system:

```bash
# Create backup
./scripts/monitor.sh backup

# Restore from backup
./scripts/monitor.sh restore /path/to/backup
```

Backups include all test data, configurations, and results.

### How do I export test results?

Test results can be exported in multiple formats:

- **JSON**: Raw data for programmatic analysis
- **CSV**: Spreadsheet-compatible format
- **HTML**: Rich visual reports with charts

## Troubleshooting

### The AI model is responding slowly

Try these solutions:

1. **Use smaller model**: `echo "MODEL_NAME=llama3:8b" >> .env`
2. **Increase memory**: `echo "OLLAMA_MEMORY_LIMIT=8g" >> .env`
3. **Enable caching**: `echo "ENABLE_RESPONSE_CACHE=true" >> .env`

### My tests are failing with network errors

Check these common issues:

1. **Target API accessibility**: `curl https://your-api.com`
2. **Firewall settings**: Ensure outbound connections are allowed
3. **Proxy configuration**: Set HTTP_PROXY if behind corporate firewall
4. **DNS resolution**: Verify domain names resolve correctly

### The system is using too much memory

Reduce resource usage:

```bash
echo "OLLAMA_MEMORY_LIMIT=2g" >> .env
echo "APP_MEMORY_LIMIT=512m" >> .env
echo "K6_MEMORY_LIMIT=1g" >> .env
docker-compose restart
```

### How do I reset everything to a clean state?

```bash
# Complete reset (WARNING: This removes all data)
docker-compose down -v
docker system prune -a -f
./scripts/deploy.sh
```

## Advanced Usage

### Can I integrate this with CI/CD pipelines?

Yes, StressMaster can be integrated into CI/CD:

```bash
# Run automated test
docker-compose run --rm ai-load-tester npm run test:automated

# Check exit code for pass/fail
echo $?
```

### How do I create custom test templates?

While you can't create templates directly, you can:

1. Save common commands in a text file
2. Use environment variables for dynamic values
3. Create wrapper scripts for repeated scenarios

### Can I extend the AI model's capabilities?

You can create custom model configurations:

```bash
docker-compose exec ollama ollama create custom-load-tester -f - <<EOF
FROM llama3
SYSTEM "You are a specialized load testing expert with knowledge of performance testing best practices."
PARAMETER temperature 0.1
EOF
```

### How do I monitor system resources during tests?

Use the built-in monitoring:

```bash
# Real-time monitoring
./scripts/monitor.sh monitor

# Resource usage
docker stats --no-stream

# System metrics
./scripts/monitor.sh status
```

## Comparison with Other Tools

### How does this compare to JMeter?

| Feature             | StressMaster              | JMeter                  |
| ------------------- | ------------------------- | ----------------------- |
| **Ease of Use**     | Natural language commands | GUI-based configuration |
| **Learning Curve**  | Minimal                   | Moderate to steep       |
| **AI Integration**  | Built-in AI parsing       | None                    |
| **Local Execution** | Yes                       | Yes                     |
| **Scripting**       | Auto-generated            | Manual                  |
| **Modern APIs**     | Excellent support         | Good support            |

### How does this compare to Artillery?

| Feature            | StressMaster        | Artillery        |
| ------------------ | ------------------- | ---------------- |
| **Configuration**  | Natural language    | YAML/JSON        |
| **AI Features**    | Yes                 | No               |
| **Docker Support** | Built-in            | Manual setup     |
| **Reporting**      | AI-powered insights | Standard metrics |
| **Learning Curve** | Very low            | Low to moderate  |

### How does this compare to K6?

StressMaster actually uses K6 as its execution engine, but adds:

- Natural language interface
- AI-powered script generation
- Automated result analysis
- Docker containerization
- Zero configuration setup

## Contributing and Support

### How can I contribute to the project?

Contributions are welcome! You can:

1. Report bugs and issues
2. Suggest new features
3. Submit pull requests
4. Improve documentation
5. Share usage examples

### Where can I get help?

1. **Documentation**: Check README, examples, and troubleshooting guide
2. **Diagnostics**: Run `./scripts/monitor.sh status`
3. **Logs**: Collect logs with `./scripts/monitor.sh logs`
4. **Issues**: Create GitHub issues with diagnostic information

### How do I report bugs?

When reporting bugs, include:

1. System information (`./scripts/monitor.sh status`)
2. Error logs (`./scripts/monitor.sh logs`)
3. Steps to reproduce the issue
4. Expected vs actual behavior
5. Your natural language command

### Is there a community or forum?

Check the project repository for:

- GitHub Discussions for questions
- Issues for bug reports
- Wiki for community documentation
- Examples shared by other users

## Future Development

### What features are planned?

Potential future features include:

- Web-based user interface
- Distributed load testing
- Integration with monitoring tools
- Custom plugin system
- Advanced AI models
- Performance regression detection

### Can I request new features?

Yes! Feature requests are welcome. Please:

1. Check existing issues first
2. Describe your use case clearly
3. Explain why the feature would be valuable
4. Provide examples if possible

### How often is the project updated?

The project follows semantic versioning and regular release cycles. Check the repository for:

- Release notes
- Changelog
- Roadmap
- Development status

---

**Still have questions?** Check the [troubleshooting guide](TROUBLESHOOTING.md) or create an issue in the project repository.
