// Load Testing Script for Production Server
// Tests 160 concurrent connections (4 servers × 40 players)

const WebSocket = require('ws');
const http = require('http');

const CONFIG = {
    SERVER_URL: 'ws://localhost:3000',
    HTTP_URL: 'http://localhost:3000',

    // Test scenarios
    SCENARIOS: {
        LIGHT: { servers: 2, playersPerServer: 20 }, // 40 connections
        MEDIUM: { servers: 3, playersPerServer: 30 }, // 90 connections
        HEAVY: { servers: 4, playersPerServer: 40 }, // 160 connections
        STRESS: { servers: 5, playersPerServer: 50 }, // 250 connections (over limit)
    },

    // Test duration
    TEST_DURATION: 60000, // 1 minute
    RAMP_UP_TIME: 10000, // 10s to connect all clients
};

// =====================================================
// LOAD TESTER
// =====================================================

class LoadTester {
    constructor(scenario) {
        this.scenario = scenario;
        this.connections = [];
        this.stats = {
            connected: 0,
            failed: 0,
            messages: { sent: 0, received: 0 },
            errors: 0,
            startTime: null,
            endTime: null
        };
    }

    // Create a single WebSocket client
    createClient(serverId, playerId) {
        return new Promise((resolve, reject) => {
            const gamertag = `Server${serverId}_Player${playerId}`;
            const ws = new WebSocket(CONFIG.SERVER_URL);

            ws.on('open', () => {
                // Send join message
                ws.send(JSON.stringify({
                    type: 'join',
                    gamertag
                }));

                this.stats.connected++;
                console.log(`✓ ${gamertag} connected (${this.stats.connected}/${this.getTargetConnections()})`);

                // Simulate periodic activity
                const activityInterval = setInterval(() => {
                    if (ws.readyState === 1) {
                        // Simulate voice detection
                        ws.send(JSON.stringify({
                            type: 'voice-detection',
                            gamertag,
                            isTalking: Math.random() > 0.7,
                            volume: Math.random() * 100 - 100
                        }));
                        this.stats.messages.sent++;
                    }
                }, 2000 + Math.random() * 3000); // Random interval 2-5s

                ws.on('message', () => {
                    this.stats.messages.received++;
                });

                ws.on('error', (error) => {
                    this.stats.errors++;
                    console.error(`❌ ${gamertag} error:`, error.message);
                });

                ws.on('close', () => {
                    clearInterval(activityInterval);
                });

                this.connections.push({
                    ws,
                    gamertag,
                    interval: activityInterval
                });

                resolve({ ws, gamertag });
            });

            ws.on('error', (error) => {
                this.stats.failed++;
                console.error(`❌ Failed to connect ${gamertag}:`, error.message);
                reject(error);
            });
        });
    }

    // Get target connection count
    getTargetConnections() {
        return this.scenario.servers * this.scenario.playersPerServer;
    }

    // Connect all clients with ramp-up
    async connectClients() {
        const totalConnections = this.getTargetConnections();
        const delayBetween = CONFIG.RAMP_UP_TIME / totalConnections;

        console.log(`\n🔗 Connecting ${totalConnections} clients...`);
        console.log(`📊 Ramp-up: ${CONFIG.RAMP_UP_TIME / 1000}s\n`);

        for (let serverId = 1; serverId <= this.scenario.servers; serverId++) {
            for (let playerId = 1; playerId <= this.scenario.playersPerServer; playerId++) {
                try {
                    await this.createClient(serverId, playerId);
                    await this.sleep(delayBetween);
                } catch (error) {
                    // Continue with other connections
                }
            }
        }

        console.log(`\n✅ Connection phase complete`);
        console.log(`   Connected: ${this.stats.connected}`);
        console.log(`   Failed: ${this.stats.failed}\n`);
    }

    // Check server health
    async checkHealth() {
        try {
            const response = await this.httpGet(CONFIG.HTTP_URL + '/health');
            const health = JSON.parse(response);

            console.log(`\n━━━ SERVER HEALTH ━━━`);
            console.log(`Status: ${health.status}`);
            console.log(`Connections: ${health.connections.total}/${health.connections.max} (${health.connections.usage})`);
            console.log(`Memory RSS: ${health.memory.rss}`);
            console.log(`Memory Heap: ${health.memory.heapUsed}/${health.memory.heapTotal}`);
            console.log(`Uptime: ${health.uptime}s\n`);

            return health;
        } catch (error) {
            console.error(`❌ Health check failed:`, error.message);
            return null;
        }
    }

    // HTTP GET helper
    httpGet(url) {
        return new Promise((resolve, reject) => {
            http.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

    // Run the load test
    async run() {
        console.log(`\n╔════════════════════════════════════════╗`);
        console.log(`║     LOAD TEST STARTING                 ║`);
        console.log(`╠════════════════════════════════════════╣`);
        console.log(`║ Servers:          ${this.scenario.servers.toString().padEnd(19)} ║`);
        console.log(`║ Players/Server:   ${this.scenario.playersPerServer.toString().padEnd(19)} ║`);
        console.log(`║ Total Connections: ${this.getTargetConnections().toString().padEnd(18)} ║`);
        console.log(`║ Test Duration:    ${(CONFIG.TEST_DURATION / 1000).toString().padEnd(12)}s      ║`);
        console.log(`╚════════════════════════════════════════╝\n`);

        this.stats.startTime = Date.now();

        // Phase 1: Connect clients
        await this.connectClients();

        // Phase 2: Check initial health
        const initialHealth = await this.checkHealth();

        // Phase 3: Run test for duration
        console.log(`⏱️  Running test for ${CONFIG.TEST_DURATION / 1000}s...\n`);

        const statsInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - this.stats.startTime) / 1000);
            const rate = Math.round(this.stats.messages.sent / elapsed);
            console.log(`[${elapsed}s] Messages: ${this.stats.messages.sent} sent, ${this.stats.messages.received} received (${rate} msg/s)`);
        }, 5000);

        await this.sleep(CONFIG.TEST_DURATION);

        clearInterval(statsInterval);

        // Phase 4: Check final health
        const finalHealth = await this.checkHealth();

        // Phase 5: Disconnect all
        console.log(`\n🔌 Disconnecting all clients...`);
        this.connections.forEach(({ ws, interval }) => {
            clearInterval(interval);
            ws.close();
        });

        await this.sleep(2000);

        this.stats.endTime = Date.now();

        // Phase 6: Final report
        this.printReport(initialHealth, finalHealth);
    }

    // Print final report
    printReport(initialHealth, finalHealth) {
        const duration = (this.stats.endTime - this.stats.startTime) / 1000;

        console.log(`\n╔════════════════════════════════════════╗`);
        console.log(`║     LOAD TEST RESULTS                  ║`);
        console.log(`╠════════════════════════════════════════╣`);
        console.log(`║ Duration:         ${duration.toFixed(1).padEnd(19)}s║`);
        console.log(`║ Connected:        ${this.stats.connected.toString().padEnd(19)} ║`);
        console.log(`║ Failed:           ${this.stats.failed.toString().padEnd(19)} ║`);
        console.log(`║ Errors:           ${this.stats.errors.toString().padEnd(19)} ║`);
        console.log(`║ Messages Sent:    ${this.stats.messages.sent.toString().padEnd(19)} ║`);
        console.log(`║ Messages Received: ${this.stats.messages.received.toString().padEnd(18)} ║`);
        console.log(`║ Avg Rate:         ${Math.round(this.stats.messages.sent / duration).toString().padEnd(12)} msg/s  ║`);
        console.log(`╚════════════════════════════════════════╝\n`);

        if (finalHealth) {
            const memoryUsed = parseInt(finalHealth.memory.rss);
            const memoryLimit = 512; // MB (Render free tier)
            const memoryPercent = Math.round((memoryUsed / memoryLimit) * 100);

            console.log(`📊 Memory Analysis:`);
            console.log(`   Used: ${memoryUsed}MB / ${memoryLimit}MB (${memoryPercent}%)`);
            console.log(`   Status: ${memoryPercent < 80 ? '✅ PASS' : '⚠️ HIGH'}\n`);
        }

        const successRate = (this.stats.connected / this.getTargetConnections()) * 100;
        console.log(`✅ Test Complete`);
        console.log(`   Success Rate: ${successRate.toFixed(1)}%`);
        console.log(`   Verdict: ${successRate >= 95 ? '✅ PASS' : '❌ FAIL'}\n`);
    }

    // Sleep helper
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// =====================================================
// RUN TESTS
// =====================================================

async function runAllTests() {
    console.log(`\n🚀 EnviroVoice Load Testing Suite\n`);

    for (const [name, scenario] of Object.entries(CONFIG.SCENARIOS)) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`TEST: ${name}`);
        console.log(`${'='.repeat(50)}\n`);

        const tester = new LoadTester(scenario);
        await tester.run();

        console.log(`\nWaiting 10s before next test...\n`);
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    console.log(`\n✅ All tests complete!\n`);
    process.exit(0);
}

// Run single test
async function runSingleTest(scenarioName) {
    const scenario = CONFIG.SCENARIOS[scenarioName.toUpperCase()];

    if (!scenario) {
        console.error(`❌ Unknown scenario: ${scenarioName}`);
        console.log(`Available: ${Object.keys(CONFIG.SCENARIOS).join(', ')}`);
        process.exit(1);
    }

    const tester = new LoadTester(scenario);
    await tester.run();
    process.exit(0);
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
    runAllTests();
} else {
    runSingleTest(args[0]);
}
