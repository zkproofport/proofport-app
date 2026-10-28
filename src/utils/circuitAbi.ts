/**
 * The parameter names of a downloaded circuit's `fn main`, in ABI order, read
 * from its compiled `<circuit>.json`.
 *
 * The public-input count does not tell two versions of a circuit apart when
 * only private inputs changed (the OIDC circuit before and after the
 * provider-key statement both have 214); handing a vector built for one to the
 * other fails inside the prover with a witness error that names nothing. The
 * names do tell them apart.
 */
import RNFS from 'react-native-fs';
import {getCircuitFilePath} from './circuitDownload';

export async function circuitAbiParameterNames(circuitName: string): Promise<string[]> {
  const path = getCircuitFilePath(circuitName, 'json');
  const raw = await RNFS.readFile(path, 'utf8');
  let parsed: {abi?: {parameters?: unknown}};
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const params = parsed?.abi?.parameters;
  if (!Array.isArray(params) || params.some(p => typeof (p as {name?: unknown})?.name !== 'string')) {
    throw new Error(`${path} carries no ABI parameter list`);
  }
  return params.map(p => (p as {name: string}).name);
}
