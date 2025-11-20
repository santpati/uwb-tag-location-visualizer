#!/usr/bin/env node
/**
 * Optimized CORS Proxy with Server-Side Filtering
 * Only forwards relevant IoT telemetry events to reduce bandwidth
 */

const http = require('http');
const https = require('https');

const PORT = 8081;
const FIREHOSE_ENDPOINT = 'https://partner.qa-dnaspaces.io/api/partners/v1/firehose/events';
const FIREHOSE_API_KEY = '9981B867E2B0456CB1F1909BD617982C';

// Filter configuration - only forward events matching these criteria
const FILTER_CONFIG = {
    eventTypes: ['IOT_TELEMETRY'],           // Only IoT telemetry events
    macPrefixes: ['fc'],                      // Only MACs starting with 'fc'
    sendKeepAlive: true,                      // Send keep-alive every 30 seconds
    maxEventsPerSecond: 10                    // Rate limit to 10 events/second
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

        res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        let totalEvents = 0;
        let filteredEvents = 0;
        let buffer = '';
        let lastEventTime = 0;
        let lastKeepAlive = Date.now();
        
        const eventQueue = [];
        const minEventInterval = 1000 / FILTER_CONFIG.maxEventsPerSecond;

        // Process event queue with rate limiting
        const processQueue = () => {
            if (eventQueue.length > 0) {
                const event = eventQueue.shift();
                const now = Date.now();
                
                if (now - lastEventTime >= minEventInterval) {
                    try {
                        res.write(JSON.stringify(event) + '\n');
                        lastEventTime = now;
                    } catch (err) {
                        console.error('❌ Error writing event:', err.message);
                    }
                }
            }
        };

        // Process queue every 50ms
        const queueInterval = setInterval(processQueue, 50);

        // Keep-alive interval
        const keepAliveInterval = setInterval(() => {
            if (Date.now() - lastKeepAlive > 30000) {
                try {
                    res.write(JSON.stringify({ eventType: 'KEEP_ALIVE', timestamp: Date.now() }) + '\n');
                    lastKeepAlive = Date.now();
                    console.log('💓 Sent keep-alive');
                } catch (err) {
                    console.error('Error sending keep-alive:', err.message);
                }
            }
        }, 30000);

        proxyRes.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            lines.forEach(line => {
                if (!line.trim()) return;

                try {
                    const event = JSON.parse(line);
                    totalEvents++;

                    // Filter events
                    let shouldForward = false;

                    if (event.eventType === 'KEEP_ALIVE' && FILTER_CONFIG.sendKeepAlive) {
                        shouldForward = true;
                    } else if (event.eventType === 'IOT_TELEMETRY') {
                        const telemetry = event.iotTelemetry || {};
                        const deviceInfo = telemetry.deviceInfo || {};
                        const mac = deviceInfo.deviceMacAddress?.toLowerCase();

                        // Check if MAC matches filter
                        if (mac && FILTER_CONFIG.macPrefixes.some(prefix => mac.startsWith(prefix))) {
                            // Check if has valid position data
                            const position = telemetry.detectedPosition || {};
                            if (position.latitude && position.longitude) {
                                shouldForward = true;
                            }
                        }
                    }

                    if (shouldForward) {
                        eventQueue.push(event);
                        filteredEvents++;
                        
                        if (filteredEvents % 50 === 0) {
                            console.log(`📊 Filtered: ${filteredEvents}/${totalEvents} events (${((filteredEvents/totalEvents)*100).toFixed(1)}%)`);
                        }
                    }
                } catch (err) {
                    // Ignore parse errors for malformed lines
                }
            });
        });

        proxyRes.on('end', () => {
            clearInterval(queueInterval);
            clearInterval(keepAliveInterval);
            console.log(`🔚 Stream ended. Forwarded ${filteredEvents}/${totalEvents} events`);
            res.end();
        });

        proxyRes.on('error', (err) => {
            clearInterval(queueInterval);
            clearInterval(keepAliveInterval);
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

server.setTimeout(0);
server.keepAliveTimeout = 0;

server.listen(PORT, 'localhost', () => {
    console.log('');
    console.log('='.repeat(60));
    console.log('🚀 Optimized Firehose Proxy with Server-Side Filtering');
    console.log('='.repeat(60));
    console.log('');
    console.log(`Proxy URL:        http://localhost:${PORT}/firehose`);
    console.log(`Firehose API:     ${FIREHOSE_ENDPOINT}`);
    console.log('');
    console.log('Filters:');
    console.log(`  Event Types:    ${FILTER_CONFIG.eventTypes.join(', ')}`);
    console.log(`  MAC Prefixes:   ${FILTER_CONFIG.macPrefixes.join(', ')}`);
    console.log(`  Rate Limit:     ${FILTER_CONFIG.maxEventsPerSecond} events/sec`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    server.close(() => process.exit(0));
});
