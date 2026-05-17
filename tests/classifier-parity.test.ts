/**
 * Cross-classifier parity — JS half.
 *
 * The classifier logic lives in two implementations: the JS
 * `LocalClassifier`/`cookieMatches` here, and the PHP
 * `ServiceRepository::cookieMatches` + `DetectionListPresenter::cookieMatches`
 * in the TYPO3 ext. They MUST agree on the same `(cookieName, matcher,
 * observedOrigins)` triple for the integrated system to behave
 * consistently — a divergence is the kind of bug that surfaced (twice)
 * during the ADR-0010 rollout.
 *
 * This test feeds a shared fixture into the JS implementation and
 * verifies the expected result. A companion PHP test
 * (`simplecmp-typo3/Tests/Unit/Classifier/ParityTest.php`) loads the
 * **same fixture JSON** and verifies the PHP implementations agree.
 *
 * When adding a case: add it to `classifier-parity-fixture.json` AND
 * copy that file into `simplecmp-typo3/Tests/Unit/Classifier/`. Yes
 * the file lives twice; the alternative is making
 * `simplecmp/services-library` host the fixture, which is overkill
 * for a 10-case fixture.
 *
 * The `phpAlwaysTrue` field flags cases where PHP returns true while
 * JS returns false because the host-qualifier requires runtime
 * observed-origins context that the PHP middleware doesn't have.
 * This is by design — the PHP middleware surfaces candidates; the FE
 * recorder applies the runtime filter. See ADR-0010 for the design.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cookieMatches } from '../src/recorder/classifier.js';
import type { CookieMatcher } from '../src/recorder/types.js';

interface FixtureCase {
  id: string;
  cookie: string;
  matcher: CookieMatcher;
  observedOrigins: string[];
  expected: boolean;
  phpAlwaysTrue?: boolean;
}

const fixturePath = resolve(__dirname, 'classifier-parity-fixture.json');
const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureCase[];

describe('classifier parity — JS side', () => {
  for (const c of cases) {
    it(`${c.id}: cookie=${JSON.stringify(c.cookie)}, observed=${JSON.stringify(c.observedOrigins)}`, () => {
      const result = cookieMatches(c.cookie, c.matcher, new Set(c.observedOrigins));
      expect(result).toBe(c.expected);
    });
  }
});
