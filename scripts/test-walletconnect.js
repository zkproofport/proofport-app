#!/usr/bin/env node

/**
 * WalletConnect Relay Connection Test Script
 *
 * Usage:
 *   node scripts/test-walletconnect.js <projectId>
 *   node scripts/test-walletconnect.js  # Uses default projectId
 */

const { generateKeyPair, signJWT } = require('@walletconnect/relay-auth');
const { execSync } = require('child_process');

const DEFAULT_PROJECT_ID = '9a54a0419fc6c86a2bde3d44c4f1615c';
const RELAY_URL = 'relay.walletconnect.com';

async function testWalletConnect(projectId) {
  console.log('='.repeat(60));
  console.log('WalletConnect Relay Connection Test');
  console.log('='.repeat(60));
  console.log(`Project ID: ${projectId}`);
  console.log(`Relay URL: wss://${RELAY_URL}`);
  console.log('');

  // 1. Generate JWT
  console.log('[1/3] Generating JWT...');
  const keyPair = generateKeyPair();
  const jwt = await signJWT(projectId, `wss://${RELAY_URL}`, 3600, keyPair);
  console.log(`Done (valid for 1 hour)`);
  console.log(`  Length: ${jwt.length} chars`);
  console.log('');

  // 2. Check current IP
  console.log('[2/3] Checking current IP...');
  try {
    const ipInfo = execSync('curl -s https://ipinfo.io/json', {
      encoding: 'utf-8',
    });
    const ip = JSON.parse(ipInfo);
    console.log(`IP: ${ip.ip}`);
    console.log(`  Location: ${ip.city}, ${ip.region}, ${ip.country}`);
    console.log(`  Org: ${ip.org}`);
  } catch (e) {
    console.log('Failed to check IP');
  }
  console.log('');

  // 3. Test Relay connection
  console.log('[3/3] Testing Relay connection...');

  const curlCommand = `curl -s -w "\\n__HTTP_CODE__:%{http_code}" \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Authorization: Bearer ${jwt}" \
    "https://${RELAY_URL}/?projectId=${projectId}"`;

  console.log(`${curlCommand}`);

  try {
    const result = execSync(curlCommand, { encoding: 'utf-8' });
    const lines = result.split('__HTTP_CODE__:');
    const body = lines[0].trim();
    const httpCode = lines[1]?.trim();

    console.log(`HTTP Status: ${httpCode}`);
    console.log(`Response: ${body}`);
    console.log('');

    // Interpret results
    console.log('='.repeat(60));
    console.log('Analysis:');
    console.log('='.repeat(60));

    if (httpCode === '101') {
      console.log('SUCCESS! WebSocket upgrade complete');
      console.log('   Project is properly activated.');
    } else if (httpCode === '401') {
      const error = JSON.parse(body);
      if (error.error?.includes('JWT')) {
        console.log('JWT authentication failed');
        console.log('   - JWT is missing or expired');
        console.log('   - Project ID may not exist');
      } else {
        console.log(`Auth failed: ${error.error}`);
      }
    } else if (httpCode === '403') {
      const error = JSON.parse(body);
      if (error.error === 'Project not found') {
        console.log('Project not found');
        console.log('   Possible causes:');
        console.log('   - Project not properly registered in Reown Cloud');
        console.log('   - Incorrect project settings (App ID, domain, etc.)');
        console.log('   - Reown infrastructure issue');
      } else {
        console.log(`Access denied: ${error.error}`);
      }
    } else {
      console.log(`Unexpected response: HTTP ${httpCode}`);
    }
  } catch (e) {
    console.log('Connection failed:', e.message);
  }

  console.log('');
  console.log('='.repeat(60));

  // Output JWT for debugging
  console.log('');
  console.log('Debug curl command:');
  console.log('-'.repeat(60));
  console.log(
    `curl -v -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Authorization: Bearer ${jwt}" "https://${RELAY_URL}/?projectId=${projectId}"`,
  );
}

// Execute
const projectId = process.argv[2] || DEFAULT_PROJECT_ID;
testWalletConnect(projectId).catch(console.error);
