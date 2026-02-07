#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import <React/RCTBridge.h>
#import <React/RCTLinkingManager.h>
#if __has_include("RCTAppleHealthKit.h")
#import "RCTAppleHealthKit.h"
#elif __has_include(<RCTAppleHealthKit/RCTAppleHealthKit.h>)
#import <RCTAppleHealthKit/RCTAppleHealthKit.h>
#endif

// Background fetch
#import <TSBackgroundFetch/TSBackgroundFetch.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"TharunHealthTrackerMobile";
  
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  BOOL didFinish = [super application:application didFinishLaunchingWithOptions:launchOptions];

  // Initialize background fetch
  [[TSBackgroundFetch sharedInstance] didFinishLaunching];

  // Initialize HealthKit background observers for real-time update events.
  Class healthKitClass = NSClassFromString(@"RCTAppleHealthKit");
  if (healthKitClass != Nil && self.bridge != nil) {
    id healthKitModule = [healthKitClass new];
    SEL selector = NSSelectorFromString(@"initializeBackgroundObservers:");
    if ([healthKitModule respondsToSelector:selector]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      [healthKitModule performSelector:selector withObject:self.bridge];
#pragma clang diagnostic pop
    }
  }

  return didFinish;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// Required for background fetch
- (void)application:(UIApplication *)application performFetchWithCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{
  [[TSBackgroundFetch sharedInstance] performFetchWithCompletionHandler:completionHandler applicationState:application.applicationState];
}

// Required for HealthKit background delivery
- (void)applicationDidBecomeActive:(UIApplication *)application
{
  // HealthKit background delivery handling if needed
}

// Handle deep linking
- (BOOL)application:(UIApplication *)application
   openURL:(NSURL *)url
   options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

// Handle universal links
- (BOOL)application:(UIApplication *)application
  continueUserActivity:(NSUserActivity *)userActivity
  restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> *restorableObjects))restorationHandler
{
  return [RCTLinkingManager application:application
                   continueUserActivity:userActivity
                     restorationHandler:restorationHandler];
}

@end
