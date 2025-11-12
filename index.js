const express = require('express');
const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2');

const app = express();
const port = 3000;

// ============ KONFIGURASI DATABASE ============
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',           
  password: '@nnisa041204',           
  database: 'apikey_db',  
  port: 3309,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Konversi ke promise untuk async/await
const db = pool.promise();

// Test koneksi database saat server start
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.log('⚠️  Server berjalan tanpa database. Pastikan MySQL sudah running!');
  } else {
    console.log('✅ Database connected successfully');
    connection.release();
  }
});

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(express.static('public'));

// ============ ROUTES ============

// arahkan root ke index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// endpoint untuk membuat API key (server-generated) + simpan ke DB
app.post('/create', async (req, res) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString(36);
    const random = crypto.randomBytes(32).toString('base64url');
    const apiKey = `sk-itumy-v1-${timestamp}_${random}`;
    
    // Simpan ke database
    try {
      await db.query(
        'INSERT INTO api_keys (api_key, key_type) VALUES (?, ?)',
        [apiKey, 'server']
      );
      
      res.json({ 
        success: true,
        apiKey,
        message: 'API key created and saved to database'
      });
    } catch (dbError) {
      // Jika database gagal, tetap return API key tapi tanpa save
      console.warn('Database save failed:', dbError.message);
      res.json({ 
        success: true,
        apiKey,
        message: 'API key created (database save failed)',
        warning: 'Key not saved to database'
      });
    }
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create API key',
      details: error.message
    });
  }
});

// endpoint untuk save client-generated key
app.post('/save-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ 
        success: false,
        error: 'API key is required' 
      });
    }
    
    // Cek apakah key sudah ada
    const [existing] = await db.query(
      'SELECT id FROM api_keys WHERE api_key = ?',
      [apiKey]
    );
    
    if (existing.length > 0) {
      return res.json({ 
        success: true,
        message: 'API key already exists in database',
        duplicate: true
      });
    }
    
    // Simpan ke database
    await db.query(
      'INSERT INTO api_keys (api_key, key_type) VALUES (?, ?)',
      [apiKey, 'client']
    );
    
    res.json({ 
      success: true,
      message: 'API key saved to database'
    });
  } catch (error) {
    console.error('Error saving API key:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to save API key',
      details: error.message
    });
  }
});

// endpoint untuk validasi API key
app.post('/validate', async (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey) {
    return res.status(400).json({ 
      valid: false, 
      error: 'API key is required' 
    });
  }
  
  try {
    // Cari di database dulu
    const [rows] = await db.query(
      'SELECT * FROM api_keys WHERE api_key = ? AND is_active = TRUE',
      [apiKey]
    );
    
    if (rows.length > 0) {
      const keyData = rows[0];
      
      // Update last_used
      await db.query(
        'UPDATE api_keys SET last_used = NOW() WHERE id = ?',
        [keyData.id]
      ).catch(err => console.warn('Failed to update last_used:', err.message));
      
      return res.json({ 
        valid: true,
        source: 'database',
        data: {
          id: keyData.id,
          apiKey: keyData.api_key,
          keyType: keyData.key_type,
          createdAt: keyData.created_at,
          lastUsed: new Date(),
          isActive: keyData.is_active
        }
      });
    }
  } catch (dbError) {
    console.warn('Database check failed:', dbError.message);
    // Lanjut ke validasi format jika database gagal
  }
  
  // Fallback: cek format API key jika tidak ada di database
  const serverKeyPattern = /^sk-itumy-v1-[a-z0-9]+_[A-Za-z0-9_-]+$/;
  const clientKeyPattern = /^[A-Za-z0-9]{32}$/;
  
  const isServerKey = serverKeyPattern.test(apiKey);
  const isClientKey = clientKeyPattern.test(apiKey);
  
  if (isServerKey) {
    try {
      const parts = apiKey.split('-');
      const timestampPart = parts[3].split('_')[0];
      const timestamp = parseInt(timestampPart, 36) * 1000;
      const createdAt = new Date(timestamp).toISOString();
      
      return res.json({ 
        valid: true, 
        source: 'format-check',
        createdAt,
        format: 'sk-itumy-v1-{timestamp}_{random}',
        warning: 'Not found in database, validated by format only'
      });
    } catch (error) {
      return res.json({ 
        valid: false, 
        error: 'Invalid API key format' 
      });
    }
  }
  
  if (isClientKey) {
    return res.json({ 
      valid: true, 
      source: 'format-check',
      format: '32-character alphanumeric',
      warning: 'Not found in database, validated by format only'
    });
  }
  
  res.json({ 
    valid: false, 
    error: 'Invalid API key format' 
  });
});

// endpoint checkapi - untuk testing di Postman
app.post('/checkapi', async (req, res) => {
  // Bisa ambil dari body, header, atau query
  let apiKey = req.body.apiKey || req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(400).json({ 
      success: false,
      valid: false, 
      message: 'API key tidak ditemukan',
      hint: 'Kirim API key di body (apiKey), header (x-api-key), atau query (?apiKey=xxx)'
    });
  }
  
  try {
    // Cek di database dulu
    const [rows] = await db.query(
      'SELECT * FROM api_keys WHERE api_key = ?',
      [apiKey]
    );
    
    if (rows.length > 0) {
      const keyData = rows[0];
      
      if (!keyData.is_active) {
        return res.status(403).json({ 
          success: false,
          valid: false, 
          message: 'API key sudah tidak aktif'
        });
      }
      
      // Update last_used
      await db.query(
        'UPDATE api_keys SET last_used = NOW() WHERE id = ?',
        [keyData.id]
      ).catch(err => console.warn('Failed to update last_used:', err.message));
      
      const now = new Date();
      const createdAt = new Date(keyData.created_at);
      const ageInDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
      
      return res.json({ 
        success: true,
        valid: true, 
        source: 'database',
        message: 'API key valid (from database)',
        data: {
          id: keyData.id,
          apiKey: keyData.api_key,
          keyType: keyData.key_type,
          createdAt: keyData.created_at,
          lastUsed: keyData.last_used,
          isActive: keyData.is_active,
          age: {
            days: ageInDays,
            hours: Math.floor((now - createdAt) / (1000 * 60 * 60)),
            readable: ageInDays === 0 ? 'Today' : `${ageInDays} day(s) ago`
          }
        }
      });
    }
  } catch (dbError) {
    console.warn('Database check failed:', dbError.message);
    // Lanjut ke validasi format
  }
  
  // Fallback: cek format API key
  const serverKeyPattern = /^sk-itumy-v1-[a-z0-9]+_[A-Za-z0-9_-]+$/;
  const clientKeyPattern = /^[A-Za-z0-9]{32}$/;
  
  const isServerKey = serverKeyPattern.test(apiKey);
  const isClientKey = clientKeyPattern.test(apiKey);
  
  if (!isServerKey && !isClientKey) {
    return res.status(401).json({ 
      success: false,
      valid: false, 
      message: 'Format API key tidak valid',
      apiKey: apiKey,
      acceptedFormats: {
        server: 'sk-itumy-v1-{timestamp}_{random}',
        client: '32 karakter alphanumeric (A-Za-z0-9)'
      }
    });
  }
  
  // Jika format client key (dari HTML)
  if (isClientKey) {
    return res.json({
      success: true,
      valid: true,
      source: 'format-check',
      message: 'API key valid (Client Generated) - not in database',
      data: {
        apiKey: apiKey,
        type: 'client-generated',
        format: 'Simple 32-character key',
        keyLength: apiKey.length,
        generatedFrom: 'HTML Frontend',
        warning: 'Not found in database, validated by format only'
      }
    });
  }
  
  // extract informasi dari API key (server key)
  try {
    const parts = apiKey.split('-');
    const timestampPart = parts[3].split('_')[0];
    const randomPart = parts[3].split('_')[1];
    const timestamp = parseInt(timestampPart, 36) * 1000;
    const createdAt = new Date(timestamp);
    const now = new Date();
    const ageInDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    
    res.json({ 
      success: true,
      valid: true,
      source: 'format-check',
      message: 'API key valid (format check) - not in database',
      data: {
        apiKey: apiKey,
        prefix: 'sk-itumy-v1',
        createdAt: createdAt.toISOString(),
        age: {
          days: ageInDays,
          hours: Math.floor((now - createdAt) / (1000 * 60 * 60)),
          readable: ageInDays === 0 ? 'Today' : `${ageInDays} day(s) ago`
        },
        keyLength: apiKey.length,
        randomPartLength: randomPart.length,
        warning: 'Not found in database, validated by format only'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      valid: false,
      message: 'Error saat memproses API key',
      error: error.message
    });
  }
});

// endpoint untuk list semua keys
app.get('/keys', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, api_key, key_type, created_at, last_used, is_active FROM api_keys ORDER BY created_at DESC LIMIT 100'
    );
    
    res.json({ 
      success: true,
      count: rows.length,
      keys: rows
    });
  } catch (error) {
    console.error('Error fetching keys:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch keys',
      details: error.message
    });
  }
});

// endpoint untuk deactivate key
app.post('/deactivate', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ 
        success: false,
        error: 'API key is required' 
      });
    }
    
    const [result] = await db.query(
      'UPDATE api_keys SET is_active = FALSE WHERE api_key = ?',
      [apiKey]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'API key not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'API key deactivated'
    });
  } catch (error) {
    console.error('Error deactivating key:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to deactivate key',
      details: error.message
    });
  }
});

// endpoint untuk reactivate key
app.post('/reactivate', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ 
        success: false,
        error: 'API key is required' 
      });
    }
    
    const [result] = await db.query(
      'UPDATE api_keys SET is_active = TRUE WHERE api_key = ?',
      [apiKey]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'API key not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'API key reactivated'
    });
  } catch (error) {
    console.error('Error reactivating key:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to reactivate key',
      details: error.message
    });
  }
});

// endpoint info
app.get('/info', (req, res) => {
  res.json({
    service: 'API Key Generator with MySQL',
    version: '2.0',
    database: 'MySQL',
    endpoints: {
      create: 'POST /create - Generate server API key + save to DB',
      saveKey: 'POST /save-key - Save client-generated key to DB',
      validate: 'POST /validate - Validate API key (DB + format)',
      checkapi: 'POST /checkapi - Check API key details (support body/header/query)',
      keys: 'GET /keys - List all API keys from database',
      deactivate: 'POST /deactivate - Deactivate API key',
      reactivate: 'POST /reactivate - Reactivate API key'
    },
    checkApiExamples: {
      body: { apiKey: 'sk-itumy-v1-xxx_yyy' },
      header: { 'x-api-key': 'sk-itumy-v1-xxx_yyy' },
      query: '/checkapi?apiKey=sk-itumy-v1-xxx_yyy'
    }
  });
});

// ============ START SERVER ============
app.listen(port, () => {
  console.log(`🚀 Server berjalan di http://localhost:${port}`);
  console.log(`📦 Database: MySQL (apikey_db)`);
  console.log(`📝 Endpoints: http://localhost:${port}/info`);
});