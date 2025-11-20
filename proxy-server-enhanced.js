#!/usr/bin/env node
/**
 * Enhanced CORS Proxy Server for Cisco Spaces Firehose API
 * With better error handling and keep-alive support
 */

const http = require('http');
const https = require('https');

const PORT = 8081;
const FIREHOSE_ENDPOINT = 'https://partner.qa-dnaspaces.io/api/partners/v1/firehose/events';
const FIREHOSE_API_KEY = '9981B867E2B0456CB1F1909BD617982C';

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

  // Only handle /firehose endpoint
  if (req.url !== '/firehose') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  console.log('📡 New client connected from:', req.socket.remoteAddress);

  // Proxy request to Firehose API
  const options = {
    method: 'GET',
    headers: {
      'X-API-Key': FIREHOSE_API_KEY,
      'Accept': 'application/json'
    },
    // Keep connection alive
    agent: new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000
    })
  };

  const proxyReq = https.request(FIREHOSE_ENDPOINT, options, (proxyRes) => {
    console.log(`✅ Connected to Firehose API (${proxyRes.statusCode})`);

    // Forward headers to client with CORS
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'Transfer-Encoding': 'chunked'
    });

    let eventCount = 0;
    let lastLogTime = Date.now();

    // Stream data from Firehose to client
    proxyRes.on('data', (chunk) => {
      try {
        // Immediately write to client
        const written = res.write(chunk);
        
        if (!written) {
          console.warn('⚠️  Client buffer full, pausing upstream...');
          proxyRes.pause();
          res.once('drain', () => {
            console.log('✅ Client buffer drained, resuming...');
            proxyRes.resume();
          });
        }

        // Count events (throttle logging)
        eventCount += chunk.toString().split('\n').filter(line => line.trim()).length;
        const now = Date.now();
        if (now - lastLogTime > 2000) { // Log every 2 seconds
          console.log(`📊 Streamed ${eventCount} events...`);
          lastLogTime = now;
        }
      } catch (err) {
        console.error('❌ Error writing to client:', err.message);
        proxyReq.destroy();
      }
    });

    proxyRes.on('end', () => {
      console.log(`🔚 Firehose stream ended. Total events: ${eventCount}`);
      try {
        res.end();
      } catch (err) {
        console.error('Error ending response:', err.message);
      }
    });

    proxyRes.on('error', (err) => {
      console.error('❌ Firehose error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
      }
      try {
        res.end(JSON.stringify({ error: err.message }));
      } catch (e) {
        console.error('Error sending error response:', e.message);
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('❌ Proxy request error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
    }
    try {
      res.end(JSON.stringify({ error: err.message }));
    } catch (e) {
      console.error('Error sending error response:', e.message);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    console.log('👋 Client disconnected');
    proxyReq.destroy();
  });

  req.on('error', (err) => {
    console.error('❌ Client request error:', err.message);
    proxyReq.destroy();
  });

  // Set socket timeout
  req.socket.setTimeout(0); // No timeout for streaming

  proxyReq.end();
});

// Increase server timeout for long-lived connections
server.setTimeout(0);
server.keepAliveTimeout = 0;

server.listen(PORT, 'localhost', () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('🚀 Enhanced CORS Proxy Server for Cisco Spaces Firehose API');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Proxy URL:      http://localhost:${PORT}/firehose`);
  console.log(`Firehose API:   ${FIREHOSE_ENDPOINT}`);
  console.log(`API Key:        ${FIREHOSE_API_KEY.substring(0, 8)}...`);
  console.log('');
  console.log('Features:');
  console.log('  ✓ Keep-alive connections');
  console.log('  ✓ Backpressure handling');
  console.log('  ✓ Enhanced error logging');
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down proxy server...');
  server.close(() => {
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});
