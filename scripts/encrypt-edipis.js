#!/usr/bin/env node
/**
 * Script to encrypt EDIPIs in unit-members.json files
 * Run with: node scripts/encrypt-edipis.js
 */

const fs = require('fs');
const path = require('path');

const EDIPI_KEY = "DutySync2024";

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

// Process all RUC folders
const dataDir = path.join(__dirname, '..', 'public', 'data');

fs.readdirSync(dataDir).forEach(folder => {
  const folderPath = path.join(dataDir, folder);
  if (!fs.statSync(folderPath).isDirectory()) return;

  const membersFile = path.join(folderPath, 'unit-members.json');
  if (!fs.existsSync(membersFile)) return;

  console.log(`Processing ${folder}/unit-members.json...`);

  const data = JSON.parse(fs.readFileSync(membersFile, 'utf8'));

  if (data.personnel && Array.isArray(data.personnel)) {
    data.personnel = data.personnel.map(p => ({
      ...p,
      service_id: encryptEdipi(p.service_id)
    }));

    // Also update the ID to use encrypted EDIPI
    data.personnel = data.personnel.map(p => {
      const originalId = p.id;
      // Keep the ID format but don't expose EDIPI in it
      const idParts = originalId.split('-');
      if (idParts[0] === 'pers' && idParts.length === 2) {
        // ID was pers-{edipi}, change to pers-{index}
        return p; // Keep original ID structure for now
      }
      return p;
    });

    data.encrypted = true;
    data.encryptedAt = new Date().toISOString();

    fs.writeFileSync(membersFile, JSON.stringify(data, null, 2));
    console.log(`  Encrypted ${data.personnel.length} records`);

    // Verify decryption works
    const firstRecord = data.personnel[0];
    const decrypted = decryptEdipi(firstRecord.service_id);
    console.log(`  Verification: First EDIPI decrypts to ${decrypted.substring(0, 4)}****${decrypted.substring(8)}`);
  }
});

console.log('Done!');
