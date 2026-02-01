package com.tharunhealthtrackermobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.permission.HealthPermission;
import androidx.health.connect.client.records.*;
import androidx.health.connect.client.request.AggregateGroupByDurationRequest;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.records.metadata.DataOrigin;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlinx.coroutines.*;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;

public class HealthConnectModule extends ReactContextBaseJavaModule {

    private static HealthConnectClient healthConnectClient;
    private static final int REQUEST_CODE = 1001;
    private static Promise permissionPromise;
    
    // Permission sets for different data types
    private static final Set<HealthPermission> ALL_PERMISSIONS = new HashSet<>(Arrays.asList(
        new HealthPermission(StepsRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(DistanceRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(HeartRateRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(RestingHeartRateRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(HeartRateVariabilityRmssdRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(ActiveCaloriesBurnedRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(BasalMetabolicRateRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(SleepSessionRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(ExerciseSessionRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(FloorsClimbedRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(OxygenSaturationRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(RespiratoryRateRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(BodyTemperatureRecord.class, HealthPermission.PERMISSION_READ),
        new HealthPermission(BloodPressureRecord.class, HealthPermission.PERMISSION_READ)
    ));

    public HealthConnectModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "HealthConnect";
    }

    // Check if Health Connect is available
    @ReactMethod
    public void isAvailable(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                promise.resolve(false);
                return;
            }
            
            HealthConnectClient client = HealthConnectClient.getOrCreate(getReactApplicationContext());
            promise.resolve(client != null);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    // Initialize Health Connect
    @ReactMethod
    public void initialize(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                promise.resolve(false);
                return;
            }
            
            healthConnectClient = HealthConnectClient.getOrCreate(getReactApplicationContext());
            promise.resolve(healthConnectClient != null);
        } catch (Exception e) {
            promise.reject("INIT_ERROR", e.getMessage());
        }
    }

    // Request permissions
    @ReactMethod
    public void requestPermission(ReadableArray permissions, Promise promise) {
        if (healthConnectClient == null) {
            promise.reject("NOT_INITIALIZED", "Health Connect not initialized");
            return;
        }

        permissionPromise = promise;
        
        Set<HealthPermission> permSet = parsePermissions(permissions);
        
        Intent intent = PermissionController.createRequestPermissionResultContract().createIntent(
            getReactApplicationContext(),
            permSet
        );
        
        getCurrentActivity().startActivityForResult(intent, REQUEST_CODE);
    }

    // Check permissions
    @ReactMethod
    public void checkPermissions(ReadableArray permissions, Promise promise) {
        if (healthConnectClient == null) {
            promise.reject("NOT_INITIALIZED", "Health Connect not initialized");
            return;
        }

        CoroutineScope scope = CoroutineScope(Dispatchers.Default);
        scope.launch(Dispatchers.Main, () -> {
            try {
                Set<HealthPermission> permSet = parsePermissions(permissions);
                Set<HealthPermission> granted = healthConnectClient.getGrantedPermissions();
                
                WritableMap result = Arguments.createMap();
                for (HealthPermission perm : permSet) {
                    result.putBoolean(perm.getRecordType().getSimpleName(), granted.contains(perm));
                }
                promise.resolve(result);
            } catch (Exception e) {
                promise.reject("CHECK_ERROR", e.getMessage());
            }
        });
    }

    // Read records
    @ReactMethod
    public void readRecords(String recordType, ReadableMap options, Promise promise) {
        if (healthConnectClient == null) {
            promise.reject("NOT_INITIALIZED", "Health Connect not initialized");
            return;
        }

        CoroutineScope scope = CoroutineScope(Dispatchers.Default);
        scope.launch(Dispatchers.Main, () -> {
            try {
                String startTimeStr = options.getString("startTime");
                String endTimeStr = options.getString("endTime");
                int limit = options.hasKey("limit") ? options.getInt("limit") : 100;
                
                Instant startTime = Instant.parse(startTimeStr);
                Instant endTime = Instant.parse(endTimeStr);
                
                TimeRangeFilter timeRangeFilter = TimeRangeFilter.between(startTime, endTime);
                
                WritableArray results = Arguments.createArray();
                
                switch (recordType) {
                    case "Steps":
                        results = readSteps(timeRangeFilter, limit);
                        break;
                    case "HeartRate":
                        results = readHeartRate(timeRangeFilter, limit);
                        break;
                    case "ActiveCaloriesBurned":
                        results = readActiveCalories(timeRangeFilter, limit);
                        break;
                    case "SleepSession":
                        results = readSleepSessions(timeRangeFilter, limit);
                        break;
                    case "ExerciseSession":
                        results = readExerciseSessions(timeRangeFilter, limit);
                        break;
                    case "Distance":
                        results = readDistance(timeRangeFilter, limit);
                        break;
                    default:
                        promise.reject("UNKNOWN_TYPE", "Unknown record type: " + recordType);
                        return;
                }
                
                WritableMap result = Arguments.createMap();
                result.putArray("records", results);
                promise.resolve(result);
                
            } catch (Exception e) {
                promise.reject("READ_ERROR", e.getMessage());
            }
        });
    }

    // Read steps records
    private WritableArray readSteps(TimeRangeFilter timeRange, int limit) throws Exception {
        ReadRecordsRequest<StepsRecord> request = new ReadRecordsRequest<>(
            StepsRecord.class,
            timeRange,
            null,
            limit,
            null
        );
        
        ReadRecordsResponse<StepsRecord> response = healthConnectClient.readRecords(request);
        WritableArray results = Arguments.createArray();
        
        for (StepsRecord record : response.getRecords()) {
            WritableMap map = Arguments.createMap();
            map.putString("startTime", record.getStartTime().toString());
            map.putString("endTime", record.getEndTime().toString());
            map.putDouble("count", record.getCount());
            map.putString("dataOrigin", record.getMetadata().getDataOrigin().getPackageName());
            results.pushMap(map);
        }
        
        return results;
    }

    // Read heart rate records
    private WritableArray readHeartRate(TimeRangeFilter timeRange, int limit) throws Exception {
        ReadRecordsRequest<HeartRateRecord> request = new ReadRecordsRequest<>(
            HeartRateRecord.class,
            timeRange,
            null,
            limit,
            null
        );
        
        ReadRecordsResponse<HeartRateRecord> response = healthConnectClient.readRecords(request);
        WritableArray results = Arguments.createArray();
        
        for (HeartRateRecord record : response.getRecords()) {
            WritableMap map = Arguments.createMap();
            map.putString("startTime", record.getStartTime().toString());
            map.putString("endTime", record.getEndTime().toString());
            
            WritableArray samples = Arguments.createArray();
            for (HeartRateRecord.Sample sample : record.getSamples()) {
                WritableMap sampleMap = Arguments.createMap();
                sampleMap.putString("time", sample.getTime().toString());
                sampleMap.putDouble("beatsPerMinute", sample.getBeatsPerMinute());
                samples.pushMap(sampleMap);
            }
            map.putArray("samples", samples);
            results.pushMap(map);
        }
        
        return results;
    }

    // Read active calories
    private WritableArray readActiveCalories(TimeRangeFilter timeRange, int limit) throws Exception {
        ReadRecordsRequest<ActiveCaloriesBurnedRecord> request = new ReadRecordsRequest<>(
            ActiveCaloriesBurnedRecord.class,
            timeRange,
            null,
            limit,
            null
        );
        
        ReadRecordsResponse<ActiveCaloriesBurnedRecord> response = healthConnectClient.readRecords(request);
        WritableArray results = Arguments.createArray();
        
        for (ActiveCaloriesBurnedRecord record : response.getRecords()) {
            WritableMap map = Arguments.createMap();
            map.putString("startTime", record.getStartTime().toString());
            map.putString("endTime", record.getEndTime().toString());
            map.putDouble("energy", record.getEnergy().getKilocalories());
            results.pushMap(map);
        }
        
        return results;
    }

    // Read sleep sessions
    private WritableArray readSleepSessions(TimeRangeFilter timeRange, int limit) throws Exception {
        ReadRecordsRequest<SleepSessionRecord> request = new ReadRecordsRequest<>(
            SleepSessionRecord.class,
            timeRange,
            null,
            limit,
            null
        );
        
        ReadRecordsResponse<SleepSessionRecord> response = healthConnectClient.readRecords(request);
        WritableArray results = Arguments.createArray();
        
        for (SleepSessionRecord record : response.getRecords()) {
            WritableMap map = Arguments.createMap();
            map.putString("startTime", record.getStartTime().toString());
            map.putString("endTime", record.getEndTime().toString());
            map.putString("title", record.getTitle() != null ? record.getTitle() : "");
            map.putString("notes", record.getNotes() != null ? record.getNotes() : "");
            results.pushMap(map);
        }
        
        return results;
    }

    // Read exercise sessions
    private WritableArray readExerciseSessions(TimeRangeFilter timeRange, int limit) throws Exception {
        ReadRecordsRequest<ExerciseSessionRecord> request = new ReadRecordsRequest<>(
            ExerciseSessionRecord.class,
            timeRange,
            null,
            limit,
            null
        );
        
        ReadRecordsResponse<ExerciseSessionRecord> response = healthConnectClient.readRecords(request);
        WritableArray results = Arguments.createArray();
        
        for (ExerciseSessionRecord record : response.getRecords()) {
            WritableMap map = Arguments.createMap();
            map.putString("startTime", record.getStartTime().toString());
            map.putString("endTime", record.getEndTime().toString());
            map.putString("exerciseType", String.valueOf(record.getExerciseType()));
            map.putString("title", record.getTitle() != null ? record.getTitle() : "");
            map.putString("notes", record.getNotes() != null ? record.getNotes() : "");
            if (record.getDuration() != null) {
                map.putDouble("duration", record.getDuration().getSeconds());
            }
            results.pushMap(map);
        }
        
        return results;
    }

    // Read distance records
    private WritableArray readDistance(TimeRangeFilter timeRange, int limit) throws Exception {
        ReadRecordsRequest<DistanceRecord> request = new ReadRecordsRequest<>(
            DistanceRecord.class,
            timeRange,
            null,
            limit,
            null
        );
        
        ReadRecordsResponse<DistanceRecord> response = healthConnectClient.readRecords(request);
        WritableArray results = Arguments.createArray();
        
        for (DistanceRecord record : response.getRecords()) {
            WritableMap map = Arguments.createMap();
            map.putString("startTime", record.getStartTime().toString());
            map.putString("endTime", record.getEndTime().toString());
            map.putDouble("distanceInMeters", record.getDistance().getMeters());
            results.pushMap(map);
        }
        
        return results;
    }

    // Parse permissions from React Native array
    private Set<HealthPermission> parsePermissions(ReadableArray permissions) {
        Set<HealthPermission> result = new HashSet<>();
        
        for (int i = 0; i < permissions.size(); i++) {
            ReadableMap perm = permissions.getMap(i);
            String accessType = perm.getString("accessType");
            String recordType = perm.getString("recordType");
            
            Class<? extends Record> recordClass = getRecordClass(recordType);
            if (recordClass != null) {
                int access = accessType.equals("write") ? 
                    HealthPermission.PERMISSION_WRITE : 
                    HealthPermission.PERMISSION_READ;
                result.add(new HealthPermission(recordClass, access));
            }
        }
        
        return result;
    }

    // Get record class from string
    private Class<? extends Record> getRecordClass(String recordType) {
        switch (recordType) {
            case "Steps": return StepsRecord.class;
            case "Distance": return DistanceRecord.class;
            case "HeartRate": return HeartRateRecord.class;
            case "RestingHeartRate": return RestingHeartRateRecord.class;
            case "HeartRateVariability": return HeartRateVariabilityRmssdRecord.class;
            case "ActiveCaloriesBurned": return ActiveCaloriesBurnedRecord.class;
            case "BasalMetabolicRate": return BasalMetabolicRateRecord.class;
            case "SleepSession": return SleepSessionRecord.class;
            case "ExerciseSession": return ExerciseSessionRecord.class;
            case "FloorsClimbed": return FloorsClimbedRecord.class;
            case "OxygenSaturation": return OxygenSaturationRecord.class;
            case "RespiratoryRate": return RespiratoryRateRecord.class;
            case "BodyTemperature": return BodyTemperatureRecord.class;
            case "BloodPressure": return BloodPressureRecord.class;
            default: return null;
        }
    }

    // Handle permission result
    public static void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_CODE && permissionPromise != null) {
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != 0) { // PERMISSION_GRANTED = 0
                    allGranted = false;
                    break;
                }
            }
            permissionPromise.resolve(allGranted);
            permissionPromise = null;
        }
    }
}