import { execFileSync } from 'node:child_process';
execFileSync('python3', ['-X', 'utf8', new URL('./adoption_watchdog_test.py', import.meta.url).pathname], { stdio: 'inherit' });
