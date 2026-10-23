#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <GoogleSignIn/GoogleSignIn.h>

/**
 * Google sign-in that returns an ID token carrying a nonce the caller chose.
 *
 * `@react-native-google-signin/google-signin`'s free API called
 * `signInWithPresentingViewController:hint:additionalScopes:completion:`, which
 * has no nonce. GoogleSignIn 9 has the same call with `nonce:`; AppAuth then
 * sends it on the authorization request and rejects a token response whose ID
 * token carries a different one (OIDAuthorizationService.m).
 *
 * `serverClientID` is the WEB client id. GoogleSignIn sends it as `audience`
 * on the token request (GIDSignIn.m), so the ID token is for the same client
 * as on Android.
 *
 * JS contract (src/oidc/googleIdToken.ts): `signIn({nonce, serverClientId,
 * iosClientId})` resolves `{idToken}` or rejects with CANCELLED / IN_PROGRESS /
 * INVALID_INPUT / NO_ACTIVITY / NO_ID_TOKEN / KEYCHAIN / SIGN_IN_FAILED. The
 * nonce check on the returned token is done again in JS, where it is tested.
 */
@interface GoogleIdTokenModule : NSObject <RCTBridgeModule>
@end

@implementation GoogleIdTokenModule {
  BOOL _inFlight;
}

RCT_EXPORT_MODULE(GoogleIdToken)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

/** Presenting UI and touching GIDSignIn's shared state both belong on main. */
- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

static NSString *StringOption(NSDictionary *options, NSString *key) {
  id value = options[key];
  return ([value isKindOfClass:[NSString class]] && [(NSString *)value length] > 0) ? value : nil;
}

RCT_EXPORT_METHOD(signIn:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSString *nonce = StringOption(options, @"nonce");
  NSString *serverClientId = StringOption(options, @"serverClientId");
  NSString *iosClientId = StringOption(options, @"iosClientId");
  if (!nonce || !serverClientId || !iosClientId) {
    reject(@"INVALID_INPUT", @"signIn needs a non-empty nonce, serverClientId and iosClientId", nil);
    return;
  }
  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter) {
    reject(@"NO_ACTIVITY", @"No view controller to present Google sign-in from", nil);
    return;
  }
  if (_inFlight) {
    reject(@"IN_PROGRESS", @"A Google sign-in is already open", nil);
    return;
  }
  _inFlight = YES;

  GIDSignIn *signIn = GIDSignIn.sharedInstance;
  signIn.configuration = [[GIDConfiguration alloc] initWithClientID:iosClientId
                                                     serverClientID:serverClientId];
  // A fresh interactive sign-in every time: nothing restored from an earlier
  // one may stand in for a token minted with this nonce.
  [signIn signOut];

  __weak GoogleIdTokenModule *weakSelf = self;
  [signIn signInWithPresentingViewController:presenter
                                        hint:nil
                            additionalScopes:nil
                                       nonce:nonce
                                  completion:^(GIDSignInResult *_Nullable result, NSError *_Nullable error) {
    GoogleIdTokenModule *strongSelf = weakSelf;
    if (strongSelf) strongSelf->_inFlight = NO;
    if (error) {
      NSString *code = @"SIGN_IN_FAILED";
      if ([error.domain isEqualToString:kGIDSignInErrorDomain]) {
        if (error.code == kGIDSignInErrorCodeCanceled) code = @"CANCELLED";
        else if (error.code == kGIDSignInErrorCodeKeychain) code = @"KEYCHAIN";
      }
      NSString *message = [NSString stringWithFormat:@"%@ (%@ %ld)",
                           error.localizedDescription, error.domain, (long)error.code];
      reject(code, message, error);
      return;
    }
    NSString *idToken = result.user.idToken.tokenString;
    if (idToken.length == 0) {
      reject(@"NO_ID_TOKEN", @"Google sign-in finished without an ID token", nil);
      return;
    }
    resolve(@{@"idToken": idToken});
  }];
}

@end
