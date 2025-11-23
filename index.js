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

app.post('/register-admin', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validasi sederhana
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email dan Password wajib diisi!' });
    }

    // Cek apakah email sudah ada di tabel admins
    const [existing] = await db.query('SELECT id FROM admins WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email admin sudah terdaftar!' });
    }

    // Simpan ke database
    await db.query('INSERT INTO admins (email, password) VALUES (?, ?)', [email, password]);

    res.json({ success: true, message: 'Admin berhasil didaftarkan' });

  } catch (error) {
    console.error('Error register admin:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server', error: error.message });
  }
});

// 2. Endpoint Login Admin
app.post('/login-admin', async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.query(
      'SELECT * FROM admins WHERE email = ? AND password = ?', 
      [email, password]
    );

    if (rows.length > 0) {
      res.json({ success: true, message: 'Login berhasil' });
    } else {
      res.status(401).json({ success: false, message: 'Email atau password salah' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== ENDPOINT BARU: REGISTER USER + GENERATE API KEY ==========
app.post('/register-user', async (req, res) => {
  try {
    const { firstName, lastName, email, apiKey } = req.body;

    // VALIDASI INPUT
    if (!firstName || !lastName || !email || !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required (firstName, lastName, email, apiKey)'
      });
    }

    // Validasi email format
    if (!email.includes('@')) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email format' 
      });
    }

    // Cek apakah email sudah terdaftar
    const [existingEmail] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );
    
    if (existingEmail.length > 0) {
      return res.status(409).json({ 
        success: false,
        error: 'Email already registered' 
      });
    }

    // Cek apakah API key sudah ada
    const [existingKey] = await db.query(
      'SELECT id FROM users WHERE api_key = ?',
      [apiKey]
    );
    
    if (existingKey.length > 0) {
      return res.status(409).json({ 
        success: false,
        error: 'API key already exists' 
      });
    }

    // Simpan user ke database
    const [result] = await db.query(
      'INSERT INTO users (first_name, last_name, email, api_key) VALUES (?, ?, ?, ?)',
      [firstName, lastName, email, apiKey]
    );
    
    res.json({ 
      success: true,
      message: 'User registered successfully',
      data: {
        id: result.insertId,
        firstName,
        lastName,
        email,
        apiKey
      }
    });

  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to register user',
      details: error.message
    });
  }
});

// ========== ENDPOINT: GET ALL USERS ==========
app.get('/users', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, first_name, last_name, email, api_key, created_at, is_active FROM users ORDER BY created_at DESC'
    );
    
    res.json({ 
      success: true,
      count: rows.length,
      users: rows
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch users',
      details: error.message
    });
  }
});

// ========== ENDPOINT: GET USER BY EMAIL ==========
app.get('/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const [rows] = await db.query(
      'SELECT id, first_name, last_name, email, api_key, created_at, is_active FROM users WHERE email = ?',
      [email]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }
    
    res.json({ 
      success: true,
      user: rows[0]
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user',
      details: error.message
    });
  }
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
    const { apiKey, firstName, lastName, email } = req.body;
    
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
    
    // Simpan ke database dengan data user jika ada
    if (firstName && lastName && email) {
      await db.query(
        'INSERT INTO api_keys (api_key, key_type, first_name, last_name, email) VALUES (?, ?, ?, ?, ?)',
        [apiKey, 'client', firstName, lastName, email]
      );
    } else {
      await db.query(
        'INSERT INTO api_keys (api_key, key_type) VALUES (?, ?)',
        [apiKey, 'client']
      );
    }
    
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
    // Cek di tabel users dulu
    const [userRows] = await db.query(
      'SELECT * FROM users WHERE api_key = ? AND is_active = TRUE',
      [apiKey]
    );
    
    if (userRows.length > 0) {
      const userData = userRows[0];
      
      return res.json({ 
        valid: true,
        source: 'users_table',
        data: {
          id: userData.id,
          firstName: userData.first_name,
          lastName: userData.last_name,
          email: userData.email,
          apiKey: userData.api_key,
          createdAt: userData.created_at,
          isActive: userData.is_active
        }
      });
    }

    // Fallback: Cari di tabel api_keys
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
        source: 'api_keys_table',
        data: {
          id: keyData.id,
          apiKey: keyData.api_key,
          keyType: keyData.key_type,
          firstName: keyData.first_name,
          lastName: keyData.last_name,
          email: keyData.email,
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
  const clientKeyPattern = /^[a-f0-9]{64}$/; // Update: 64 char hexadecimal
  
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
      format: '64-character hexadecimal',
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
    // Cek di tabel users dulu
    const [userRows] = await db.query(
      'SELECT * FROM users WHERE api_key = ?',
      [apiKey]
    );
    
    if (userRows.length > 0) {
      const userData = userRows[0];
      
      if (!userData.is_active) {
        return res.status(403).json({ 
          success: false,
          valid: false, 
          message: 'API key sudah tidak aktif'
        });
      }
      
      const now = new Date();
      const createdAt = new Date(userData.created_at);
      const ageInDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
      
      return res.json({ 
        success: true,
        valid: true, 
        source: 'users_table',
        message: 'API key valid (from users database)',
        data: {
          id: userData.id,
          firstName: userData.first_name,
          lastName: userData.last_name,
          email: userData.email,
          apiKey: userData.api_key,
          createdAt: userData.created_at,
          isActive: userData.is_active,
          age: {
            days: ageInDays,
            hours: Math.floor((now - createdAt) / (1000 * 60 * 60)),
            readable: ageInDays === 0 ? 'Today' : `${ageInDays} day(s) ago`
          }
        }
      });
    }

    // Cek di tabel api_keys
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
        source: 'api_keys_table',
        message: 'API key valid (from api_keys database)',
        data: {
          id: keyData.id,
          apiKey: keyData.api_key,
          keyType: keyData.key_type,
          firstName: keyData.first_name,
          lastName: keyData.last_name,
          email: keyData.email,
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
  const clientKeyPattern = /^[a-f0-9]{64}$/;
  
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
        client: '64 karakter hexadecimal (a-f0-9)'
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
        format: '64-character hexadecimal key',
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
      'SELECT id, api_key, key_type, first_name, last_name, email, created_at, last_used, is_active FROM api_keys ORDER BY created_at DESC LIMIT 100'
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
    version: '3.0',
    database: 'MySQL',
    endpoints: {
      registerUser: 'POST /register-user - Register user with API key',
      users: 'GET /users - List all users',
      userByEmail: 'GET /user/:email - Get user by email',
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