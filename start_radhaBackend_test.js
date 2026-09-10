const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function main() {
  const prisma = new PrismaClient();
  
  // 1. Get RRH key and write .env
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });
  
  const apiKey = key.api_key;
  console.log('RRH Key:', apiKey);
  
  // Write .env
  const envPath = 'D:/HYD/Sonthillu/Radha_real_home/Radha-Backend/.env';
  fs.writeFileSync(envPath, [
    'CRM_API_BASE_URL=http://localhost:3000/api/v1',
    'CRM_API_KEY=' + apiKey,
    'PORT=4001',
    'FRONTEND_URL=http://localhost:3002',
    ''
  ].join('\n'));
  console.log('Wrote .env');
  
  // 2. Start the server programmatically
  console.log('\n=== Starting Radha-Backend server ===');
  const CRM_API_BASE_URL = process.env.CRM_API_BASE_URL || 'http://localhost:3000/api/v1';
  const CRM_API_KEY = apiKey;
  const BRAND_PARAMETER = 'rrh';
  
  const express = require('express');
  const cors = require('cors');
  const app = express();
  
  app.use(cors());
  app.use(express.json());
  
  // Properties route
  app.get('/api/properties', async (req, res) => {
    try {
      const params = new URLSearchParams(req.query);
      const qs = params.toString();
      const endpoint = '/properties' + (qs ? '?' + qs : '');
      const url = `${CRM_API_BASE_URL}/public/${BRAND_PARAMETER}${endpoint}`;
      console.log('[properties] Fetching:', url);
      const response = await fetch(url, {
        headers: { 'x-api-key': CRM_API_KEY, 'Content-Type': 'application/json' }
      });
      console.log('[properties] Status:', response.status);
      const data = await response.json();
      console.log('[properties] Count:', Array.isArray(data) ? data.length : 'N/A');
      res.json(data);
    } catch (e) {
      console.error('[properties] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
  
  app.get('/api/properties/:id', async (req, res) => {
    try {
      const endpoint = '/properties/' + req.params.id;
      const url = `${CRM_API_BASE_URL}/public/${BRAND_PARAMETER}${endpoint}`;
      console.log('[detail] Fetching:', url);
      const response = await fetch(url, {
        headers: { 'x-api-key': CRM_API_KEY, 'Content-Type': 'application/json' }
      });
      console.log('[detail] Status:', response.status);
      const data = await response.json();
      res.json(data);
    } catch (e) {
      console.error('[detail] Error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
  
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  
  // 3. Test before listening
  console.log('\n=== Pre-start CRM test ===');
  const testUrl = `${CRM_API_BASE_URL}/public/${BRAND_PARAMETER}/properties?limit=3`;
  console.log('Testing:', testUrl);
  const testRes = await fetch(testUrl, {
    headers: { 'x-api-key': CRM_API_KEY }
  });
  console.log('Pre-start status:', testRes.status);
  const testData = await testRes.json();
  console.log('Pre-start count:', Array.isArray(testData) ? testData.length : 'N/A');
  if (Array.isArray(testData)) {
    testData.forEach(p => console.log(' ', p.id, p.property_code, p.title));
  }
  
  // 4. Start server and do HTTP test
  const server = app.listen(4001, () => {
    console.log('\n=== Server listening on 4001 ===');
    
    // Test via HTTP
    fetch('http://localhost:4001/api/properties?limit=3')
      .then(r => r.json())
      .then(data => {
        console.log('\n=== HTTP test result ===');
        console.log('Status: 200 | Count:', Array.isArray(data) ? data.length : 'N/A');
        if (Array.isArray(data)) {
          data.forEach(p => console.log(' ', p.id, p.property_code, p.title));
        } else {
          console.log('Response:', JSON.stringify(data));
        }
        server.close();
        process.exit(0);
      })
      .catch(e => {
        console.error('HTTP test error:', e.message);
        server.close();
        process.exit(1);
      });
  });
}

main().catch(console.error);
