import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

describe('Metro SDK checkout availability', () => {
  it.each([false, true])('bundles with SDK checkout present=%s', present => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'proofport-metro-'));
    const app = path.join(fixture, 'app');
    const sdk = path.join(fixture, 'proofport-app-sdk');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"bundle-fixture"}');
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'dir');
    for (const name of ['mobile', 'miniapp-bridge', 'api-types', 'mls']) {
      fs.mkdirSync(path.join(fixture, 'openstoa/packages', name), {recursive: true});
    }
    if (present) fs.mkdirSync(sdk);
    try {
      const result = execFileSync(process.execPath, ['-e', `
        const fs = require('fs'), vm = require('vm');
        const configModule = {exports: {}};
        vm.runInNewContext(fs.readFileSync('metro.config.js', 'utf8'), {
          require, module: configModule, __dirname: process.argv[1],
        });
        console.log(JSON.stringify(configModule.exports.watchFolders));
      `, app], {cwd: root, encoding: 'utf8'});
      const folders: string[] = JSON.parse(result);
      expect(folders.includes(sdk)).toBe(present);
      // Metro's transformer rejects any nonexistent watched directory before
      // resolving the published SDK from node_modules.
      expect(folders.every(folder => fs.statSync(folder).isDirectory())).toBe(true);
    } finally {
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});
