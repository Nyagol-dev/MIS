const fs = require('fs');

const files = [
  'lib/lab/service.ts',
  'lib/orders/service.ts',
  'lib/pharmacy/service.ts',
  'lib/radiology/service.ts'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  
  content = content.replace(/resourceType:/g, "entityType:");
  content = content.replace(/resourceId:/g, "entityId:");
  content = content.replace(/reason:/g, "newState:");
  
  fs.writeFileSync(file, content);
}
