const fs = require('fs');

const files = [
  'app/(tenant)/billing/page.tsx',
  'app/(tenant)/claims/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\\\`/g, '\`');
  fs.writeFileSync(file, content);
}
