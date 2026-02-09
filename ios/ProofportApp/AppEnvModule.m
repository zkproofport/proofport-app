#import <React/RCTBridgeModule.h>

@interface AppEnvModule : NSObject <RCTBridgeModule>
@end

@implementation AppEnvModule

RCT_EXPORT_MODULE(AppEnv)

- (NSDictionary *)constantsToExport {
  NSString *env = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"AppEnv"];
  NSString *resolvedEnv;
  if ([env isEqualToString:@"development"] || [env isEqualToString:@"production"]) {
    resolvedEnv = env;
  } else {
#ifdef DEBUG
    resolvedEnv = @"development";
#else
    resolvedEnv = @"production";
#endif
  }
  return @{@"APP_ENV": resolvedEnv};
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

@end
