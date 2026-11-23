// Creates or updates the ad agents (the researcher and the independent reviewer) and their environment on the
// Claude Developer Platform with the `ant` CLI, using ANTHROPIC_API_KEY from .env, and prints the IDs a cloud
// deploy needs.
//   npm run agents:plan    show what would change, change nothing
//   npm run agents:apply   create or update (ant shows the plan and asks before changing anything)
//   npm run agents:ids     print AD_AGENT_ID, AD_REVIEWER_AGENT_ID and AD_ENVIRONMENT_ID from claude-lock.json
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const FILES = ['agents/ad-researcher.md', 'agents/ad-reviewer.md', 'environments/ad-research.yaml'];
const LOCK = 'claude-lock.json';
const cmd = process.argv[2];
if (existsSync('.env')) process.loadEnvFile('.env');

function printIds() {
  if (!existsSync(LOCK)) { console.error(`No ${LOCK} yet. Run "npm run agents:apply" first.`); process.exit(1); }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const agent = lock.resources?.['./agents/ad-researcher.md']?.id;
  const reviewer = lock.resources?.['./agents/ad-reviewer.md']?.id;
  const env = lock.resources?.['./environments/ad-research.yaml']?.id;
  if (!agent || !env) { console.error(`${LOCK} does not list the researcher and the environment. Run "npm run agents:apply".`); process.exit(1); }
  console.log(`AD_AGENT_ID=${agent}\nAD_ENVIRONMENT_ID=${env}`);
  if (reviewer) console.log(`AD_REVIEWER_AGENT_ID=${reviewer}`);
  else console.error('The reviewer is not created yet: run "npm run agents:apply". Until then ads are not reviewed.');
}

if (cmd === 'ids') {
  printIds();
} else if (cmd === 'plan' || cmd === 'apply') {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set. Put it in .env first.'); process.exit(1); }
  const args = ['apply', ...(cmd === 'plan' ? ['--dry-run'] : []), ...FILES];
  const run = spawnSync('ant', args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
  if (run.error?.code === 'ENOENT') { console.error('The ant CLI is not installed. See "Create the ad agent" in README.md.'); process.exit(1); }
  if (run.status !== 0) process.exit(run.status ?? 1);
  if (cmd === 'apply') { console.log('\nThe IDs are in claude-lock.json. Commit that file and the cloud reads them from it, or set these variables:'); printIds(); }
} else {
  console.error('usage: node scripts/agents.mjs plan | apply | ids');
  process.exit(2);
}
