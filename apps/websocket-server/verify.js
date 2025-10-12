#!/usr/bin/env node
/**
 * Comprehensive WebSocket Server Verification Script
 * Tests all functionality to ensure everything works
 */

const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:8787/ws';
const HTTP_URL = 'http://127.0.0.1:8787';

console.log('🧪 WebSocket Server Verification');
console.log('='.repeat(50));

async function testHTTPEndpoints() {
  console.log('\n📡 Testing HTTP Endpoints...\n');
  
  // Test root
  const root = await fetch(HTTP_URL);
  const rootData = await root.json();
  console.log('✅ GET / -', rootData.service);
  
  // Test health
  const health = await fetch(`${HTTP_URL}/health`);
  const healthData = await health.json();
  console.log('✅ GET /health -', healthData.status);
  
  // Test stats
  const stats = await fetch(`${HTTP_URL}/stats`);
  const statsData = await stats.json();
  console.log('✅ GET /stats - connections:', statsData.connections);
  
  // Test broadcast
  const broadcast = await fetch(`${HTTP_URL}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'test:verify',
      message: { type: 'test', data: 'verification' }
    })
  });
  const broadcastData = await broadcast.json();
  console.log('✅ POST /broadcast -', broadcastData.success ? 'Success' : 'Failed');
}

function testWebSocket() {
  return new Promise((resolve) => {
    console.log('\n🔌 Testing WebSocket Connection...\n');
    
    const ws = new WebSocket(WS_URL);
    const tests = {
      connected: false,
      acknowledged: false,
      ping: false,
      authRequired: false
    };
    
    ws.on('open', () => {
      tests.connected = true;
      console.log('✅ Connection established');
      
      // Send ping
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      
      // Try subscribe without auth
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'subscribe', channel: 'test:123' }));
      }, 500);
      
      // Close after tests
      setTimeout(() => {
        ws.close();
      }, 1500);
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'connection_acknowledged') {
        tests.acknowledged = true;
        console.log('✅ Connection acknowledged, sessionId:', msg.sessionId);
      } else if (msg.type === 'pong') {
        tests.ping = true;
        console.log('✅ Ping/pong working');
      } else if (msg.type === 'error' && msg.code === 'AUTH_REQUIRED') {
        tests.authRequired = true;
        console.log('✅ Authentication enforcement working');
      }
    });
    
    ws.on('close', () => {
      console.log('\n📊 Test Results:');
      console.log('  Connected:', tests.connected ? '✅' : '❌');
      console.log('  Acknowledged:', tests.acknowledged ? '✅' : '❌');
      console.log('  Ping/Pong:', tests.ping ? '✅' : '❌');
      console.log('  Auth Required:', tests.authRequired ? '✅' : '❌');
      
      const allPassed = Object.values(tests).every(v => v);
      console.log('\n' + (allPassed ? '✅ All tests passed!' : '❌ Some tests failed'));
      
      resolve(allPassed);
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      resolve(false);
    });
  });
}

async function main() {
  try {
    await testHTTPEndpoints();
    const wsResult = await testWebSocket();
    
    console.log('\n' + '='.repeat(50));
    console.log(wsResult ? '✅ VERIFICATION COMPLETE - ALL SYSTEMS OPERATIONAL' : '❌ VERIFICATION FAILED');
    console.log('='.repeat(50) + '\n');
    
    process.exit(wsResult ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  }
}

main();
