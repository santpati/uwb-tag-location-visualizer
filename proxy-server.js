#!/usr/bin/env node
/**
 * CORS Proxy Server for Cisco Spaces Firehose API
 * Allows browser-based apps to access the Firehose API
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

  console.log('📡 New client connected');

  // Proxy request to Firehose API
  const options = {
    method: 'GET',
    headers: {
      'X-API-Key': FIREHOSE_API_KEY,
      'Accept': 'application/json'
    }
  };

  const proxyReq = https.request(FIREHOSE_ENDPOINT, options, (proxyRes) => {
    console.log(`✅ Connected to Firehose API (${proxyRes.statusCode})`);

    // Forward headers to client with CORS
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    let eventCount = 0;

    // Stream data from Firehose to client
    proxyRes.on('data', (chunk) => {
      res.write(chunk);

      // Count events
      eventCount += chunk.toString().split('\n').length - 1;
      if (eventCount % 10 === 0 && eventCount > 0) {
        console.log(`📊 Streamed ${eventCount} events...`);
      }
    });

    proxyRes.on('end', () => {
      console.log('🔚 Firehose stream ended');
      res.end();
    });

    proxyRes.on('error', (err) => {
      console.error('❌ Firehose error:', err.message);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error('❌ Proxy error:', err.message);
    res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: err.message }));
  });

  // Handle client disconnect
  req.on('close', () => {
    console.log('👋 Client disconnected');
    proxyReq.destroy();
  });

  proxyReq.end();
});

server.listen(PORT, 'localhost', () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('🚀 CORS Proxy Server for Cisco Spaces Firehose API');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Proxy URL:      http://localhost:${PORT}/firehose`);
  console.log(`Firehose API:   ${FIREHOSE_ENDPOINT}`);
  console.log(`API Key:        ${FIREHOSE_API_KEY.substring(0, 8)}...`);
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
