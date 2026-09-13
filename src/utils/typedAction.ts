/**
 * The EIP-712 action an `arc_eligibility` proof binds to — re-exported, not
 * re-implemented.
 *
 * Both the type and the check live in `@zkproofport-app/sdk`, reached through
 * `src/config/circuitIds.ts` — the app's one door to that package — because a dapp
 * building the action, the SDK validating the deep link, and this app before
 * it asks a wallet to sign all have to agree on what a valid action is. This
 * file existed briefly with its own copy of the check; one definition drifts
 * from another the first time somebody edits one.
 *
 * It stays as a file rather than importing the SDK everywhere so the app has
 * one place to look when asking where the action rules come from.
 */
import {validateTypedAction, parseTypedAction, type TypedAction} from '../config/circuitIds';

export {validateTypedAction, parseTypedAction};
export type {TypedAction};

/** The action, or the reason it is not one — for a value already parsed. */
export function checkAction(raw: unknown): {action: TypedAction} | {error: string} {
  const error = validateTypedAction(raw);
  return error ? {error} : {action: raw as TypedAction};
}

/** The same check, on text a person typed. */
export const parseAction = parseTypedAction;
