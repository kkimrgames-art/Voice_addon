
const WebSocket = require('ws');

// Server Configuration
const SERVER_URL = 'ws://localhost:3000';
const TEST_TIMEOUT = 15000; // 15 seconds max

// Test Clients
const LISTENER_NAME = 'TestListener_AI';
const TALKER_NAME = 'TestTalker_AI';

// Results tracking
const results = {
    connection: false,
    minecraftData: false,
    voiceDetection: false,
    errors: []
};

console.log('🧪 STARTING ENVIROVOICE SYSTEM VERIFICATION');
console.log('=============================================');
console.log(`📡 Target Server: ${SERVER_URL}`);

// Create Clients
const listener = new WebSocket(SERVER_URL);
const talker = new WebSocket(SERVER_URL);

let listenerReady = false;
let talkerReady = false;

// --- Helper Functions ---
function log(msg) {
    const time = new Date().toISOString().slice(11, 19);
    console.log(`[${time}] ${msg}`);
}

function fail(reason) {
    log(`❌ FAILURE: ${reason}`);
    results.errors.push(reason);
}

function pass(testName) {
    log(`✅ SUCCESS: ${testName}`);
    results[testName] = true;
}

// --- Listener Logic ---
listener.on('open', () => {
    log(`Listener connected (${LISTENER_NAME})`);
    listener.send(JSON.stringify({
        type: 'join',
        gamertag: LISTENER_NAME,
        token: ''
    }));
});

listener.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        
        if (msg.type === 'join-confirmed') {
            listenerReady = true;
            checkReady();
        } 
        else if (msg.type === 'voice-update') {
            const gamertag = msg.gamertag;
            const isTalking = msg.isTalking;
            const volume = msg.volume;
            
            log(`🔊 Listener received voice-update from ${gamertag}: Talking=${isTalking}, Vol=${volume}`);
            
            if (gamertag === TALKER_NAME && isTalking) {
                // Distinguish between tests based on volume
                // Test 1: Minecraft Data (Volume -10)
                if (Math.abs(volume - (-10)) < 1 && !results.minecraftData) {
                    pass('minecraftData');
                    stopMinecraftDataTest();
                    setTimeout(runVoiceDetectionTest, 1000);
                } 
                // Test 2: Voice Detection (Volume -30) - Must be > 5 diff from -10
                else if (Math.abs(volume - (-30)) < 1 && !results.voiceDetection) {
                    pass('voiceDetection');
                    finishTest();
                }
            }
        }
    } catch (e) {
        fail(`Listener parse error: ${e.message}`);
    }
});

// --- Talker Logic ---
talker.on('open', () => {
    log(`Talker connected (${TALKER_NAME})`);
    talker.send(JSON.stringify({
        type: 'join',
        gamertag: TALKER_NAME,
        token: ''
    }));
});

talker.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        if (msg.type === 'join-confirmed') {
            talkerReady = true;
            checkReady();
        }
    } catch (e) {
        fail(`Talker parse error: ${e.message}`);
    }
});

// --- Test Orchestration ---
let minecraftDataInterval = null;

function checkReady() {
    if (listenerReady && talkerReady) {
        if (!results.connection) {
            results.connection = true; // Mark silently to avoid double-pass
            pass('connection');
            runMinecraftDataTest();
        }
    }
}

function runMinecraftDataTest() {
    log('\n--- TEST 1: Voice via Minecraft Data (Proximity) ---');
    log('Sending minecraft-data packet with Talker close to Listener (Vol -10)...');
    
    const payload = {
        type: 'minecraft-data',
        players: [
            {
                name: LISTENER_NAME,
                location: { x: 0, y: 60, z: 0 },
                data: { isTalking: false, voiceVolume: -100 }
            },
            {
                name: TALKER_NAME,
                location: { x: 2, y: 60, z: 0 },
                data: { isTalking: true, voiceVolume: -10 } // Volume -10
            }
        ],
        config: { maxDistance: 15 }
    };
    
    // Send periodically
    minecraftDataInterval = setInterval(() => {
        if (talker.readyState === WebSocket.OPEN) {
            talker.send(JSON.stringify(payload));
        }
    }, 500);
}

function stopMinecraftDataTest() {
    if (minecraftDataInterval) {
        clearInterval(minecraftDataInterval);
        minecraftDataInterval = null;
    }
}

function runVoiceDetectionTest() {
    log('\n--- TEST 2: Direct Voice Detection Packet ---');
    log('Sending voice-detection packet (Vol -30)...');
    
    const payload = {
        type: 'voice-detection',
        gamertag: TALKER_NAME,
        isTalking: true,
        volume: -30 // Distinct volume, > 5 diff from -10
    };
    
    if (talker.readyState === WebSocket.OPEN) {
        talker.send(JSON.stringify(payload));
    }
}

function finishTest() {
    log('\n=============================================');
    log('🏁 TEST COMPLETE');
    
    if (results.connection && results.minecraftData && results.voiceDetection) {
        console.log('\n✅ OVERALL RESULT: PASSED');
        console.log('The voice system is fully operational.');
        process.exit(0);
    } else {
        console.log('\n❌ OVERALL RESULT: FAILED');
        console.log('Failed steps:', results.errors);
        process.exit(1);
    }
}

// Timeout
setTimeout(() => {
    if (!results.connection || !results.minecraftData || !results.voiceDetection) {
        fail('Test timed out');
        finishTest();
    }
}, TEST_TIMEOUT);

// Error Handling
listener.on('error', (e) => fail(`Listener error: ${e.message}`));
talker.on('error', (e) => fail(`Talker error: ${e.message}`));

