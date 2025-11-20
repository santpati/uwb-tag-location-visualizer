#!/usr/bin/env node
/**
 * Optimized CORS Proxy with Server-Side Filtering
 * Only forwards relevant IoT telemetry events to reduce bandwidth and client load
 */

const http = require('http');
const https = require('https');

const PORT = 8081;
const FIREHOSE_ENDPOINT = 'https://partner.qa-dnaspaces.io/api/partners/v1/firehose/events';
const FIREHOSE_API_KEY = '9981B867E2B0456CB1F1909BD617982C';

// ===== FILTER CONFIGURATION =====
// Adjust these settings to control what events are sent to the client
const FILTER_CONFIG = {
    // Only forward these event types
    eventTypes: ['IOT_TELEMETRY'],
    
    // Only forward devices with MAC addresses starting with these prefixes
    // Set to [] or null to forward all devices
    macPrefixes: ['fc'],
    
    // Maximum events per second to send to client (rate limiting)
    maxEventsPerSecond: 10,
    
    // Send periodic keep-alive events to maintain connection
    sendKeepAlive: true,
    keepAliveIntervalMs: 30000,
    
    // Deduplicate rapid updates from the same device
    deduplicateWindowMs: 1000,  // Ignore updates within 1 second from same device
    
    // Minimum distance change (in meters) to forward update
    minDistanceChangeMeters: 0.5,
    
    // Log statistics every N seconds
    logIntervalSeconds: 10
};

const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    if (req.url !== '/firehose') {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    console.log('📡 New client connected');

    const options = {
        method: 'GET',
        headers: {
            'X-API-Key': FIREHOSE_API_KEY,
            'Accept': 'application/json'
        },
        agent: new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000
        })
    };

    const proxyReq = https.request(FIREHOSE_ENDPOINT, options, (proxyRes) => {
        console.log(`✅ Connected to Firehose API (${proxyRes.statusCode})`);
        console.log(`🔧 Filter: Event types=${FILTER_CONFIG.eventTypes.join(',')}, MAC prefixes=${FILTER_CONFIG.macPrefixes.join(',')}, Rate=${FILTER_CONFIG.maxEventsPerSecond}/sec`);

        res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Statistics
        let stats = {
            totalReceived: 0,
            totalForwarded: 0,
            byEventType: {},
            byDevice: {},
            startTime: Date.now()
        };

        // Tracking for deduplication and distance filtering
        const deviceLastSent = new Map(); // MAC -> { timestamp, lat, lng }
        
        // Event queue for rate limiting
        const eventQueue = [];
        let lastEventTime = 0;
        const minEventInterval = 1000 / FILTER_CONFIG.maxEventsPerSecond;

        // Keep-alive tracking
        let lastKeepAlive = Date.now();

        // Process event queue with rate limiting
        const queueInterval = setInterval(() => {
            if (eventQueue.length > 0) {
                const now = Date.now();
                if (now - lastEventTime >= minEventInterval) {
                    const event = eventQueue.shift();
                    try {
                        res.write(JSON.stringify(event) + '\n');
                        lastEventTime = now;
                        stats.totalForwarded++;
                    } catch (err) {
                        console.error('❌ Error writing event:', err.message);
                        clearInterval(queueInterval);
                        clearInterval(keepAliveInterval);
                        clearInterval(statsInterval);
                    }
                }
            }
        }, 50);

        // Keep-alive interval
        const keepAliveInterval = setInterval(() => {
            if (FILTER_CONFIG.sendKeepAlive && Date.now() - lastKeepAlive > FILTER_CONFIG.keepAliveIntervalMs) {
                try {
                    const keepAlive = {
                        eventType: 'KEEP_ALIVE',
                        timestamp: Date.now(),
                        stats: {
                            received: stats.totalReceived,
                            forwarded: stats.totalForwarded,
                            filterRate: ((stats.totalForwarded / stats.totalReceived) * 100).toFixed(2) + '%'
                        }
                    };
                    res.write(JSON.stringify(keepAlive) + '\n');
                    lastKeepAlive = Date.now();
                    console.log('💓 Sent keep-alive');
                } catch (err) {
                    console.error('Error sending keep-alive:', err.message);
                }
            }
        }, FILTER_CONFIG.keepAliveIntervalMs);

        // Statistics logging
        const statsInterval = setInterval(() => {
            const runtime = ((Date.now() - stats.startTime) / 1000).toFixed(0);
            const filterRate = stats.totalReceived > 0 
                ? ((stats.totalForwarded / stats.totalReceived) * 100).toFixed(1)
                : 0;
            console.log(`📊 [${runtime}s] Received: ${stats.totalReceived}, Forwarded: ${stats.totalForwarded} (${filterRate}%), Queue: ${eventQueue.length}`);
        }, FILTER_CONFIG.logIntervalSeconds * 1000);

        // Buffer for incomplete JSON lines
        let buffer = '';

        proxyRes.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            lines.forEach(line => {
                if (!line.trim()) return;

                try {
                    const event = JSON.parse(line);
                    stats.totalReceived++;

                    // Track event types
                    stats.byEventType[event.eventType] = (stats.byEventType[event.eventType] || 0) + 1;

                    // Filter: Check event type
                    if (!FILTER_CONFIG.eventTypes.includes(event.eventType)) {
                        return; // Skip this event
                    }

                    // Process IOT_TELEMETRY events
                    if (event.eventType === 'IOT_TELEMETRY') {
                        const telemetry = event.iotTelemetry || {};
                        const deviceInfo = telemetry.deviceInfo || {};
                        const position = telemetry.detectedPosition || {};
                        
                        const mac = deviceInfo.deviceMacAddress?.toLowerCase();
                        const lat = position.latitude;
                        const lng = position.longitude;

                        // Filter: Check if MAC matches allowed prefixes
                        if (FILTER_CONFIG.macPrefixes && FILTER_CONFIG.macPrefixes.length > 0) {
                            if (!mac || !FILTER_CONFIG.macPrefixes.some(prefix => mac.startsWith(prefix.toLowerCase()))) {
                                return; // Skip: MAC doesn't match filter
                            }
                        }

                        // Filter: Must have valid position
                        if (!lat || !lng) {
                            return; // Skip: No valid position
                        }

                        // Track by device
                        stats.byDevice[mac] = (stats.byDevice[mac] || 0) + 1;

                        // Deduplication: Check if we recently sent an update for this device
                        const now = Date.now();
                        const lastSent = deviceLastSent.get(mac);
                        
                        if (lastSent) {
                            // Check time-based deduplication
                            if (now - lastSent.timestamp < FILTER_CONFIG.deduplicateWindowMs) {
                                return; // Skip: Too soon since last update
                            }

                            // Check distance-based deduplication
                            if (FILTER_CONFIG.minDistanceChangeMeters > 0) {
                                const distance = calculateDistance(
                                    lastSent.lat, lastSent.lng,
                                    lat, lng
                                );
                                if (distance < FILTER_CONFIG.minDistanceChangeMeters) {
                                    return; // Skip: Device hasn't moved enough
                                }
                            }
                        }

                        // Update last sent tracking
                        deviceLastSent.set(mac, { timestamp: now, lat, lng });

                        // Add to queue for rate-limited sending
                        eventQueue.push(event);
                    }

                } catch (err) {
                    // Ignore malformed lines
                }
            });
        });

        proxyRes.on('end', () => {
            clearInterval(queueInterval);
            clearInterval(keepAliveInterval);
            clearInterval(statsInterval);
            
            console.log('🔚 Stream ended');
            console.log('📊 Final Statistics:');
            console.log(`   Total Received: ${stats.totalReceived}`);
            console.log(`   Total Forwarded: ${stats.totalForwarded}`);
            console.log(`   Filter Rate: ${((stats.totalForwarded / stats.totalReceived) * 100).toFixed(2)}%`);
            console.log(`   By Event Type:`, stats.byEventType);
            console.log(`   Unique Devices: ${Object.keys(stats.byDevice).length}`);
            
            res.end();
        });

        proxyRes.on('error', (err) => {
            clearInterval(queueInterval);
            clearInterval(keepAliveInterval);
            clearInterval(statsInterval);
            console.error('❌ Firehose error:', err.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
            }
            res.end(JSON.stringify({ error: err.message }));
        });
    });

    proxyReq.on('error', (err) => {
        console.error('❌ Proxy error:', err.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
        }
        res.end(JSON.stringify({ error: err.message }));
    });

    req.on('close', () => {
        console.log('👋 Client disconnected');
        proxyReq.destroy();
    });

    req.socket.setTimeout(0);
    proxyReq.end();
});

// Calculate distance between two GPS coordinates in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

server.setTimeout(0);
server.keepAliveTimeout = 0;

server.listen(PORT, 'localhost', () => {
    console.log('');
    console.log('='.repeat(70));
    console.log('🚀 Optimized Firehose Proxy with Server-Side Filtering');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Proxy URL:        http://localhost:${PORT}/firehose`);
    console.log(`Firehose API:     ${FIREHOSE_ENDPOINT}`);
    console.log('');
    console.log('Filter Configuration:');
    console.log(`  Event Types:    ${FILTER_CONFIG.eventTypes.join(', ')}`);
    console.log(`  MAC Prefixes:   ${FILTER_CONFIG.macPrefixes.length > 0 ? FILTER_CONFIG.macPrefixes.join(', ') : 'All'}`);
    console.log(`  Rate Limit:     ${FILTER_CONFIG.maxEventsPerSecond} events/sec`);
    console.log(`  Deduplicate:    ${FILTER_CONFIG.deduplicateWindowMs}ms window`);
    console.log(`  Min Distance:   ${FILTER_CONFIG.minDistanceChangeMeters}m`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
});
