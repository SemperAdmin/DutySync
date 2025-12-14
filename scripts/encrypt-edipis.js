#!/usr/bin/env node
/**
 * Script to encrypt EDIPIs in unit-members.json files
 * Run with: node scripts/encrypt-edipis.js
 *
 * Set EDIPI_ENCRYPTION_KEY environment variable for the encryption key
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use environment variable for encryption key
const EDIPI_KEY = process.env.EDIPI_ENCRYPTION_KEY || "DutySync2024";

if (!process.env.EDIPI_ENCRYPTION_KEY) {
  console.warn('Warning: EDIPI_ENCRYPTION_KEY not set, using default key. Set this in production!');
}

function encryptEdipi(edipi) {
  if (!edipi) return "";
  let result = "";
  for (let i = 0; i < edipi.length; i++) {
    const charCode = edipi.charCodeAt(i) ^ EDIPI_KEY.charCodeAt(i % EDIPI_KEY.length);
    result += String.fromCharCode(charCode);
  }
  return Buffer.from(result).toString('base64');
}

function decryptEdipi(encrypted) {
  if (!encrypted) return "";
  try {
    const decoded = Buffer.from(encrypted, 'base64').toString();
    let result = "";
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ EDIPI_KEY.charCodeAt(i % EDIPI_KEY.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch {
    return encrypted;
  }
}

// Generate a secure random ID that doesn't expose PII
function generateSecureId() {
  return `pers-${crypto.randomUUID()}`;
}

// Check if an ID contains a potential EDIPI (10 consecutive digits)
function idContainsEdipi(id) {
  return /\d{10}/.test(id);
}

// Process all RUC folders under /data/unit/
const unitDir = path.join(__dirname, '..', 'public', 'data', 'unit');

if (!fs.existsSync(unitDir)) {
  console.error('Unit directory not found:', unitDir);
  process.exit(1);
}

fs.readdirSync(unitDir).forEach(folder => {
  const folderPath = path.join(unitDir, folder);
  if (!fs.statSync(folderPath).isDirectory()) return;

  const membersFile = path.join(folderPath, 'unit-members.json');
  if (!fs.existsSync(membersFile)) return;

  console.log(`Processing ${folder}/unit-members.json...`);

  try {
    const data = JSON.parse(fs.readFileSync(membersFile, 'utf8'));

    if (data.personnel && Array.isArray(data.personnel)) {
      let idsUpdated = 0;
      let edipsEncrypted = 0;

      data.personnel = data.personnel.map(p => {
        const updates = { ...p };

        // Encrypt service_id if it looks like a plaintext EDIPI (10 digits)
        if (/^\d{10}$/.test(p.service_id)) {
          updates.service_id = encryptEdipi(p.service_id);
          edipsEncrypted++;
        }

        // Replace ID if it contains an EDIPI
        if (idContainsEdipi(p.id)) {
          updates.id = generateSecureId();
          idsUpdated++;
        }

        return updates;
      });

      data.encrypted = true;
      data.encryptedAt = new Date().toISOString();

      fs.writeFileSync(membersFile, JSON.stringify(data, null, 2));
      console.log(`  Processed ${data.personnel.length} records`);
      console.log(`  - EDIPIs encrypted: ${edipsEncrypted}`);
      console.log(`  - IDs updated (removed PII): ${idsUpdated}`);

      // Verify decryption works without logging PII
      if (data.personnel.length > 0) {
        const firstRecord = data.personnel[0];
        const decrypted = decryptEdipi(firstRecord.service_id);
        const isValidEdipi = /^\d{10}$/.test(decrypted);
        console.log(`  Verification: ${isValidEdipi ? 'OK' : 'FAILED'}`);
      }
    }
  } catch (error) {
    console.error(`  Error processing ${membersFile}:`, error.message);
  }
});

console.log('Done!');
