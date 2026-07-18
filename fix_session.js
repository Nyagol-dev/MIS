const fs = require('fs');

const files = [
  '/home/nickson/Projects/MIS/app/(tenant)/entities/page.tsx',
  '/home/nickson/Projects/MIS/app/(tenant)/entities/[entityTypeSlug]/page.tsx',
  '/home/nickson/Projects/MIS/app/(tenant)/entities/[entityTypeSlug]/[recordId]/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix import
  content = content.replace(
    /import \{ verifyAnySession \} from '@\/lib\/auth\/session';/g,
    "import { verifyAnySession, COOKIE_NAME } from '@/lib/auth/session';\nimport { cookies } from 'next/headers';"
  );

  // Fix session logic
  content = content.replace(
    /const session = await verifyAnySession\(\);\s*if \(\!session \|\| session\.session_type !== 'tenant'\) \{\s*redirect\('\/login'\);\s*\}/g,
    "const cookieStore = await cookies();\n  const token = cookieStore.get(COOKIE_NAME)?.value;\n  const session = token ? await verifyAnySession(token) : null;\n  if (!session || session.sessionKind !== 'tenant') {\n    redirect('/login');\n  }"
  );

  fs.writeFileSync(file, content, 'utf8');
}

console.log("Done");
