/**
 * A passkey belongs to one domain, so recovery breaks the moment the app asks
 * for a domain the build is not pointed at.
 *
 * The domain sat as a fixed staging string in three separate files. The team
 * turns the mini-app on inside the store build, and that build talks to
 * production — so a person recovering their chat keys would have been asking
 * production for a passkey bound to staging. It fails at the prompt with
 * nothing useful on screen.
 *
 * Two things are held here: the domain is decided in ONE place, and every
 * domain that place can return is also declared in the entitlement. iOS only
 * honours domains listed there, so the second half is not paperwork — it is the
 * difference between a prompt and a dead end.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN_SOURCE = path.join(APP_ROOT, 'src', 'openstoa-host', 'passkeyDomain.ts');
const ENTITLEMENTS = path.join(APP_ROOT, 'ios', 'ProofportApp', 'ProofportApp.entitlements');

/** Files that may name a passkey domain literally: only the one that decides it. */
const MAY_HOLD_THE_LITERAL = ['src/openstoa-host/passkeyDomain.ts'];

/**
 * Only a domain used AS a passkey domain counts.
 *
 * The first version of this check flagged any occurrence of the string, and
 * caught the About screen's link to the OpenStoa homepage — a plain external
 * link that has nothing to do with passkeys and is on record as not to be
 * touched. A guard that cannot tell a website link from a relying-party domain
 * gets argued with, then turned off. So the match is anchored to the name the
 * value is being given.
 */
const USED_AS_A_PASSKEY_DOMAIN = (source: string, domain: string): boolean =>
  new RegExp(`\\brp_?[iI]d\\b[^\\n]{0,20}['"]${domain.replace(/\./g, '\\.')}['"]`, 'i')
    .test(source);

function sourceFiles(): string[] {
  const found: string[] = [];
  const stack = [path.join(APP_ROOT, 'src')];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') stack.push(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(path.relative(APP_ROOT, full));
      }
    }
  }
  return found.sort();
}

/** The domains passkeyDomain.ts can hand out. */
function domainsItCanReturn(): string[] {
  const source = fs.readFileSync(DOMAIN_SOURCE, 'utf8');
  return [...source.matchAll(/PASSKEY_DOMAIN_[A-Z]+\s*=\s*'([^']+)'/g)].map(m => m[1]);
}

function declaredDomains(): string[] {
  const plist = fs.readFileSync(ENTITLEMENTS, 'utf8');
  const block = plist.match(
    /<key>com\.apple\.developer\.associated-domains<\/key>[\s\S]*?<array>([\s\S]*?)<\/array>/,
  );
  if (!block) throw new Error('the entitlement declares no associated domains at all');
  return [...block[1].matchAll(/<string>webcredentials:([^<]+)<\/string>/g)].map(m => m[1]);
}

describe('the domain a passkey is bound to', () => {
  it('is decided in one place, and that place names more than one', () => {
    const domains = domainsItCanReturn();
    expect(domains.length).toBeGreaterThanOrEqual(2);
    expect(domains).toContain('www.openstoa.xyz');
  });

  it('is not written literally anywhere else', () => {
    const strays: string[] = [];
    for (const file of sourceFiles()) {
      if (MAY_HOLD_THE_LITERAL.includes(file)) continue;
      const source = fs.readFileSync(path.join(APP_ROOT, file), 'utf8');
      for (const domain of domainsItCanReturn()) {
        if (USED_AS_A_PASSKEY_DOMAIN(source, domain)) {
          strays.push(`${file} uses '${domain}' as a passkey domain`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it('declares every domain it can ask for', () => {
    const declared = declaredDomains();
    const undeclared = domainsItCanReturn().filter(d => !declared.includes(d));
    expect(undeclared).toEqual([]);
  });

  it('picks production when the build is production', () => {
    const source = fs.readFileSync(DOMAIN_SOURCE, 'utf8');
    expect(source).toMatch(/getEnvironment\(\)\s*===\s*'production'/);
    expect(source).toMatch(/PASSKEY_DOMAIN_PRODUCTION/);
  });
});
