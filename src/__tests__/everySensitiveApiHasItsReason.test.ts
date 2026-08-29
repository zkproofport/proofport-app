/**
 * Every sensitive API the binary can reach needs a purpose string in Info.plist.
 *
 * Build 2 was accepted on 2026-08-29 and Apple wrote back the same minute:
 *
 *     ITMS-90683: Missing purpose string in Info.plist — ... should contain a
 *     NSLocationWhenInUseUsageDescription key with a user-facing purpose string
 *     ... While your app might not use these APIs, a purpose string is still
 *     required.
 *
 * The app never asks for location. Two dependencies link CoreLocation anyway:
 * the camera component tags photos with it, and the notification component
 * imports it unconditionally to describe location-triggered notifications
 * (`EXNotificationSerializer.m`). The camera one can be switched off in the
 * Podfile; the notification one cannot, so the string is required regardless.
 *
 * The warning does not block delivery — build 2 still installs through
 * TestFlight — but it is a rejection risk at review, and it only surfaces after
 * a twenty-nine minute build and an upload. That is why it is worth a test.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const plist = fs.readFileSync(path.join(repo, 'ios', 'ProofportApp', 'Info.plist'), 'utf8');

/** The purpose-string keys Apple has asked this app for, and what needs them. */
const REQUIRED = [
  ['NSCameraUsageDescription', 'scanning a proof request as a QR code'],
  ['NSPhotoLibraryUsageDescription', 'attaching an image to a chat message'],
  ['NSPhotoLibraryAddUsageDescription', 'saving a proof to the photo library'],
  ['NSLocalNetworkUsageDescription', 'reaching the proof relay on the local network'],
  ['NSLocationWhenInUseUsageDescription', 'CoreLocation linked by the camera and notification components'],
] as const;

/** The text of one purpose string, or undefined when the key is absent. */
const purposeString = (key: string) => {
  const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return m?.[1];
};

describe('the binary explains every sensitive API it can reach', () => {
  it.each(REQUIRED)('%s is declared (%s)', (key) => {
    expect(purposeString(key)).toBeDefined();
  });

  it.each(REQUIRED)('%s says something a person could read', (key) => {
    // Apple rejects placeholders and one-word strings; a real sentence is the
    // cheapest way to never argue about it.
    const text = purposeString(key) ?? '';
    expect(text.length).toBeGreaterThan(30);
    expect(text).not.toMatch(/TODO|FIXME|placeholder|xxx/i);
  });

  it('the location string does not claim a use the app does not have', () => {
    /*
     * The app never calls the location APIs. A string inventing a reason would
     * be a lie sitting in a file reviewers read. Keep it honest instead.
     */
    const text = purposeString('NSLocationWhenInUseUsageDescription') ?? '';
    expect(text).toMatch(/does not use your location/i);
  });
});
