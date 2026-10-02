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
  
  content = content.replace(/newState: '[^']+'/g, "newState: null");
  
  fs.writeFileSync(file, content);
}
