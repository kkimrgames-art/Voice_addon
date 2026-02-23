
const WebSocket = require('ws');

// Configuration
const SERVER_URL = 'ws://localhost:3000';
const PLAYER_NAME = 'RemoteBot';
const LOCATION = { x: 0, y: 80, z: 0 }; // Default spawn location

console.log(`🤖 Starting ${PLAYER_NAME}...`);
console.log(`📡 Connecting to ${SERVER_URL}`);

const ws = new WebSocket(SERVER_URL);
let isConnected = false;
let isTalking = false;

ws.on('open', () => {
    console.log('✅ Connected to server');
    
    // Join as a player
    ws.send(JSON.stringify({
        type: 'join',
        gamertag: PLAYER_NAME,
        token: 'fake-token'
    }));
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        if (msg.type === 'join-confirmed') {
            console.log('✅ Join confirmed! Starting simulation loop...');
            isConnected = true;
            startLoop();
        }
    } catch (e) {
        console.error('Error parsing message:', e);
    }
});

ws.on('error', (e) => console.error('Connection error:', e));
ws.on('close', () => console.log('Disconnected'));

function startLoop() {
    // Send position updates every 100ms
    setInterval(() => {
        if (!isConnected) return;

        // Simulate walking in a circle
        const time = Date.now() / 1000;
        const x = Math.sin(time) * 5;
        const z = Math.cos(time) * 5;

        const payload = {
            type: 'minecraft-data',
            players: [
                {
                    name: PLAYER_NAME,
                    location: { x: LOCATION.x + x, y: LOCATION.y, z: LOCATION.z + z },
                    data: { 
                        isTalking: isTalking, 
                        voiceVolume: isTalking ? -10 : -100,
                        isMuted: false,
                        isDeafened: false
                    }
                }
            ],
            config: { maxDistance: 30 }
        };

        ws.send(JSON.stringify(payload));
    }, 100);

    // Toggle talking every 3 seconds
    setInterval(() => {
        isTalking = !isTalking;
        console.log(isTalking ? '🗣️  Bot is TALKING' : 'Vm  Bot is SILENT');
        
        // Send explicit voice update for faster reaction
        if (isConnected) {
            ws.send(JSON.stringify({
                type: 'voice-detection',
                gamertag: PLAYER_NAME,
                isTalking: isTalking,
                volume: isTalking ? -10 : -100
            }));
        }
    }, 3000);
}
