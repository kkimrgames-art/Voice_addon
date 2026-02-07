const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");

// =====================================================
// PRODUCTION CONFIGURATION
// =====================================================

const CONFIG = {
    // Memory limits
    MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS) || 200,
    MAX_MESSAGE_SIZE: 50 * 1024, // 50KB max per message

    // Timeouts
    WS_PING_INTERVAL: 30000, // 30s
    WS_PONG_TIMEOUT: 5000, // 5s
    CLIENT_TIMEOUT: 60000, // 60s inactivity

    // Rate limiting
    RATE_LIMIT_WINDOW: 1000, // 1s
    RATE_LIMIT_MAX: 50, // 50 msgs/s per client

    // Cleanup
    CLEANUP_INTERVAL: 60000, // 1 min
    STATE_RETENTION: 300000, // 5 min

    // Memory optimization
    USE_COMPRESSION: true,
    GC_INTERVAL: 120000, // 2 min
};

// =====================================================
// STATE MANAGEMENT (OPTIMIZED)
// =====================================================

class StateManager {
    constructor() {
        this.minecraftData = null;
        this.clients = new Map();
        this.pttStates = new Map();
        this.voiceStates = new Map();
        this.rateLimits = new Map();
        this.lastCleanup = Date.now();
    }

    // Add client with validation
    addClient(ws, gamertag) {
        if (this.clients.size >= CONFIG.MAX_CONNECTIONS) {
            throw new Error('Server at capacity');
        }

        if (this.isGamertagTaken(gamertag)) {
            throw new Error('Gamertag already in use');
        }

        this.clients.set(ws, {
            gamertag,
            joinedAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0
        });

        this.pttStates.set(gamertag, { isTalking: true, isMuted: false });
        this.voiceStates.set(gamertag, { isTalking: false, volume: 0 });
    }

    // Remove client
    removeClient(ws) {
        const clientData = this.clients.get(ws);
        if (clientData) {
            this.pttStates.delete(clientData.gamertag);
            this.voiceStates.delete(clientData.gamertag);
            this.rateLimits.delete(ws);
            this.clients.delete(ws);
        }
    }

    // Check rate limit
    checkRateLimit(ws) {
        const now = Date.now();
        const limit = this.rateLimits.get(ws) || { count: 0, resetAt: now + CONFIG.RATE_LIMIT_WINDOW };

        if (now > limit.resetAt) {
            limit.count = 1;
            limit.resetAt = now + CONFIG.RATE_LIMIT_WINDOW;
        } else {
            limit.count++;
        }

        this.rateLimits.set(ws, limit);
        return limit.count <= CONFIG.RATE_LIMIT_MAX;
    }

    // Update client activity
    updateActivity(ws) {
        const client = this.clients.get(ws);
        if (client) {
            client.lastActivity = Date.now();
            client.messageCount++;
        }
    }

    // Check if gamertag is taken
    isGamertagTaken(gamertag) {
        for (const [_, clientData] of this.clients.entries()) {
            if (clientData.gamertag === gamertag) {
                return true;
            }
        }
        return false;
    }

    // Get participants list
    getParticipants() {
        return Array.from(this.clients.values()).map(c => c.gamertag);
    }

    // Cleanup stale data
    cleanup() {
        const now = Date.now();
        const staleThreshold = now - CONFIG.STATE_RETENTION;

        // Clean up disconnected clients
        for (const [ws, data] of this.clients.entries()) {
            if (now - data.lastActivity > CONFIG.CLIENT_TIMEOUT) {
                console.warn(`⏰ Client timeout: ${data.gamertag}`);
                if (ws.readyState === 1) {
                    ws.close(1000, 'Timeout');
                }
                this.removeClient(ws);
            }
        }

        this.lastCleanup = now;
    }

    // Get stats
    getStats() {
        return {
            totalClients: this.clients.size,
            pttActive: this.pttStates.size,
            voiceActive: this.voiceStates.size,
            memoryUsage: process.memoryUsage(),
            uptime: Math.round(process.uptime())
        };
    }
}

// =====================================================
// LOGGER (PRODUCTION-GRADE)
// =====================================================

class Logger {
    static log(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...meta
        };

        const prefix = {
            'INFO': 'ℹ️',
            'WARN': '⚠️',
            'ERROR': '❌',
            'SUCCESS': '✅',
            'DEBUG': '🔍'
        }[level] || '•';

        console.log(`[${timestamp}] ${prefix} ${message}`, meta.error ? meta.error.message : '');
    }

    static info(msg, meta) { this.log('INFO', msg, meta); }
    static warn(msg, meta) { this.log('WARN', msg, meta); }
    static error(msg, meta) { this.log('ERROR', msg, meta); }
    static success(msg, meta) { this.log('SUCCESS', msg, meta); }
    static debug(msg, meta) { this.log('DEBUG', msg, meta); }
}

// =====================================================
// EXPRESS APP SETUP
// =====================================================

const app = express();
const server = http.createServer(app);
const stateManager = new StateManager();

// Trust proxy (for Render)
app.set('trust proxy', 1);

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});

// JSON body parser with limit
app.use(express.json({ limit: '100kb' }));

// Static files
app.use(express.static(path.join(__dirname, "..")));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) {
            Logger.warn(`Slow request: ${req.method} ${req.path} (${duration}ms)`);
        }
    });
    next();
});

// =====================================================
// HTTP ENDPOINTS
// =====================================================

// Minecraft data endpoint (optimized)
app.post("/minecraft-data", (req, res) => {
    try {
        const startTime = Date.now();
        stateManager.minecraftData = req.body;

        const players = Array.isArray(req.body.players) ? req.body.players : [];

        // Update states efficiently
        for (const player of players) {
            const gamertag = player?.name;
            if (!gamertag) continue;

            const data = player?.data || {};
            stateManager.pttStates.set(gamertag, {
                isTalking: Boolean(data.isTalking),
                isMuted: Boolean(data.isMuted)
            });

            stateManager.voiceStates.set(gamertag, {
                isTalking: Boolean(data.isTalking),
                volume: typeof data.voiceVolume === 'number' ? data.voiceVolume : -100
            });
        }

        // Prepare broadcast data
        const updateData = {
            type: 'minecraft-update',
            data: req.body,
            pttStates: Array.from(stateManager.pttStates.entries()).map(([gamertag, state]) => ({
                gamertag, ...state
            })),
            voiceStates: Array.from(stateManager.voiceStates.entries()).map(([gamertag, state]) => ({
                gamertag, ...state
            }))
        };

        const message = JSON.stringify(updateData);

        // Broadcast to all connected clients (optimized)
        let sentCount = 0;
        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                try {
                    client.send(message);
                    sentCount++;
                } catch (e) {
                    Logger.error('Failed to send to client', { error: e });
                }
            }
        });

        const duration = Date.now() - startTime;

        res.json({
            success: true,
            processed: players.length,
            broadcasted: sentCount,
            duration: `${duration}ms`
        });

    } catch (e) {
        Logger.error('Minecraft data processing error', { error: e });
        res.status(500).json({ success: false, error: e.message });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    const stats = stateManager.getStats();
    const mem = stats.memoryUsage;

    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: {
            total: stats.totalClients,
            max: CONFIG.MAX_CONNECTIONS,
            usage: `${Math.round((stats.totalClients / CONFIG.MAX_CONNECTIONS) * 100)}%`
        },
        memory: {
            rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`
        },
        uptime: stats.uptime,
        states: {
            ptt: stats.pttActive,
            voice: stats.voiceActive
        }
    };

    res.json(health);
});

// PTT states endpoint
app.get("/ptt-states", (req, res) => {
    const states = Array.from(stateManager.pttStates.entries()).map(([gamertag, state]) => ({
        gamertag, ...state
    }));
    res.json({ pttStates: states });
});

// Voice states endpoint
app.get("/voice-states", (req, res) => {
    const states = Array.from(stateManager.voiceStates.entries()).map(([gamertag, state]) => ({
        gamertag, ...state
    }));
    res.json({ voiceStates: states });
});

// =====================================================
// WEBSOCKET SERVER (OPTIMIZED)
// =====================================================

const wss = new WebSocketServer({
    server,
    maxPayload: CONFIG.MAX_MESSAGE_SIZE,
    perMessageDeflate: CONFIG.USE_COMPRESSION ? {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },
        threshold: 1024
    } : false
});

// WebSocket connection handler
wss.on("connection", (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    Logger.debug(`New connection attempt from ${ip}`);

    // Connection state
    let isAlive = true;
    let gamertag = null;

    // Heartbeat
    const pingInterval = setInterval(() => {
        if (!isAlive) {
            Logger.warn(`Terminating inactive connection: ${gamertag || 'unknown'}`);
            clearInterval(pingInterval);
            ws.terminate();
            return;
        }

        isAlive = false;
        ws.ping();
    }, CONFIG.WS_PING_INTERVAL);

    ws.on('pong', () => {
        isAlive = true;
    });

    // Message handler
    ws.on("message", (msg) => {
        try {
            // Rate limiting
            if (!stateManager.checkRateLimit(ws)) {
                Logger.warn(`Rate limit exceeded: ${gamertag || 'unknown'}`);
                ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
                return;
            }

            stateManager.updateActivity(ws);

            const data = JSON.parse(msg.toString());

            // Handle join
            if (data.type === 'join') {
                try {
                    stateManager.addClient(ws, data.gamertag);
                    gamertag = data.gamertag;

                    Logger.success(`${gamertag} joined (${stateManager.clients.size} total)`);

                    // Send participants list to new client
                    ws.send(JSON.stringify({
                        type: 'participants-list',
                        list: stateManager.getParticipants()
                    }));

                    // Broadcast join to others
                    broadcast(ws, {
                        type: 'join',
                        gamertag: data.gamertag
                    });

                    // Broadcast updated list to all
                    broadcastToAll({
                        type: 'participants-list',
                        list: stateManager.getParticipants()
                    });

                } catch (e) {
                    Logger.error(`Join failed: ${data.gamertag}`, { error: e });
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: e.message
                    }));
                    ws.close(1008, e.message);
                }
                return;
            }

            // Handle leave
            if (data.type === 'leave') {
                stateManager.removeClient(ws);
                Logger.info(`${gamertag} left`);

                broadcast(ws, {
                    type: 'leave',
                    gamertag
                });
                return;
            }

            // Handle voice detection
            if (data.type === 'voice-detection') {
                stateManager.voiceStates.set(data.gamertag, {
                    isTalking: data.isTalking,
                    volume: data.volume || 0
                });
                return;
            }

            // Handle PTT status
            if (data.type === 'ptt-status') {
                stateManager.pttStates.set(data.gamertag, {
                    isTalking: data.isTalking,
                    isMuted: data.isMuted
                });

                broadcastToAll({
                    type: 'ptt-update',
                    gamertag: data.gamertag,
                    isTalking: data.isTalking,
                    isMuted: data.isMuted
                });
                return;
            }

            // Handle WebRTC signaling (offer/answer/ice-candidate)
            if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
                if (!data.to || !data.from) {
                    Logger.warn(`Invalid signaling message: missing to/from`);
                    return;
                }

                // Find target client
                let targetWs = null;
                for (const [clientWs, clientData] of stateManager.clients.entries()) {
                    if (clientData.gamertag === data.to) {
                        targetWs = clientWs;
                        break;
                    }
                }

                if (targetWs && targetWs.readyState === 1) {
                    targetWs.send(JSON.stringify(data));
                }
                return;
            }

            // Handle heartbeat
            if (data.type === 'heartbeat') {
                return;
            }

            // Handle request-participants
            if (data.type === 'request-participants') {
                ws.send(JSON.stringify({
                    type: 'participants-list',
                    list: stateManager.getParticipants()
                }));
                return;
            }

        } catch (e) {
            Logger.error(`Message processing error for ${gamertag || 'unknown'}`, { error: e });
        }
    });

    // Connection close handler
    ws.on('close', () => {
        clearInterval(pingInterval);

        if (gamertag) {
            Logger.info(`${gamertag} disconnected (${stateManager.clients.size - 1} remaining)`);

            stateManager.removeClient(ws);

            broadcast(ws, {
                type: 'leave',
                gamertag
            });

            broadcastToAll({
                type: 'participants-list',
                list: stateManager.getParticipants()
            });
        }
    });

    // Error handler
    ws.on('error', (error) => {
        Logger.error(`WebSocket error for ${gamertag || 'unknown'}`, { error });
    });

    // Send initial minecraft data if available
    if (stateManager.minecraftData) {
        ws.send(JSON.stringify({
            type: 'minecraft-update',
            data: stateManager.minecraftData
        }));
    }
});

// Broadcast helpers
function broadcast(senderWs, message) {
    const msg = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client !== senderWs && client.readyState === 1) {
            try {
                client.send(msg);
            } catch (e) {
                Logger.error('Broadcast failed', { error: e });
            }
        }
    });
}

function broadcastToAll(message) {
    const msg = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            try {
                client.send(msg);
            } catch (e) {
                Logger.error('Broadcast failed', { error: e });
            }
        }
    });
}

// =====================================================
// BACKGROUND TASKS
// =====================================================

// Periodic cleanup
setInterval(() => {
    stateManager.cleanup();
}, CONFIG.CLEANUP_INTERVAL);

// Memory garbage collection hint (Node.js will decide)
if (global.gc) {
    setInterval(() => {
        global.gc();
        Logger.debug('GC triggered');
    }, CONFIG.GC_INTERVAL);
}

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

function gracefulShutdown(signal) {
    Logger.warn(`${signal} received. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(() => {
        Logger.success('HTTP server closed');
    });

    // Close all WebSocket connections
    broadcastToAll({ type: 'server-shutdown' });

    wss.clients.forEach(client => {
        client.close(1001, 'Server shutting down');
    });

    setTimeout(() => {
        Logger.success('Graceful shutdown complete');
        process.exit(0);
    }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Unhandled errors
process.on('uncaughtException', (error) => {
    Logger.error('Uncaught Exception', { error });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    Logger.error('Unhandled Rejection', { error: reason });
});

// =====================================================
// SERVER START
// =====================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    Logger.success(`EnviroVoice Server v3.0 (Production)`);
    Logger.info(`Server listening on port ${PORT}`);
    Logger.info(`Max connections: ${CONFIG.MAX_CONNECTIONS}`);
    Logger.info(`Health check: http://localhost:${PORT}/health`);
    Logger.info('Server ready for production traffic');
});
