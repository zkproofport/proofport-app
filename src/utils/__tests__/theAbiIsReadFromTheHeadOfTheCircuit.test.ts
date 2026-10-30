/**
 * circuitAbiParameterNames reads only as much of a circuit JSON as it takes
 * to close the top-level "abi" object -- reading all 8.7 MB of the Android
 * OIDC circuit took 34.6 s on a Galaxy A23 -- and still reads a file whose
 * ABI comes late, refuses one without an ABI, and decodes UTF-8 names --
 * through fileRange.ts, never react-native-fs's read(), which throws on
 * iPhone under the New Architecture.
 */
const mockFiles = new Map<string, Buffer>();
const mockRangeReads: Array<{path: string; length: number; position: number}> = [];
// react-native-fs's read() throws on iPhone under the New Architecture (its
// iOS signature takes NSInteger pointers the interop layer cannot convert),
// so the mock throws what the iPhone threw: any call to it fails the test.
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    stat: async (p: string) => ({size: mockFiles.get(p)!.length}),
    read: async () => {
      throw new Error(jest.requireActual('./fixtures/memoryExpoFile').IOS_RNFS_READ_ERROR);
    },
    readFile: async () => {
      throw new Error('the whole file must not be read');
    },
  },
}));
jest.mock('expo-file-system', () => jest.requireActual('./fixtures/memoryExpoFile').memoryExpoFile(() => mockFiles, () => mockRangeReads));
jest.mock('../circuitDownload', () => ({getCircuitFilePath: (c: string, ext: string) => `/c/${c}.${ext}`}));

import {circuitAbiParameterNames, topLevelValue, ABI_HEAD_BYTES} from '../circuitAbi';

const abi = (names: string[]) => ({parameters: names.map(name => ({name, type: {kind: 'field'}, visibility: 'private'})), return_type: null});

function publish(obj: Record<string, unknown>) {
  mockFiles.set('/c/x.json', Buffer.from(JSON.stringify(obj), 'utf8'));
}

beforeEach(() => {
  mockFiles.clear();
  mockRangeReads.length = 0;
});

describe('the ABI comes from the head of the file', () => {
  it('nargo order (abi before an 8 MB bytecode): one read of the first window', async () => {
    publish({noir_version: '1.0.0-beta.19', hash: '1', abi: abi(['jwt', 'pubkey_modulus_limbs']), bytecode: 'A'.repeat(8_000_000)});
    await expect(circuitAbiParameterNames('x')).resolves.toEqual(['jwt', 'pubkey_modulus_limbs']);
    expect(mockRangeReads).toEqual([{path: '/c/x.json', length: ABI_HEAD_BYTES, position: 0}]);
  });

  it('an ABI after the bytecode is still found, by growing the window', async () => {
    publish({bytecode: 'B'.repeat(300_000), abi: abi(['a', 'b'])});
    await expect(circuitAbiParameterNames('x')).resolves.toEqual(['a', 'b']);
    expect(mockRangeReads.length).toBeGreaterThan(1);
    expect(mockRangeReads.every(r => r.position === 0)).toBe(true);
  });

  it('a file smaller than the window is read once, whole', async () => {
    publish({abi: abi(['only'])});
    await expect(circuitAbiParameterNames('x')).resolves.toEqual(['only']);
    expect(mockRangeReads).toEqual([{path: '/c/x.json', length: mockFiles.get('/c/x.json')!.length, position: 0}]);
  });

  it('UTF-8 names survive a byte-wise read', async () => {
    publish({abi: abi(['도메인', 'emoji_😀']), bytecode: 'C'.repeat(100)});
    await expect(circuitAbiParameterNames('x')).resolves.toEqual(['도메인', 'emoji_😀']);
  });

  it('a key named "abi" inside another value is not the ABI', async () => {
    publish({meta: {abi: abi(['wrong'])}, note: '"abi": {"parameters": []}', abi: abi(['right'])});
    await expect(circuitAbiParameterNames('x')).resolves.toEqual(['right']);
  });

  it.each([
    ['no abi at all', () => publish({bytecode: 'x'}), /no complete top-level "abi"/],
    ['an abi with no parameter list', () => publish({abi: {return_type: null}}), /carries no ABI parameter list/],
    ['a truncated file', () => mockFiles.set('/c/x.json', Buffer.from('{"abi":{"parameters":[{"name":"a"')), /no complete top-level "abi"/],
    ['an empty file', () => mockFiles.set('/c/x.json', Buffer.alloc(0)), /is empty/],
    ['not JSON inside the abi', () => mockFiles.set('/c/x.json', Buffer.from('{"abi":{parameters:[1]}}')), /is not JSON/],
  ])('%s is refused with an error naming the file', async (_l, arrange, message) => {
    arrange();
    await expect(circuitAbiParameterNames('x')).rejects.toThrow(message);
  });
});

describe('topLevelValue', () => {
  it('handles escaped quotes and brackets inside strings', () => {
    expect(topLevelValue('{"a":"x\\"}]","abi":[1,{"b":"]"}],"c":2}', 'abi')).toBe('[1,{"b":"]"}]');
  });
  it('says incomplete when the text ends inside the value', () => {
    expect(topLevelValue('{"abi":{"parameters":[', 'abi')).toBe('incomplete');
  });
  it('says null when the object closes without the key', () => {
    expect(topLevelValue('{"x":1}  trailing', 'abi')).toBeNull();
  });
});
