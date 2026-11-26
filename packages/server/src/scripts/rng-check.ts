/**
 * 난수 분포 검증 (TC-15). 운영과 같은 crypto 난수로 게임이 쓰는 함수를 n번 돌려 카이제곱 검정을 한다.
 *
 *   pnpm --filter server rng-check -- --n 100000
 *   docker compose exec server node dist/scripts/rng-check.js    # 운영 이미지에서 (읽기만 한다)
 *
 * 통과하면 0, 하나라도 기준 아래면 1로 끝난다. --json이면 결과를 JSON으로 낸다.
 */
import { parseArgs } from 'node:util';
import { arch, platform, version } from 'node:process';
import { cryptoRng } from '../framework/rng.js';
import { runRngChecks } from '../framework/rngCheck.js';

const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    n: { type: 'string', default: '100000' },
    alpha: { type: 'string', default: '0.01' },
    json: { type: 'boolean', default: false },
  },
});

const n = Number(values.n);
const alpha = Number(values.alpha);
if (!Number.isInteger(n) || n < 1000 || !(alpha > 0 && alpha < 1)) {
  console.error('usage: rng-check [--n 100000] [--alpha 0.01] [--json]');
  process.exit(2);
}

const started = performance.now();
const report = runRngChecks(cryptoRng, n, alpha);
const seconds = (performance.now() - started) / 1000;

if (values.json) {
  console.log(
    JSON.stringify({ ...report, node: version, platform: `${platform}/${arch}`, seconds }, null, 2),
  );
} else {
  console.log(`rng-check  n=${n}  node ${version} ${platform}/${arch}  ${seconds.toFixed(1)}s`);
  console.log(
    `alpha ${alpha} / ${report.checks.length} tests = ${report.perTestAlpha.toExponential(1)} per test\n`,
  );
  for (const c of report.checks) {
    const ok = c.pValue >= report.perTestAlpha ? 'PASS' : 'FAIL';
    console.log(
      `${ok}  ${c.id.padEnd(14)} chi2=${c.statistic.toFixed(2).padStart(7)} df=${String(c.df).padStart(2)} p=${c.pValue.toFixed(4)}  ${c.label}`,
    );
  }
  console.log(`\n${report.passed ? 'PASSED' : 'FAILED'}`);
}
process.exit(report.passed ? 0 : 1);
