import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

if (!/^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
  throw new Error('The local webhook listener requires a Stripe test key in .env.');
}
if (process.env.NODE_ENV === 'production') throw new Error('Use a registered HTTPS webhook endpoint in production.');
const require = createRequire(import.meta.url);
const cliRoot = dirname(require.resolve('@stripe/cli/package.json'));
const platform = JSON.parse(readFileSync(join(cliRoot, 'platforms.json'), 'utf8'))[`${process.platform}-${process.arch}`];
if (!platform) throw new Error('Unsupported Stripe CLI platform.');
let executable;
try { executable = join(dirname(require.resolve(`${platform.pkg}/package.json`)), 'bin', platform.bin); }
catch { executable = join(cliRoot, 'vendor', 'bin', platform.bin); }
const port = process.argv.find(arg => arg.startsWith('--forward-port='))?.split('=')[1] || process.env.PORT || '4000';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid forwarding port.');
const forward = `http://127.0.0.1:${port}/api/webhooks/stripe`;
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
const child = spawn(executable, ['listen', '--forward-to', forward, '--events', events.join(','), '--color', 'off'], {
  windowsHide: true,
  env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY, STRIPE_DEVICE_NAME: 'forma-local', STRIPE_CLI_TELEMETRY_OPTOUT: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
function line(value) {
  const secret = value.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (secret && !ready) {
    // Save directly to the ignored file; never print a credential to the terminal.
    const content = readFileSync('.env', 'utf8');
    const entry = `STRIPE_WEBHOOK_SECRET=${secret}`;
    writeFileSync('.env', /^STRIPE_WEBHOOK_SECRET=.*$/m.test(content)
      ? content.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, entry) : content + '\n' + entry + '\n');
    ready = true;
    console.log('Stripe test listener ready. Signing secret saved to .env without printing it.');
    console.log(`Forwarding Checkout events to the local API on port ${port}.`);
    console.log('Restart the API after starting this listener. Keep this terminal running while testing.');
  }
  if (/\[\d{3}\]/.test(value)) console.log(value.replace(/(?:[sr]k_(?:test|live)_|whsec_)[A-Za-z0-9]+/g, '[redacted]'));
  else if (/error|failed|denied|invalid/i.test(value)) console.error('Stripe listener reported an error. Check the key permissions and network connection.');
}
createInterface({ input: child.stdout }).on('line', line);
createInterface({ input: child.stderr }).on('line', line);
child.on('error', () => { console.error('Could not start Stripe CLI.'); process.exitCode = 1; });
child.on('exit', code => { if (!ready) console.error('Stripe listener did not start. No signing secret was saved.');process.exitCode = code || 0; });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
