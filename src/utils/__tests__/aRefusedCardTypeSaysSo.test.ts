/**
 * The raw-HTTP mobile ID path answers OACX_NO_PARAM_PROVIDER when it will not
 * take the chosen card type. That gets E2013, which says so, instead of the
 * generic proof failure. And the proof screen never fills in a card type the
 * person did not pick.
 */
import * as fs from 'fs';
import * as path from 'path';
import {errorCodeForOacxFailure} from '../oacxErrors';

describe('OACX_NO_PARAM_PROVIDER gets its own modal', () => {
  it('maps the raw-HTTP path\'s failure text to E2013', () => {
    expect(errorCodeForOacxFailure('OACX app request failed: OACX_NO_PARAM_PROVIDER (인증사업자 값이 설정되지 않았습니다)')).toBe('E2013');
  });

  it.each([
    'OACX app request failed: OACX_SERVER_ERROR (x)',
    'OACX_NO_PARAM_PROVIDERS',
    'XOACX_NO_PARAM_PROVIDER',
    'OmniOne CX 인증 실패: user cancelled',
    '',
  ])('leaves %p to the step\'s own code', detail => {
    expect(errorCodeForOacxFailure(detail)).toBeNull();
  });

  it('matches the text oacxClient actually produces', () => {
    const client = fs.readFileSync(path.resolve(__dirname, '..', 'oacxClient.ts'), 'utf8');
    expect(client).toContain('`OACX ${stage} failed: ${env.oacxCode ?? \'no_code\'}');
  });
});

describe('the proof screen', () => {
  const screen = fs.readFileSync(path.resolve(__dirname, '..', '..', 'screens', 'proof', 'ProofGenerationScreen.tsx'), 'utf8');

  it('routes an mDL failure through errorCodeForOacxFailure before the step code', () => {
    expect(screen).toMatch(/const oacxCode = flow === 'mdl' \? errorCodeForOacxFailure\(detail\) : null;\s*failAttempt\(\{code: errStep\.code \?\? oacxCode \?\? errorCodeForStep/);
  });

  it('never fills in a card type the person did not choose', () => {
    expect(screen).not.toMatch(/\?\? ?'com(dl|rc|nh)_v1\.5'|\?\? ?'coresidence_v1\.5'/);
    expect(screen).toMatch(/const provider = chosenMdlProviderRef\.current;\s*if \(provider === null\) \{/);
  });
});
