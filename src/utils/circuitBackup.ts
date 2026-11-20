/**
 * Keeps the downloaded circuits directory out of iCloud / device backup.
 *
 * `Documents/circuits/` holds every circuit's `.json`, `.srs` and `.vk`
 * (circuitDownload.ts) and the prover's shared reference string `bn254-crs/`
 * (sharedSrs.ts, up to 128 MiB). All of it can be downloaded or rebuilt
 * again, and a phone that proved a 2^21 circuit holds several hundred MB
 * there. So on iOS the directory ITSELF carries NSURLIsExcludedFromBackupKey,
 * which covers everything inside it, `bn254-crs/` included.
 *
 * The flag is set again, idempotently, at every launch (App.tsx), before
 * every download (circuitDownload.ts ensureCircuitDirectory) and before every
 * proof (noirProver.ts): an install whose directory predates this flag gets
 * it on its next launch, and a file operation that resets resource values
 * cannot leave it off for long. `RNFS.mkdir` with the option creates the
 * directory if needed (`withIntermediateDirectories:YES` accepts an existing
 * one) and then sets the resource value.
 *
 * Never throws: a failure is logged and the caller goes ahead -- the files
 * being backed up is a cost, not a reason to refuse a download or a proof.
 *
 * Android backs nothing up (`android:allowBackup="false"` in
 * AndroidManifest.xml); turning backup on would need a rule excluding the
 * circuits directory. theCircuitFilesStayOutOfBackups.test.ts holds both.
 */
import RNFS from 'react-native-fs';

function platformOs(): string | undefined {
  try {
    return (require('react-native') as {Platform?: {OS?: string}}).Platform?.OS;
  } catch {
    return undefined;
  }
}

/** The directory part of `filePath`; a path with none is refused by name. */
export function parentDirectoryOf(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  if (slash < 0) throw new Error(`Path '${filePath}' has no directory.`);
  return filePath.slice(0, slash);
}

/** On iOS, create `dir` if needed and mark it (and so its contents) excluded from backup. */
export async function excludeFromBackup(dir: string, log: (m: string) => void = console.log): Promise<void> {
  if (platformOs() !== 'ios') return;
  try {
    await RNFS.mkdir(dir, {NSURLIsExcludedFromBackupKey: true});
  } catch (e) {
    log(`Could not exclude ${dir} from backup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Before a proof: flag the directory holding the `.srs` the prover is handed,
 * which is where the prover writes `bn254-crs/` (sharedSrs.ts).
 */
export async function keepProverFilesOutOfBackup(srsPath: string, log: (m: string) => void): Promise<void> {
  let dir: string;
  try {
    dir = parentDirectoryOf(srsPath);
  } catch (e) {
    log(`[Prover] ${e instanceof Error ? e.message : String(e)}; backup flag not set`);
    return;
  }
  await excludeFromBackup(dir, log);
}
