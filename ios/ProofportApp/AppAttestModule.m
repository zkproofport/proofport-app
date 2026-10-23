#import <React/RCTBridgeModule.h>
@import DeviceCheck;

/**
 * Apple App Attest (DeviceCheck's DCAppAttestService), exposed to JS as four
 * thin calls. Everything about WHEN to call them -- one key per install, which
 * error means "try again with the same key", which means "start over" -- is
 * decided in src/appAttest/appAttestKey.ts, where it is unit tested. This file
 * only translates between the framework and the bridge.
 *
 * API: DCAppAttestService (iOS 14+), isSupported / generateKey /
 * attestKey:clientDataHash: / generateAssertion:clientDataHash:
 * (developer.apple.com/documentation/devicecheck/dcappattestservice).
 * Bytes cross the bridge as standard base64.
 *
 * Errors reject with a stable code naming the DCError, so JS can tell
 * "unsupported", "invalid key" and "server unavailable" apart:
 *   APPATTEST_UNSUPPORTED      DCErrorFeatureUnsupported, or isSupported is NO
 *   APPATTEST_INVALID_INPUT    DCErrorInvalidInput
 *   APPATTEST_INVALID_KEY      DCErrorInvalidKey
 *   APPATTEST_SERVER_UNAVAILABLE DCErrorServerUnavailable
 *   APPATTEST_UNKNOWN_FAILURE  DCErrorUnknownSystemFailure
 *   APPATTEST_ERROR            anything outside DCErrorDomain
 */
@interface AppAttestModule : NSObject <RCTBridgeModule>
@end

@implementation AppAttestModule

RCT_EXPORT_MODULE(AppAttest)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

static NSString *CodeFor(NSError *error) {
  if (![error.domain isEqualToString:DCErrorDomain]) {
    return @"APPATTEST_ERROR";
  }
  switch ((DCError)error.code) {
    case DCErrorFeatureUnsupported:
      return @"APPATTEST_UNSUPPORTED";
    case DCErrorInvalidInput:
      return @"APPATTEST_INVALID_INPUT";
    case DCErrorInvalidKey:
      return @"APPATTEST_INVALID_KEY";
    case DCErrorServerUnavailable:
      return @"APPATTEST_SERVER_UNAVAILABLE";
    case DCErrorUnknownSystemFailure:
      return @"APPATTEST_UNKNOWN_FAILURE";
  }
  return @"APPATTEST_ERROR";
}

static void Reject(RCTPromiseRejectBlock reject, NSError *error) {
  NSString *message = [NSString stringWithFormat:@"%@ (%@ %ld)", error.localizedDescription, error.domain, (long)error.code];
  reject(CodeFor(error), message, error);
}

/** Decode a base64 clientDataHash; App Attest takes 32 bytes from us. */
static NSData *HashFrom(NSString *base64, RCTPromiseRejectBlock reject) {
  NSData *hash = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (hash == nil || hash.length != 32) {
    reject(@"APPATTEST_INVALID_INPUT", @"clientDataHash must be 32 bytes, base64", nil);
    return nil;
  }
  return hash;
}

RCT_EXPORT_METHOD(isSupported:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (@available(iOS 14.0, *)) {
    resolve(@(DCAppAttestService.sharedService.isSupported));
  } else {
    resolve(@NO);
  }
}

RCT_EXPORT_METHOD(generateKey:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (@available(iOS 14.0, *)) {
    DCAppAttestService *service = DCAppAttestService.sharedService;
    if (!service.isSupported) {
      reject(@"APPATTEST_UNSUPPORTED", @"App Attest is not supported on this device", nil);
      return;
    }
    [service generateKeyWithCompletionHandler:^(NSString *_Nullable keyId, NSError *_Nullable error) {
      if (error != nil || keyId == nil) {
        Reject(reject, error ?: [NSError errorWithDomain:DCErrorDomain code:DCErrorUnknownSystemFailure userInfo:nil]);
        return;
      }
      resolve(keyId);
    }];
  } else {
    reject(@"APPATTEST_UNSUPPORTED", @"App Attest needs iOS 14", nil);
  }
}

RCT_EXPORT_METHOD(attestKey:(NSString *)keyId
                  clientDataHash:(NSString *)clientDataHashBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (@available(iOS 14.0, *)) {
    NSData *hash = HashFrom(clientDataHashBase64, reject);
    if (hash == nil) return;
    [DCAppAttestService.sharedService attestKey:keyId
                                 clientDataHash:hash
                              completionHandler:^(NSData *_Nullable attestation, NSError *_Nullable error) {
      if (error != nil || attestation == nil) {
        Reject(reject, error ?: [NSError errorWithDomain:DCErrorDomain code:DCErrorUnknownSystemFailure userInfo:nil]);
        return;
      }
      resolve([attestation base64EncodedStringWithOptions:0]);
    }];
  } else {
    reject(@"APPATTEST_UNSUPPORTED", @"App Attest needs iOS 14", nil);
  }
}

RCT_EXPORT_METHOD(generateAssertion:(NSString *)keyId
                  clientDataHash:(NSString *)clientDataHashBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (@available(iOS 14.0, *)) {
    NSData *hash = HashFrom(clientDataHashBase64, reject);
    if (hash == nil) return;
    [DCAppAttestService.sharedService generateAssertion:keyId
                                         clientDataHash:hash
                                      completionHandler:^(NSData *_Nullable assertion, NSError *_Nullable error) {
      if (error != nil || assertion == nil) {
        Reject(reject, error ?: [NSError errorWithDomain:DCErrorDomain code:DCErrorUnknownSystemFailure userInfo:nil]);
        return;
      }
      resolve([assertion base64EncodedStringWithOptions:0]);
    }];
  } else {
    reject(@"APPATTEST_UNSUPPORTED", @"App Attest needs iOS 14", nil);
  }
}

@end
