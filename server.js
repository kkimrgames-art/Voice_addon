/**
 * EnviroVoice Server v4.0 - Ultra Resilient
 * ==========================================
 * - NO automatic player removal (players stay connected)
 * - Comprehensive error handling for ALL scenarios
 * - Protection against hackers, glitches, and crashes
 * - Memory optimized for Render free tier (100MB limit)
 * - Self-healing and fault tolerant
 */

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

// =====================================================
// CONFIGURATION
// =====================================================
const CONFIG = {
  // Connection limits
  MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS) || 50,
  MAX_VOICE_ACTIVE: 50,

  // Memory limits (Render free tier = 100MB)
  MEMORY_LIMIT_MB: 90,
  MEMORY_WARNING_MB: 70,
  MEMORY_EMERGENCY_MB: 95,

  // Rate limiting (anti-spam/attack)
  RATE_LIMIT_WINDOW: 1000,
  RATE_LIMIT_MAX: 30,
  RATE_LIMIT_BURST: 50,

  // Message limits
  MAX_MESSAGE_SIZE: 32 * 1024,
  MAX_GAMERTAG_LENGTH: 50,
  MIN_GAMERTAG_LENGTH: 1,

  // Intervals
  MEMORY_CHECK_INTERVAL: 15000,
  RATE_LIMIT_CLEANUP: 120000,

  // Token validation
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  TOKEN_VALIDATION_ENABLED: process.env.TOKEN_VALIDATION_ENABLED === 'true',
};

// =====================================================
// SAFE LOGGER (Never throws)
// =====================================================
const Logger = {
  _safe(fn) {
    try { fn(); } catch { }
  },
  _time() {
    try {
      return new Date().toISOString().slice(11, 19);
    } catch {
      return '??:??:??';
    }
  },
  info: function (msg) { this._safe(() => console.log(`[${this._time()}] ${msg}`)); },
  warn: function (msg) { this._safe(() => console.warn(`[${this._time()}] ⚠️ ${msg}`)); },
  error: function (msg, err) {
    this._safe(() => console.error(`[${this._time()}] ❌ ${msg}`, err?.message || err || ''));
  },
  success: function (msg) { this._safe(() => console.log(`[${this._time()}] ✅ ${msg}`)); }
};

// =====================================================
// ERROR HANDLER (Catch all unhandled errors)
// =====================================================
process.on('uncaughtException', (err) => {
  Logger.error('UNCAUGHT EXCEPTION - Server continues', err);
  // Don't exit - keep running
});

process.on('unhandledRejection', (reason) => {
  Logger.error('UNHANDLED REJECTION - Server continues', reason);
  // Don't exit - keep running
});

// =====================================================
// MEMORY MONITOR (Enhanced)
// =====================================================
class MemoryMonitor {
  constructor() {
    this.isLowMemory = false;
    this.isCriticalMemory = false;
    this.isEmergency = false;
    this.lastCleanup = 0;
  }

  check() {
    try {
      const used = process.memoryUsage();
      const heapMB = Math.round(used.heapUsed / 1024 / 1024);
      const rssMB = Math.round(used.rss / 1024 / 1024);

      this.isLowMemory = rssMB > CONFIG.MEMORY_WARNING_MB;
      this.isCriticalMemory = rssMB > CONFIG.MEMORY_LIMIT_MB;
      this.isEmergency = rssMB > CONFIG.MEMORY_EMERGENCY_MB;

      return { heapMB, rssMB, isLowMemory: this.isLowMemory, isCritical: this.isCriticalMemory };
    } catch (e) {
      Logger.error('Memory check failed', e);
      return { heapMB: 0, rssMB: 0, isLowMemory: false, isCritical: false };
    }
  }

  forceGC() {
    try {
      if (global.gc) {
        global.gc();
        Logger.info('🧹 Garbage collection triggered');
      }
    } catch { }
  }

  emergencyCleanup() {
    try {
      this.forceGC();
      // Clear any cached data
      minecraftData = null;
      rateLimiter.clearAll();
      Logger.warn('🚨 EMERGENCY cleanup performed');
    } catch (e) {
      Logger.error('Emergency cleanup failed', e);
    }
  }
}

const memoryMonitor = new MemoryMonitor();

// =====================================================
// RATE LIMITER (Enhanced with auto-cleanup)
// =====================================================
class RateLimiter {
  constructor() {
    this.clients = new Map();
    this.banList = new Set();
  }

  check(clientId) {
    try {
      // Check ban list
      if (this.banList.has(clientId)) {
        return { allowed: false, banned: true, violations: 999 };
      }

      const now = Date.now();
      let data = this.clients.get(clientId);

      if (!data) {
        data = { count: 0, windowStart: now, violations: 0 };
        this.clients.set(clientId, data);
      }

      // Reset window
      if (now - data.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
        data.count = 0;
        data.windowStart = now;
      }

      data.count++;

      // Check burst limit
      if (data.count > CONFIG.RATE_LIMIT_BURST) {
        data.violations++;

        // Ban after 5 violations
        if (data.violations >= 5) {
          this.banList.add(clientId);
          Logger.warn(`BANNED: ${clientId} for excessive spam`);
        }

        return { allowed: false, violations: data.violations };
      }

      if (data.count > CONFIG.RATE_LIMIT_MAX) {
        return { allowed: true, warning: true };
      }

      return { allowed: true };
    } catch (e) {
      Logger.error('Rate limiter error', e);
      return { allowed: true }; // Fail open
    }
  }

  remove(clientId) {
    try {
      this.clients.delete(clientId);
    } catch { }
  }

  clearAll() {
    try {
      this.clients.clear();
      // Keep ban list
    } catch { }
  }

  cleanup() {
    try {
      const now = Date.now();
      const toDelete = [];

      for (const [id, data] of this.clients) {
        if (now - data.windowStart > 120000) {
          toDelete.push(id);
        }
      }

      for (const id of toDelete) {
        this.clients.delete(id);
      }

      // Clear old bans (after 1 hour)
      if (this.banList.size > 100) {
        this.banList.clear();
      }
    } catch (e) {
      Logger.error('Rate limiter cleanup error', e);
    }
  }
}

const rateLimiter = new RateLimiter();

// =====================================================
// INPUT SANITIZER (Prevent injection/glitches)
// =====================================================
const Sanitizer = {
  gamertag(tag) {
    try {
      if (!tag || typeof tag !== 'string') return null;

      // Remove dangerous characters
      let clean = tag
        .substring(0, CONFIG.MAX_GAMERTAG_LENGTH)
        .replace(/[<>{}[\]\\\/]/g, '')
        .replace(/[\x00-\x1F\x7F]/g, '') // Control chars
        .trim();

      if (clean.length < CONFIG.MIN_GAMERTAG_LENGTH) return null;
      return clean;
    } catch {
      return null;
    }
  },

  message(data) {
    try {
      if (!data || typeof data !== 'object') return null;
      if (!data.type || typeof data.type !== 'string') return null;
      return data;
    } catch {
      return null;
    }
  },

  number(val, min = 0, max = 100) {
    try {
      const num = Number(val);
      if (isNaN(num)) return min;
      return Math.max(min, Math.min(max, num));
    } catch {
      return min;
    }
  },

  boolean(val) {
    return val === true || val === 'true';
  }
};

// =====================================================
// STATE MANAGER (Robust, fault-tolerant)
// =====================================================
class StateManager {
  constructor() {
    this.clients = new Map();
    this.pttStates = new Map();
    this.voiceStates = new Map();
    this.activeVoiceCount = 0;
    this.gamertagIndex = new Map(); // gamertag -> ws for fast lookup
  }

  get connectionCount() {
    return this.clients.size;
  }

  canAcceptConnection() {
    try {
      return this.clients.size < CONFIG.MAX_CONNECTIONS && !memoryMonitor.isEmergency;
    } catch {
      return false;
    }
  }

  canActivateVoice() {
    try {
      return this.activeVoiceCount < CONFIG.MAX_VOICE_ACTIVE && !memoryMonitor.isCriticalMemory;
    } catch {
      return false;
    }
  }

  addClient(ws, gamertag) {
    try {
      // Validate
      const cleanTag = Sanitizer.gamertag(gamertag);
      if (!cleanTag) {
        throw new Error('INVALID_GAMERTAG');
      }

      // Check duplicate
      if (this.gamertagIndex.has(cleanTag)) {
        throw new Error('GAMERTAG_IN_USE');
      }

      const canVoice = this.canActivateVoice();

      const clientData = {
        gamertag: cleanTag,
        joinedAt: Date.now(),
        voiceActive: canVoice,
        forceMuted: !canVoice
      };

      this.clients.set(ws, clientData);
      this.gamertagIndex.set(cleanTag, ws);

      if (canVoice) {
        this.activeVoiceCount++;
      }

      this.pttStates.set(cleanTag, { isTalking: false, isMuted: !canVoice });
      this.voiceStates.set(cleanTag, { isTalking: false, volume: 0 });

      return { voiceActive: canVoice, gamertag: cleanTag };
    } catch (e) {
      if (e.message === 'INVALID_GAMERTAG' || e.message === 'GAMERTAG_IN_USE') {
        throw e;
      }
      Logger.error('addClient error', e);
      throw new Error('INTERNAL_ERROR');
    }
  }

  removeClient(ws) {
    try {
      const data = this.clients.get(ws);
      if (!data) return null;

      if (data.voiceActive) {
        this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
      }

      this.pttStates.delete(data.gamertag);
      this.voiceStates.delete(data.gamertag);
      this.gamertagIndex.delete(data.gamertag);
      this.clients.delete(ws);
      rateLimiter.remove(data.gamertag);

      return data.gamertag;
    } catch (e) {
      Logger.error('removeClient error', e);
      return null;
    }
  }

  getClient(ws) {
    try {
      return this.clients.get(ws);
    } catch {
      return null;
    }
  }

  getParticipants() {
    try {
      return Array.from(this.clients.values()).map(c => c.gamertag);
    } catch {
      return [];
    }
  }

  getParticipantsWithStatus() {
    try {
      return Array.from(this.clients.values()).map(c => ({
        gamertag: c.gamertag,
        voiceActive: c.voiceActive,
        forceMuted: c.forceMuted
      }));
    } catch {
      return [];
    }
  }

  findClientByGamertag(gamertag) {
    try {
      const ws = this.gamertagIndex.get(gamertag);
      if (!ws) return null;
      const data = this.clients.get(ws);
      return data ? { ws, data } : null;
    } catch {
      return null;
    }
  }

  updatePttState(gamertag, isTalking, isMuted) {
    try {
      const client = this.findClientByGamertag(gamertag);
      if (client && !client.data.forceMuted) {
        this.pttStates.set(gamertag, {
          isTalking: Sanitizer.boolean(isTalking),
          isMuted: Sanitizer.boolean(isMuted)
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  updateVoiceState(gamertag, isTalking, volume) {
    try {
      const client = this.findClientByGamertag(gamertag);
      if (client && !client.data.forceMuted) {
        this.voiceStates.set(gamertag, {
          isTalking: Sanitizer.boolean(isTalking),
          volume: Sanitizer.number(volume, -100, 0)
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getStats() {
    try {
      return {
        connections: this.clients.size,
        maxConnections: CONFIG.MAX_CONNECTIONS,
        activeVoice: this.activeVoiceCount,
        maxVoice: CONFIG.MAX_VOICE_ACTIVE,
        pttStates: this.pttStates.size,
        voiceStates: this.voiceStates.size
      };
    } catch {
      return { connections: 0, maxConnections: CONFIG.MAX_CONNECTIONS };
    }
  }

  // Consistency check and repair
  repairState() {
    try {
      // Repair activeVoiceCount
      let actualActive = 0;
      for (const [, data] of this.clients) {
        if (data.voiceActive) actualActive++;
      }
      if (this.activeVoiceCount !== actualActive) {
        Logger.warn(`Repaired activeVoiceCount: ${this.activeVoiceCount} -> ${actualActive}`);
        this.activeVoiceCount = actualActive;
      }

      // Repair gamertag index
      this.gamertagIndex.clear();
      for (const [ws, data] of this.clients) {
        this.gamertagIndex.set(data.gamertag, ws);
      }

      // Remove orphan states
      const validGamertags = new Set(this.getParticipants());
      for (const tag of this.pttStates.keys()) {
        if (!validGamertags.has(tag)) {
          this.pttStates.delete(tag);
        }
      }
      for (const tag of this.voiceStates.keys()) {
        if (!validGamertags.has(tag)) {
          this.voiceStates.delete(tag);
        }
      }

      Logger.info('State repair complete');
    } catch (e) {
      Logger.error('repairState error', e);
    }
  }
}

const stateManager = new StateManager();

// =====================================================
// EXPRESS APP (With error handling)
// =====================================================
const app = express();
const server = http.createServer(app);

// Error handling middleware
app.use((err, req, res, next) => {
  Logger.error('Express error', err);
  res.status(500).json({ error: 'Internal error' });
});

// Body parser with size limit
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

// Request error handler
app.use((req, res, next) => {
  req.on('error', (e) => Logger.error('Request error', e));
  res.on('error', (e) => Logger.error('Response error', e));
  next();
});

// CORS
app.use((req, res, next) => {
  try {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  } catch (e) {
    Logger.error('CORS error', e);
    next();
  }
});

// =====================================================
// WEBSOCKET SERVER (Ultra-resilient)
// =====================================================
const wss = new WebSocketServer({
  server,
  maxPayload: CONFIG.MAX_MESSAGE_SIZE,
  perMessageDeflate: false
});

// Safe send functions
function safeSend(ws, message) {
  try {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
      return true;
    }
  } catch (e) {
    Logger.error('safeSend error', e);
  }
  return false;
}

function broadcast(senderWs, message) {
  try {
    const msg = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client !== senderWs && client.readyState === 1) {
        try { client.send(msg); } catch { }
      }
    }
  } catch (e) {
    Logger.error('broadcast error', e);
  }
}

function broadcastToAll(message) {
  try {
    const msg = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try { client.send(msg); } catch { }
      }
    }
  } catch (e) {
    Logger.error('broadcastToAll error', e);
  }
}

// =====================================================
// TOKEN VALIDATION (Safe)
// =====================================================
async function validateToken(token) {
  try {
    if (!CONFIG.TOKEN_VALIDATION_ENABLED) {
      return { valid: true };
    }

    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return { valid: true };
    }

    if (!token || typeof token !== 'string' || token.length < 10) {
      return { valid: false, error: 'Invalid token format' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/validate_voice_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ p_token: token }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) return { valid: false, error: 'Validation failed' };
      return await response.json();
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  } catch (e) {
    Logger.error('Token validation error', e);
    return { valid: true }; // Fail open
  }
}

// =====================================================
// MESSAGE HANDLERS (Separated for clarity)
// =====================================================
const MessageHandlers = {
  async join(ws, data, clientId) {
    try {
      let isSuspended = false;
      let suspendMessage = null;

      // Token validation
      if (CONFIG.TOKEN_VALIDATION_ENABLED && data.token) {
        const validation = await validateToken(data.token);

        // Handle suspended access (48h expired)
        if (validation.valid && validation.suspended) {
          isSuspended = true;
          suspendMessage = validation.message || 'انتهت صلاحية الوصول المجاني. اختصر رابط لتجديد 48 ساعة.';
          Logger.info(`Suspended user connecting: token valid but access expired`);
        }

        if (!validation.valid) {
          safeSend(ws, { type: 'error', code: 'INVALID_TOKEN', message: 'Token غير صالح' });
          ws.close(1008, 'Invalid token');
          return { success: false };
        }

        // Store token for periodic checks
        ws._accessToken = data.token;
      }

      const result = stateManager.addClient(ws, data.gamertag);

      // If suspended, override voiceActive to false
      if (isSuspended) {
        const clientData = stateManager.getClient(ws);
        if (clientData) {
          clientData.voiceActive = false;
          clientData.forceMuted = true;
          clientData.isSuspended = true;
        }
      }

      Logger.success(`${result.gamertag} joined (${stateManager.connectionCount}/${CONFIG.MAX_CONNECTIONS}) voice=${!isSuspended && result.voiceActive} suspended=${isSuspended}`);

      // Confirmation with suspension info
      safeSend(ws, {
        type: 'join-confirmed',
        gamertag: result.gamertag,
        voiceActive: !isSuspended && result.voiceActive,
        forceMuted: isSuspended || !result.voiceActive,
        suspended: isSuspended,
        message: isSuspended ? suspendMessage : (result.voiceActive ? null : 'تم الوصول للحد الأقصى للصوت (50 لاعب). تم كتم صوتك تلقائياً.')
      });

      // If suspended, send separate suspension message for mod to display
      if (isSuspended) {
        safeSend(ws, {
          type: 'access-suspended',
          message: suspendMessage,
          expiresAt: null
        });
      }

      // Participants
      safeSend(ws, {
        type: 'participants-list',
        list: stateManager.getParticipants(),
        detailed: stateManager.getParticipantsWithStatus()
      });

      // Broadcast
      broadcast(ws, { type: 'join', gamertag: result.gamertag, voiceActive: !isSuspended && result.voiceActive });
      broadcast(ws, { type: 'participants-list', list: stateManager.getParticipants() });

      return { success: true, gamertag: result.gamertag, suspended: isSuspended };
    } catch (e) {
      const code = ['INVALID_GAMERTAG', 'GAMERTAG_IN_USE', 'INTERNAL_ERROR'].includes(e.message)
        ? e.message : 'INTERNAL_ERROR';

      const messages = {
        'INVALID_GAMERTAG': 'اسم لاعب غير صالح',
        'GAMERTAG_IN_USE': 'اسم اللاعب مستخدم بالفعل',
        'INTERNAL_ERROR': 'خطأ في الخادم'
      };

      safeSend(ws, { type: 'error', code, message: messages[code] });
      ws.close(1008, code);
      return { success: false };
    }
  },

  leave(ws) {
    try {
      const gamertag = stateManager.removeClient(ws);
      if (gamertag) {
        Logger.info(`${gamertag} left - ${stateManager.connectionCount} remaining`);
        broadcast(ws, { type: 'leave', gamertag });
        broadcast(ws, { type: 'participants-list', list: stateManager.getParticipants() });
      }
    } catch (e) {
      Logger.error('leave handler error', e);
    }
  },

  voiceDetection(ws, data) {
    try {
      // 1. Suspension Check
      const client = stateManager.getClient(ws);
      if (client && client.isSuspended) {
        // Optional: Send "You are muted" reminder if they try to talk
        return;
      }

      // 2. Data Validation
      if (typeof data.isTalking !== 'boolean' || typeof data.volume !== 'number') {
        Logger.warn(`Invalid voice data from ${data.gamertag}: ${JSON.stringify(data)}`);
        safeSend(ws, {
          type: 'voice-error',
          message: 'Invalid voice data format received by server.'
        });
        return;
      }

      // 3. Update State
      stateManager.updateVoiceState(data.gamertag, data.isTalking, data.volume);
    } catch (e) {
      Logger.error('voiceDetection error', e);
    }
  },

  pttStatus(ws, data) {
    try {
      if (stateManager.updatePttState(data.gamertag, data.isTalking, data.isMuted)) {
        broadcastToAll({
          type: 'ptt-update',
          gamertag: data.gamertag,
          isTalking: Sanitizer.boolean(data.isTalking),
          isMuted: Sanitizer.boolean(data.isMuted)
        });
      }
    } catch (e) {
      Logger.error('pttStatus error', e);
    }
  },

  webrtcSignaling(ws, data) {
    try {
      if (!data.to || !data.from) return;
      const target = stateManager.findClientByGamertag(data.to);
      if (target) {
        safeSend(target.ws, data);
      }
    } catch (e) {
      Logger.error('webrtcSignaling error', e);
    }
  },

  heartbeat(ws) {
    safeSend(ws, { type: 'heartbeat-ack' });
  },

  requestParticipants(ws) {
    safeSend(ws, {
      type: 'participants-list',
      list: stateManager.getParticipants()
    });
  },

  async checkAccess(ws, data) {
    try {
      if (!CONFIG.TOKEN_VALIDATION_ENABLED) return;

      const token = data.token || ws._accessToken;
      if (!token) return;

      const validation = await validateToken(token);

      const client = stateManager.getClient(ws);
      if (!client) return;

      const wasSuspended = client.isSuspended;
      const isNowSuspended = validation.valid && validation.suspended;

      // Update state
      if (client.isSuspended !== isNowSuspended) {
        client.isSuspended = isNowSuspended;
        client.voiceActive = !isNowSuspended && stateManager.canActivateVoice();
        client.forceMuted = isNowSuspended || !client.voiceActive;

        Logger.info(`Access status changed for ${client.gamertag}: suspended=${wasSuspended}->${isNowSuspended}`);

        if (wasSuspended && !isNowSuspended) {
          // RESTORED
          safeSend(ws, {
            type: 'access-restored',
            message: 'تم تجديد صلاحية الوصول! يمكنك التحدث الآن.'
          });

          // Broadcast update so others see him unmuted
          broadcast(ws, { type: 'join', gamertag: client.gamertag, voiceActive: client.voiceActive });
          broadcast(ws, { type: 'participants-list', list: stateManager.getParticipants() });

        } else if (!wasSuspended && isNowSuspended) {
          // SUSPENDED
          safeSend(ws, {
            type: 'access-suspended',
            message: validation.message || 'انتهت صلاحية الوصول المجاني.'
          });

          broadcast(ws, { type: 'participants-list', list: stateManager.getParticipants() });
        }
      }
    } catch (e) {
      Logger.error('checkAccess error', e);
    }
  }
};

// ... existing code ...

const MessageHandlers_Voice = {
  voiceDetection(ws, data) {
    try {
      // 1. Suspension Check
      const client = stateManager.getClient(ws);
      if (client && client.isSuspended) return;

      // 2. Data Validation
      if (typeof data.isTalking !== 'boolean' || typeof data.volume !== 'number') {
        safeSend(ws, {
          type: 'voice-error',
          message: 'Invalid voice data format.'
        });
        return;
      }

      // 3. Update State
      stateManager.updateVoiceState(data.gamertag, data.isTalking, data.volume);
    } catch (e) {
      Logger.error('voiceDetection error', e);
    }
  },

  pttStatus(ws, data) {
    try {
      // Ignore if suspended
      const client = stateManager.getClient(ws);
      if (client && client.isSuspended) return;

      if (stateManager.updatePttState(data.gamertag, data.isTalking, data.isMuted)) {
        broadcastToAll({
          type: 'ptt-update',
          gamertag: data.gamertag,
          isTalking: Sanitizer.boolean(data.isTalking),
          isMuted: Sanitizer.boolean(data.isMuted)
        });
      }
    } catch (e) {
      Logger.error('pttStatus error', e);
    }
  },

  webrtcSignaling(ws, data) {
    try {
      // Block signaling if suspended (cant speak/hear)
      const client = stateManager.getClient(ws);
      if (client && client.isSuspended) return;

      if (!data.to || !data.from) return;
      const target = stateManager.findClientByGamertag(data.to);
      if (target) {
        // Also don't send TO suspended users? typically yes
        // if (target.data.isSuspended) return; 
        safeSend(target.ws, data);
      }
    } catch (e) {
      Logger.error('webrtcSignaling error', e);
    }
  }
};

// Merge for the main object
Object.assign(MessageHandlers, MessageHandlers_Voice);

// =====================================================
// WEBSOCKET CONNECTION HANDLER
// =====================================================
wss.on("connection", (ws, req) => {
  let gamertag = null;
  let clientId = `c_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  try {
    // Capacity check
    if (!stateManager.canAcceptConnection()) {
      Logger.warn('Connection rejected: capacity');
      safeSend(ws, {
        type: 'error',
        code: 'SERVER_FULL',
        message: 'تم الوصول للحد الأقصى من اللاعبين (50). حاول لاحقاً.'
      });
      ws.close(1013, 'Server full');
      return;
    }
  } catch (e) {
    Logger.error('Connection init error', e);
  }

  // Message handler
  ws.on("message", async (msg) => {
    try {
      // Size check
      if (msg.length > CONFIG.MAX_MESSAGE_SIZE) {
        Logger.warn(`Oversized message: ${gamertag || clientId}`);
        return;
      }

      // Rate limit
      const rateCheck = rateLimiter.check(gamertag || clientId);
      if (!rateCheck.allowed) {
        if (rateCheck.banned || rateCheck.violations > 3) {
          safeSend(ws, { type: 'error', code: 'RATE_LIMITED', message: 'تم حظرك مؤقتاً' });
          ws.close(1008, 'Rate limited');
        }
        return;
      }

      // Parse
      const data = Sanitizer.message(JSON.parse(msg.toString()));
      if (!data) return;

      // Route to handler
      switch (data.type) {
        case 'join':
          const result = await MessageHandlers.join(ws, data, clientId);
          if (result.success) gamertag = result.gamertag;
          break;
        case 'leave':
          MessageHandlers.leave(ws);
          break;
        case 'voice-detection':
          MessageHandlers.voiceDetection(ws, data);
          break;
        case 'ptt-status':
          MessageHandlers.pttStatus(ws, data);
          break;
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          MessageHandlers.webrtcSignaling(ws, data);
          break;
        case 'heartbeat':
          MessageHandlers.heartbeat(ws);
          break;
        case 'request-participants':
          MessageHandlers.requestParticipants(ws);
          break;
        case 'check-access':
          MessageHandlers.checkAccess(ws, data);
          break;
        default:
          // Ignore unknown types silently
          break;
      }
    } catch (e) {
      Logger.error(`Message error (${gamertag || clientId})`, e);
    }
  });

  // Disconnect
  ws.on('close', () => {
    try {
      MessageHandlers.leave(ws);
    } catch { }
  });

  ws.on('error', (err) => {
    Logger.error(`WS error (${gamertag || clientId})`, err);
    try {
      MessageHandlers.leave(ws);
    } catch { }
  });
});

// WebSocket server error handling
wss.on('error', (err) => {
  Logger.error('WebSocket server error', err);
});

// =====================================================
// HTTP ENDPOINTS
// =====================================================
let minecraftData = null;

app.post("/minecraft-data", (req, res) => {
  try {
    minecraftData = req.body;

    const players = Array.isArray(minecraftData?.players) ? minecraftData.players : [];
    for (const player of players) {
      try {
        const gamertag = player?.name;
        if (!gamertag) continue;

        const data = player?.data || {};
        const clientInfo = stateManager.findClientByGamertag(gamertag);
        if (clientInfo?.data?.forceMuted) continue;

        stateManager.pttStates.set(gamertag, {
          isTalking: Sanitizer.boolean(data.isTalking),
          isMuted: Sanitizer.boolean(data.isMuted)
        });
        stateManager.voiceStates.set(gamertag, {
          isTalking: Sanitizer.boolean(data.isTalking),
          volume: Sanitizer.number(data.voiceVolume, -100, 0)
        });
      } catch { }
    }

    const pttStatesArray = Array.from(stateManager.pttStates.entries())
      .map(([g, s]) => ({ gamertag: g, ...s }));
    const voiceStatesArray = Array.from(stateManager.voiceStates.entries())
      .map(([g, s]) => ({ gamertag: g, ...s }));

    broadcastToAll({
      type: 'minecraft-update',
      data: minecraftData,
      pttStates: pttStatesArray,
      voiceStates: voiceStatesArray
    });

    res.json({ success: true, pttStates: pttStatesArray, voiceStates: voiceStatesArray });
  } catch (e) {
    Logger.error('minecraft-data error', e);
    res.status(500).json({ error: 'Processing error' });
  }
});

app.get("/health", (req, res) => {
  try {
    const mem = memoryMonitor.check();
    const stats = stateManager.getStats();

    res.json({
      status: mem.isEmergency ? 'emergency' : (mem.isCritical ? 'critical' : (mem.isLowMemory ? 'warning' : 'ok')),
      version: '4.0',
      connections: stats.connections,
      maxConnections: stats.maxConnections,
      activeVoice: stats.activeVoice,
      maxVoice: stats.maxVoice,
      memory: {
        heapMB: mem.heapMB,
        rssMB: mem.rssMB,
        limitMB: CONFIG.MEMORY_LIMIT_MB
      },
      uptime: Math.round(process.uptime())
    });
  } catch (e) {
    Logger.error('health error', e);
    res.status(500).json({ status: 'error' });
  }
});

app.get("/ptt-states", (req, res) => {
  try {
    const states = Array.from(stateManager.pttStates.entries())
      .map(([gamertag, state]) => ({ gamertag, ...state }));
    res.json({ pttStates: states });
  } catch (e) {
    res.status(500).json({ pttStates: [] });
  }
});

app.get("/voice-states", (req, res) => {
  try {
    const states = Array.from(stateManager.voiceStates.entries())
      .map(([gamertag, state]) => ({ gamertag, ...state }));
    res.json({ voiceStates: states });
  } catch (e) {
    res.status(500).json({ voiceStates: [] });
  }
});

// Repair endpoint (admin)
app.post("/admin/repair", (req, res) => {
  try {
    stateManager.repairState();
    rateLimiter.cleanup();
    memoryMonitor.forceGC();
    res.json({ success: true, message: 'Repair complete' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// BACKGROUND TASKS
// =====================================================

// Memory monitoring
setInterval(() => {
  try {
    const mem = memoryMonitor.check();

    if (mem.isEmergency) {
      Logger.warn(`🚨 EMERGENCY: ${mem.rssMB}MB`);
      memoryMonitor.emergencyCleanup();
    } else if (mem.isCritical) {
      Logger.warn(`⚠️ CRITICAL: ${mem.rssMB}MB`);
      memoryMonitor.forceGC();
      rateLimiter.cleanup();
    }
  } catch (e) {
    Logger.error('Memory monitor error', e);
  }
}, CONFIG.MEMORY_CHECK_INTERVAL);

// Rate limiter cleanup
setInterval(() => {
  try {
    rateLimiter.cleanup();
  } catch { }
}, CONFIG.RATE_LIMIT_CLEANUP);

// State consistency check (every 5 minutes)
setInterval(() => {
  try {
    stateManager.repairState();
  } catch { }
}, 300000);

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================
function gracefulShutdown(signal) {
  Logger.info(`Shutdown signal: ${signal}`);

  try {
    broadcastToAll({ type: 'server-shutdown' });
  } catch { }

  try {
    for (const client of wss.clients) {
      try { client.close(1001, 'Server shutdown'); } catch { }
    }
  } catch { }

  server.close(() => {
    Logger.success('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    Logger.warn('Forcing exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// =====================================================
// START SERVER
// =====================================================
const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
  Logger.error('Server error', err);
});

server.listen(PORT, () => {
  Logger.success(`EnviroVoice Server v4.0 - Ultra Resilient`);
  Logger.info(`Port: ${PORT}`);
  Logger.info(`Max: ${CONFIG.MAX_CONNECTIONS} connections, ${CONFIG.MAX_VOICE_ACTIVE} voice`);
  Logger.info(`Memory limit: ${CONFIG.MEMORY_LIMIT_MB}MB`);
  Logger.info(`Token validation: ${CONFIG.TOKEN_VALIDATION_ENABLED ? 'ON' : 'OFF'}`);
});
