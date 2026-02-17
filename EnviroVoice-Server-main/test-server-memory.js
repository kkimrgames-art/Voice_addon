// Standalone Server Test Script with Memory Monitoring
// Run with: node test-server-memory.js

const http = require('http');

// Simulated WebSocket state storage
const connections = new Map();
const minecraftData = { players: [] };

// Memory tracking
function getMemoryUsage() {
    const mem = process.memoryUsage();
    return {
        rss: Math.round(mem.rss / 1024 / 1024), // MB
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024), // MB
        external: Math.round(mem.external / 1024 / 1024), // MB
    };
}

// HTTP Server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'POST' && req.url === '/minecraft-data') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                minecraftData.players = JSON.parse(body).players || [];
                console.log(`📦 Minecraft data received: ${minecraftData.players.length} players`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end('Bad Request');
            }
        });
    } else if (req.url === '/health') {
        const mem = getMemoryUsage();
        const stats = {
            status: 'ok',
            connected_users: connections.size,
            minecraft_players: minecraftData.players.length,
            memory: mem,
            uptime: Math.round(process.uptime())
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
    } else if (req.url === '/memory-report') {
        const mem = getMemoryUsage();
        console.log(`
╔════════════════════════════════════════╗
║     MEMORY USAGE REPORT               ║
╠════════════════════════════════════════╣
║ RSS (Total):      ${mem.rss.toString().padStart(4)} MB           ║
║ Heap Used:        ${mem.heapUsed.toString().padStart(4)} MB           ║
║ Heap Total:       ${mem.heapTotal.toString().padStart(4)} MB           ║
║ External:         ${mem.external.toString().padStart(4)} MB           ║
║ Connections:      ${connections.size.toString().padStart(4)}              ║
║ Players:          ${minecraftData.players.length.toString().padStart(4)}              ║
╚════════════════════════════════════════╝
    `);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mem));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Simulate connections
function simulateConnections(count) {
    console.log(`🔗 Simulating ${count} connections...`);

    for (let i = 0; i < count; i++) {
        const id = `player_${i + 1}`;
        connections.set(id, {
            gamertag: `Player${i + 1}`,
            connected_at: Date.now(),
            ptt_state: { isTalking: false, isMuted: false },
            voice_state: { isTalking: false, volume: 0 }
        });
    }

    // Simulate Minecraft player data
    minecraftData.players = Array.from(connections.values()).map((c, i) => ({
        name: c.gamertag,
        location: { x: i * 10, y: 64, z: i * 10 },
        data: {
            isInCave: false,
            isUnderWater: false,
            isInMountain: false,
            isBuried: false,
            isMuted: c.ptt_state.isMuted,
            isDeafened: false,
            micVolume: 1,
            customVolumes: {},
            isTalking: c.voice_state.isTalking,
            voiceVolume: c.voice_state.volume
        }
    }));

    console.log(`✅ Simulated ${count} connections`);
    const mem = getMemoryUsage();
    console.log(`📊 Memory: RSS=${mem.rss}MB, Heap=${mem.heapUsed}/${mem.heapTotal}MB`);
}

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`🚀 EnviroVoice Test Server`);
    console.log(`🌐 Server listening on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Memory report: http://localhost:${PORT}/memory-report`);
    console.log();

    // Initial baseline
    const baseline = getMemoryUsage();
    console.log(`📌 Baseline Memory: ${baseline.rss} MB`);
    console.log();

    // Test scenarios
    console.log(`Starting automated tests...`);
    console.log();

    setTimeout(() => {
        console.log(`\n━━━ TEST 1: 8 Players ━━━`);
        simulateConnections(8);
    }, 2000);

    setTimeout(() => {
        console.log(`\n━━━ TEST 2: 16 Players ━━━`);
        connections.clear();
        simulateConnections(16);
    }, 5000);

    setTimeout(() => {
        console.log(`\n━━━ TEST 3: 32 Players (Max Load) ━━━`);
        connections.clear();
        simulateConnections(32);
    }, 8000);

    setTimeout(() => {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`FINAL REPORT`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        const final = getMemoryUsage();
        console.log(`With 32 simulated connections:`);
        console.log(`  RSS Memory:    ${final.rss} MB`);
        console.log(`  Heap Used:     ${final.heapUsed} MB`);
        console.log(`  Baseline:      ${baseline.rss} MB`);
        console.log(`  Delta:         +${final.rss - baseline.rss} MB`);
        console.log();
        console.log(`✅ Conclusion: ${final.rss < 200 ? 'PASS - Fits in 200MB' : 'FAIL - Exceeds 200MB'}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log();
        console.log(`Server still running. Press Ctrl+C to stop.`);
    }, 11000);

    // Periodic memory report every 10 seconds
    setInterval(() => {
        const mem = getMemoryUsage();
        console.log(`[${new Date().toLocaleTimeString()}] Memory: ${mem.rss}MB | Connections: ${connections.size}`);
    }, 10000);
});
