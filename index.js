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

