#!/usr/bin/env node
/**
 * Script to update unit_section_id values in unit-members.json
 * to use the new hierarchy structure
 */

const fs = require('fs');
const path = require('path');

// Mapping from old IDs to new IDs
const ID_MAPPING = {
  'unit-section-CUST': 'unit-worksection-CUST',
  'unit-section-APOS': 'unit-worksection-APOS',
  'unit-section-OBND': 'unit-worksection-OBND',
  'unit-section-INBD': 'unit-worksection-INBD',
  'unit-section-TAD': 'unit-worksection-TAD',
  'unit-section-MPHQ': 'unit-worksection-MPHQ',
  'unit-section-MPA0': 'unit-worksection-MPA0',
  'unit-section-OPS': 'unit-worksection-OPS',
  'unit-section-HQ': 'unit-worksection-HQ',
  'unit-ruc-02301-H-S1DV': 'unit-section-S1DV', // People at RUC level go to section
};

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
    let updatedCount = 0;

    if (data.personnel && Array.isArray(data.personnel)) {
      data.personnel = data.personnel.map(p => {
        const oldId = p.unit_section_id;
        const newId = ID_MAPPING[oldId];

        if (newId) {
          updatedCount++;
          return { ...p, unit_section_id: newId };
        }
        return p;
      });

      fs.writeFileSync(membersFile, JSON.stringify(data, null, 2));
      console.log(`  Updated ${updatedCount} personnel records`);
    }
  } catch (error) {
    console.error(`  Error processing ${membersFile}:`, error.message);
  }
});

console.log('Done!');
