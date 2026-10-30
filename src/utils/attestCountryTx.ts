/**
 * The country a Coinbase `attestCountry(uint256)` transaction attests.
 *
 * Its calldata is [selector 4][zero 10][country 2][address 20], as the
 * circuit reads it (circuits coinbase-country-v2-libs: calldata[14..16] is
 * the country, calldata[16..36] the wallet). Coinbase Country v2's statement
 * must name the same two letters, so the app reads them before anything is
 * signed. Pure; no config.
 */
import {ethers} from 'ethers';

export const ATTEST_COUNTRY_SELECTOR = '0x0a225248';

/**
 * Two uppercase ASCII letters, or an Error naming what the transaction is
 * instead: another function (attestAccount is Coinbase KYC's), a calldata of
 * another length, nonzero padding, or a country that is not two letters.
 */
export function attestedCountryOfTx(rawTx: string): string {
  const tx = ethers.utils.parseTransaction(rawTx);
  const data = tx.data.toLowerCase();
  const selector = data.slice(0, 10);
  if (selector !== ATTEST_COUNTRY_SELECTOR) {
    throw new Error(`The attestation transaction calls ${selector}, not attestCountry (${ATTEST_COUNTRY_SELECTOR})`);
  }
  // 0x + selector (8) + one 32-byte word (64).
  if (data.length !== 2 + 8 + 64) {
    throw new Error(`attestCountry calldata is ${(data.length - 2) / 2} bytes, not 36`);
  }
  if (!/^0{20}$/.test(data.slice(10, 30))) {
    throw new Error('attestCountry calldata has nonzero bytes before the country');
  }
  const country = String.fromCharCode(parseInt(data.slice(30, 32), 16), parseInt(data.slice(32, 34), 16));
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error(`attestCountry names country bytes 0x${data.slice(30, 34)}, not two uppercase letters`);
  }
  return country;
}
