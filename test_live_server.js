const WebSocket = require('ws');

// Server URL from user logs
const SERVER_URL = 'ws://localhost:3000';
const TEST_DURATION = 10000; // 10 seconds

console.log('🧪 Starting Voice System Verification Test...');
console.log(`📡 Connecting to: ${SERVER_URL}`);

// Client A: Listener
const clientA = new WebSocket(SERVER_URL);
let clientAConnected = false;
let receivedVoiceUpdate = false;

// Client B: Talker (Sends data)
const clientB = new WebSocket(SERVER_URL);
let clientBConnected = false;

// Helper to log with timestamp
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// Client A Handler
clientA.on('open', () => {
  log('✅ Client A (Listener) connected');
  clientA.send(JSON.stringify({
    type: 'join',
    gamertag: 'TestListener_AI',
    token: ''
  }));
});

clientA.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    if (msg.type === 'join-confirmed') {
      log('✅ Client A joined as TestListener_AI');
      clientAConnected = true;
    } else if (msg.type === 'voice-update') {
      log(`🔊 Client A received VOICE UPDATE from ${msg.gamertag}: Talking=${msg.isTalking}, Volume=${msg.volume}`);
      if (msg.gamertag === 'TestTalker_AI' && msg.isTalking) {
        receivedVoiceUpdate = true;
        log('🎉 SUCCESS: Voice broadcasting verified! Listener heard Talker.');
      }
    }
  } catch (e) {
    log(`❌ Client A Error parsing message: ${e.message}`);
  }
});

// Client B Handler
clientB.on('open', () => {
  log('✅ Client B (Talker) connected');
  clientB.send(JSON.stringify({
    type: 'join',
    gamertag: 'TestTalker_AI',
    token: ''
  }));
});

clientB.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    if (msg.type === 'join-confirmed') {
      log('✅ Client B joined as TestTalker_AI');
      clientBConnected = true;
      
      // Start sending proximity data
      startSimulation();
    }
  } catch (e) {
    log(`❌ Client B Error parsing message: ${e.message}`);
  }
});

function startSimulation() {
  log('🚀 Starting Proximity Simulation...');
  
  // Interval to send data every 100ms
  const interval = setInterval(() => {
    if (!clientBConnected || !clientAConnected) return;

    // Simulate Talker being close to Listener (Distance = 2 blocks)
    const payload = {
      type: 'minecraft-data',
      players: [
        {
          name: 'TestListener_AI',
          location: { x: 0, y: 60, z: 0 },
          data: { isTalking: false, voiceVolume: -100, isMuted: false, isDeafened: false }
        },
        {
          name: 'TestTalker_AI',
          location: { x: 2, y: 60, z: 0 },
          data: { isTalking: true, voiceVolume: 100, isMuted: false, isDeafened: false } // Talking loudly
        }
      ],
      config: { maxDistance: 15 }
    };

    clientB.send(JSON.stringify(payload));
  }, 500); // Send every 500ms

  // Stop after test duration
  setTimeout(() => {
    clearInterval(interval);
    finishTest();
  }, 5000);
}

function finishTest() {
  log('🏁 Test Completed.');
  clientA.close();
  clientB.close();

  if (receivedVoiceUpdate) {
    console.log('\n✅ VERIFICATION RESULT: SYSTEM IS WORKING');
    console.log('   - Server is reachable.');
    console.log('   - Clients can join.');
    console.log('   - Proximity logic is functioning (Listener heard Talker).');
  } else {
    console.log('\n❌ VERIFICATION RESULT: SYSTEM FAILED');
    console.log('   - Did not receive voice update packet.');
    console.log('   - Check server logs or firewall.');
  }
  process.exit(receivedVoiceUpdate ? 0 : 1);
}

// Global error handlers
clientA.on('error', (e) => log(`❌ Client A Error: ${e.message}`));
clientB.on('error', (e) => log(`❌ Client B Error: ${e.message}`));
