const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('route.ts')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('/home/nickson/Projects/MIS/app/api');
let fixed = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace `{ params }: { params: { id: string } }` with `props: { params: Promise<{ id: string }> }`
  content = content.replace(/\{\s*params\s*\}:\s*\{\s*params:\s*\{\s*id:\s*string\s*\}\s*\}/g, 'props: { params: Promise<{ id: string }> }');
  
  // Replace `params.id` with `(await props.params).id`
  content = content.replace(/params\.id/g, '(await props.params).id');

  // Replace `{ params }: { params: { callbackToken: string } }`
  content = content.replace(/\{\s*params\s*\}:\s*\{\s*params:\s*\{\s*callbackToken:\s*string\s*\}\s*\}/g, 'props: { params: Promise<{ callbackToken: string }> }');
  content = content.replace(/params\.callbackToken/g, '(await props.params).callbackToken');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    fixed++;
    console.log(`Fixed ${file}`);
  }
}
console.log(`Total fixed: ${fixed}`);
