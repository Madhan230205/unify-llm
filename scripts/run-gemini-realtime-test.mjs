import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is missing. Add it to your .env file before running the realtime Gemini test.');
  process.exit(1);
}

const vitestEntry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const env = {
  ...process.env,
  RUN_GEMINI_REALTIME: process.env.RUN_GEMINI_REALTIME || '1',
};

const child = spawn(process.execPath, [vitestEntry, 'run', 'test/gemini-realtime-100.test.ts'], {
  stdio: 'inherit',
  env,
});

child.on('exit', code => {
  process.exit(code ?? 1);
});
