#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <mach/mach.h>

/**
 * Build-time config, plus the one developer override that has to survive into
 * the NEXT launch.
 *
 * The override lives in NSUserDefaults rather than in AsyncStorage on purpose.
 * JS reads `OPENSTOA_ENABLED` at module load — the push-tap bridge starts at
 * import time, before any React state exists — so an async JS read would arrive
 * too late and leave the app half-switched. Resolving it here means that by the
 * time the first line of JS runs the value is already correct, and "restart to
 * apply" is the mechanism rather than a caveat.
 */
static NSString *const kOpenStoaOverrideKey = @"zkproofport.devoverride.openstoa";

@interface AppEnvModule : NSObject <RCTBridgeModule>
@end

@implementation AppEnvModule

RCT_EXPORT_MODULE(AppEnv)

- (NSDictionary *)constantsToExport {
  NSString *env = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"AppEnv"];
  NSString *resolvedEnv;
  if ([env isEqualToString:@"development"] || [env isEqualToString:@"staging"] || [env isEqualToString:@"production"]) {
    resolvedEnv = env;
  } else {
#ifdef DEBUG
    resolvedEnv = @"development";
#else
    resolvedEnv = @"production";
#endif
  }

  // Build value first: absent or malformed means ENABLED, which is what every
  // build did before this became configurable — a missing setting must not
  // silently remove a feature.
  NSString *openStoa = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"OpenStoaEnabled"];
  BOOL enabled = ![[openStoa lowercaseString] isEqualToString:@"false"];

  // A developer override, if one was set, wins.
  id override = [[NSUserDefaults standardUserDefaults] objectForKey:kOpenStoaOverrideKey];
  if (override != nil) {
    enabled = [override boolValue];
  }

  return @{@"APP_ENV": resolvedEnv, @"OPENSTOA_ENABLED": enabled ? @"true" : @"false"};
}

/** Takes effect on the next launch — constants are read once, at bridge setup. */
RCT_EXPORT_METHOD(setOpenStoaOverride:(BOOL)enabled) {
  [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:kOpenStoaOverrideKey];
}

/** Drop the override and go back to whatever the build says. */
RCT_EXPORT_METHOD(clearOpenStoaOverride) {
  [[NSUserDefaults standardUserDefaults] removeObjectForKey:kOpenStoaOverrideKey];
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

@end

/**
 * What a proof needs from the OS while it runs (Android: ProofRuntimeModule.kt):
 * the app's memory for the `[ProofTiming]` log, and the idle timer off so the
 * screen does not lock mid-proof. Kept in this file because it is already in
 * the Xcode project.
 */
@interface ProofRuntimeModule : NSObject <RCTBridgeModule>
@end

@implementation ProofRuntimeModule

RCT_EXPORT_MODULE(ProofRuntime)

- (NSDictionary *)constantsToExport {
  return @{
    @"totalMemKb": @((double)[NSProcessInfo processInfo].physicalMemory / 1024.0),
    @"cpuCount": @([NSProcessInfo processInfo].activeProcessorCount),
  };
}

/** footprintKb is what iOS counts against the app's memory limit. */
RCT_EXPORT_METHOD(memorySnapshot:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  kern_return_t kr = task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count);
  if (kr != KERN_SUCCESS) {
    reject(@"E_MEMORY", [NSString stringWithFormat:@"task_info failed: %d", kr], nil);
    return;
  }
  resolve(@{
    @"footprintKb": @((double)info.phys_footprint / 1024.0),
    @"rssKb": @((double)info.resident_size / 1024.0),
  });
}

RCT_EXPORT_METHOD(setKeepScreenOn:(BOOL)on) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = on;
  });
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

@end
