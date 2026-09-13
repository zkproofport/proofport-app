import {readFileSync} from 'fs';
import path from 'path';

/**
 * The Arc action screen asks for fields, not hand-written JSON.
 *
 * A raw-JSON box stood here until 2026-09-12: it asked a person to type an
 * EIP-712 type declaration on a phone keyboard, and a stray comma read as a
 * circuit failure. The circuit hashes any structure without looking inside, so
 * the freedom is real and worth offering — as name / type / value rows, which
 * is what a phone can take.
 */
const source = readFileSync(
  path.join(__dirname, '..', 'screens', 'proof', 'ArcActionInputScreen.tsx'),
  'utf8',
);

describe('the Arc screen takes fields, not JSON', () => {
  it('has no JSON box and no hand-written type declaration', () => {
    expect(source).not.toContain('multiline');
    expect(source).not.toContain('parseAction');
    expect(source).not.toMatch(/JSON\.stringify\(\s*\{\s*domain/);
  });

  it('offers rows that can be added and removed', () => {
    expect(source).toContain('arcAction.addField');
    expect(source).toContain('arcAction.removeField');
    expect(source).toContain('arcAction.fieldTypeLabel');
  });

  it('offers every EIP-712 type the demo offers, so the two agree', () => {
    for (const type of ['address', 'uint256', 'string', 'bool', 'bytes32']) {
      expect(source).toContain(`'${type}'`);
    }
  });

  it('checks a value against its declared type, naming the field', () => {
    // A value that does not match its type is signed and hashed exactly like a
    // correct one, and only fails at a contract that decodes it.
    for (const complaint of ['errAddress', 'errNumber', 'errBytes32', 'errBool', 'errFieldTwice', 'errActionName', 'errNoFields']) {
      expect(source).toContain(`arcAction.${complaint}`);
    }
  });

  it('keeps the three named actions alongside the hand-written one', () => {
    for (const action of ['Deposit', 'Withdraw', 'Transfer']) {
      expect(source).toContain(`primaryType: '${action}'`);
    }
    expect(source).toContain("const CUSTOM = 'custom'");
  });
});
