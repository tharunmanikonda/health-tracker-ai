//
//  HealthKitBridge.m
//  TharunHealthTrackerMobile
//
//  HealthKit native bridge for React Native
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <HealthKit/HealthKit.h>

@interface HealthKitBridge : RCTEventEmitter <RCTBridgeModule>
@property (nonatomic, strong) HKHealthStore *healthStore;
@end

@implementation HealthKitBridge

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    if ([HKHealthStore isHealthDataAvailable]) {
      _healthStore = [[HKHealthStore alloc] init];
    }
  }
  return self;
}

// Check if HealthKit is available
RCT_EXPORT_METHOD(isAvailable:(RCTResponseSenderBlock)callback)
{
  BOOL available = [HKHealthStore isHealthDataAvailable];
  callback(@[[NSNull null], @(available)]);
}

// Request authorization for HealthKit
RCT_EXPORT_METHOD(requestAuthorization:(NSDictionary *)permissions
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!self.healthStore) {
    reject(@"HEALTHKIT_ERROR", @"HealthKit not available", nil);
    return;
  }
  
  NSMutableSet *readTypes = [NSMutableSet set];
  
  // Add quantity types
  NSArray *readPermissions = permissions[@"read"];
  for (NSString *permission in readPermissions) {
    HKQuantityType *type = [self quantityTypeFromString:permission];
    if (type) {
      [readTypes addObject:type];
    }
  }
  
  // Add workout type
  [readTypes addObject:[HKObjectType workoutType]];
  
  // Add sleep type
  if (@available(iOS 16.0, *)) {
    [readTypes addObject:[HKCategoryType categoryTypeForIdentifier:HKCategoryTypeIdentifierSleepAnalysis]];
  } else {
    [readTypes addObject:[HKCategoryType categoryTypeForIdentifier:HKCategoryTypeIdentifierSleepAnalysis]];
  }
  
  [self.healthStore requestAuthorizationToShareTypes:nil readTypes:readTypes completion:^(BOOL success, NSError *error) {
    if (error) {
      reject(@"HEALTHKIT_ERROR", error.localizedDescription, error);
    } else {
      resolve(@(success));
    }
  }];
}

// Get quantity samples
RCT_EXPORT_METHOD(getQuantitySamples:(NSString *)typeIdentifier
                  unit:(NSString *)unitString
                  startDate:(NSString *)startDateString
                  endDate:(NSString *)endDateString
                  limit:(NSInteger)limit
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!self.healthStore) {
    reject(@"HEALTHKIT_ERROR", @"HealthKit not available", nil);
    return;
  }
  
  HKQuantityType *quantityType = [self quantityTypeFromString:typeIdentifier];
  if (!quantityType) {
    reject(@"HEALTHKIT_ERROR", @"Invalid quantity type", nil);
    return;
  }
  
  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSSZ";
  NSDate *startDate = [formatter dateFromString:startDateString];
  NSDate *endDate = [formatter dateFromString:endDateString];
  
  if (!startDate || !endDate) {
    reject(@"HEALTHKIT_ERROR", @"Invalid date format", nil);
    return;
  }
  
  NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:startDate endDate:endDate options:HKQueryOptionStrictStartDate];
  
  NSSortDescriptor *sortDescriptor = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierEndDate ascending:NO];
  
  HKSampleQuery *query = [[HKSampleQuery alloc] initWithSampleType:quantityType
                                                         predicate:predicate
                                                             limit:limit
                                                   sortDescriptors:@[sortDescriptor]
                                                    resultsHandler:^(HKSampleQuery *query, NSArray<__kindof HKSample *> *results, NSError *error) {
    if (error) {
      reject(@"HEALTHKIT_ERROR", error.localizedDescription, error);
      return;
    }
    
    NSMutableArray *samples = [NSMutableArray array];
    HKUnit *unit = [self unitFromString:unitString];
    
    for (HKQuantitySample *sample in results) {
      double value = [sample.quantity doubleValueForUnit:unit];
      NSDictionary *sampleDict = @{
        @"value": @(value),
        @"startDate": [formatter stringFromDate:sample.startDate],
        @"endDate": [formatter stringFromDate:sample.endDate],
        @"uuid": sample.UUID.UUIDString,
        @"source": sample.sourceRevision.source.name
      };
      [samples addObject:sampleDict];
    }
    
    resolve(samples);
  }];
  
  [self.healthStore executeQuery:query];
}

// Get workouts
RCT_EXPORT_METHOD(getWorkouts:(NSString *)startDateString
                  endDate:(NSString *)endDateString
                  limit:(NSInteger)limit
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!self.healthStore) {
    reject(@"HEALTHKIT_ERROR", @"HealthKit not available", nil);
    return;
  }
  
  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSSZ";
  NSDate *startDate = [formatter dateFromString:startDateString];
  NSDate *endDate = [formatter dateFromString:endDateString];
  
  NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:startDate endDate:endDate options:HKQueryOptionStrictStartDate];
  
  HKSampleQuery *query = [[HKSampleQuery alloc] initWithSampleType:[HKObjectType workoutType]
                                                         predicate:predicate
                                                             limit:limit
                                                   sortDescriptors:@[[NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierEndDate ascending:NO]]
                                                    resultsHandler:^(HKSampleQuery *query, NSArray<__kindof HKSample *> *results, NSError *error) {
    if (error) {
      reject(@"HEALTHKIT_ERROR", error.localizedDescription, error);
      return;
    }
    
    NSMutableArray *workouts = [NSMutableArray array];
    
    for (HKWorkout *workout in results) {
      NSMutableDictionary *workoutDict = [@{
        @"uuid": workout.UUID.UUIDString,
        @"startDate": [formatter stringFromDate:workout.startDate],
        @"endDate": [formatter stringFromDate:workout.endDate],
        @"duration": @(workout.duration),
        @"type": [self workoutTypeName:workout.workoutActivityType],
        @"source": workout.sourceRevision.source.name
      } mutableCopy];
      
      if (workout.totalEnergyBurned) {
        workoutDict[@"calories"] = @([workout.totalEnergyBurned doubleValueForUnit:[HKUnit kilocalorieUnit]]);
      }
      
      if (workout.totalDistance) {
        workoutDict[@"distance"] = @([workout.totalDistance doubleValueForUnit:[HKUnit meterUnit]]);
      }
      
      [workouts addObject:workoutDict];
    }
    
    resolve(workouts);
  }];
  
  [self.healthStore executeQuery:query];
}

// Enable background delivery
RCT_EXPORT_METHOD(enableBackgroundDelivery:(NSString *)typeIdentifier
                  frequency:(NSInteger)frequency
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!self.healthStore) {
    reject(@"HEALTHKIT_ERROR", @"HealthKit not available", nil);
    return;
  }
  
  HKQuantityType *quantityType = [self quantityTypeFromString:typeIdentifier];
  if (!quantityType) {
    reject(@"HEALTHKIT_ERROR", @"Invalid quantity type", nil);
    return;
  }
  
  [self.healthStore enableBackgroundDeliveryForType:quantityType
                                         frequency:frequency
                                      withCompletion:^(BOOL success, NSError *error) {
    if (error) {
      reject(@"HEALTHKIT_ERROR", error.localizedDescription, error);
    } else {
      resolve(@(success));
    }
  }];
}

// Helper: Convert string to quantity type
- (HKQuantityType *)quantityTypeFromString:(NSString *)typeString
{
  static NSDictionary *typeMapping;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    typeMapping = @{
      @"StepCount": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierStepCount],
      @"DistanceWalkingRunning": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierDistanceWalkingRunning],
      @"DistanceCycling": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierDistanceCycling],
      @"HeartRate": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierHeartRate],
      @"RestingHeartRate": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierRestingHeartRate],
      @"HeartRateVariabilitySDNN": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierHeartRateVariabilitySDNN],
      @"ActiveEnergyBurned": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierActiveEnergyBurned],
      @"BasalEnergyBurned": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBasalEnergyBurned],
      @"FlightsClimbed": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierFlightsClimbed],
      @"OxygenSaturation": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierOxygenSaturation],
      @"RespiratoryRate": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierRespiratoryRate],
      @"BodyTemperature": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBodyTemperature],
      @"BloodPressureSystolic": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodPressureSystolic],
      @"BloodPressureDiastolic": [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodPressureDiastolic],
    };
  });
  
  return typeMapping[typeString];
}

// Helper: Convert string to unit
- (HKUnit *)unitFromString:(NSString *)unitString
{
  static NSDictionary *unitMapping;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    unitMapping = @{
      @"count": [HKUnit countUnit],
      @"count/min": [[HKUnit countUnit] unitDividedByUnit:[HKUnit minuteUnit]],
      @"ms": [HKUnit secondUnitWithMetricPrefix:HKMetricPrefixMilli],
      @"kcal": [HKUnit kilocalorieUnit],
      @"m": [HKUnit meterUnit],
      @"km": [HKUnit meterUnitWithMetricPrefix:HKMetricPrefixKilo],
      @"degC": [HKUnit degreeCelsiusUnit],
      @"%": [HKUnit percentUnit],
      @"mmHg": [HKUnit millimeterOfMercuryUnit],
    };
  });
  
  return unitMapping[unitString] ?: [HKUnit countUnit];
}

// Helper: Workout type name
- (NSString *)workoutTypeName:(HKWorkoutActivityType)type
{
  switch (type) {
    case HKWorkoutActivityTypeRunning: return @"Running";
    case HKWorkoutActivityTypeCycling: return @"Cycling";
    case HKWorkoutActivityTypeWalking: return @"Walking";
    case HKWorkoutActivityTypeSwimming: return @"Swimming";
    case HKWorkoutActivityTypeYoga: return @"Yoga";
    case HKWorkoutActivityTypeHighIntensityIntervalTraining: return @"HIIT";
    case HKWorkoutActivityTypeFunctionalStrengthTraining: return @"Functional Strength";
    case HKWorkoutActivityTypeTraditionalStrengthTraining: return @"Weight Training";
    case HKWorkoutActivityTypeCrossTraining: return @"Cross Training";
    case HKWorkoutActivityTypeElliptical: return @"Elliptical";
    case HKWorkoutActivityTypeRowing: return @"Rowing";
    case HKWorkoutActivityTypeStairClimbing: return @"Stair Climbing";
    case HKWorkoutActivityTypeHiking: return @"Hiking";
    default: return @"Other";
  }
}

@end