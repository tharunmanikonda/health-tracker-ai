package com.tharunhealthtrackermobile;

import android.os.Build;
import android.os.Bundle;
import android.content.Intent;
import androidx.core.app.ActivityCompat;
import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;

public class MainActivity extends ReactActivity {

  private static final int PERMISSION_REQUEST_CODE = 1001;

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  @Override
  protected String getMainComponentName() {
    return "TharunHealthTrackerMobile";
  }

  /**
   * Returns the instance of the {@link ReactActivityDelegate}. Here we use a util class {@link
   * DefaultReactActivityDelegate} which allows you to easily enable Fabric and Concurrent React
   * (aka React 18) with two boolean flags.
   */
  @Override
  protected ReactActivityDelegate createReactActivityDelegate() {
    return new DefaultReactActivityDelegate(
        this,
        getMainComponentName(),
        DefaultNewArchitectureEntryPoint.getFabricEnabled());
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    
    // Handle Health Connect permission result
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      handleHealthConnectIntent(getIntent());
    }
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      handleHealthConnectIntent(intent);
    }
  }

  private void handleHealthConnectIntent(Intent intent) {
    if (intent != null && intent.getAction() != null) {
      if (intent.getAction().equals("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE")) {
        // Health Connect permission rationale requested
      }
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    
    // Forward to Health Connect module if needed
    if (requestCode == PERMISSION_REQUEST_CODE) {
      HealthConnectModule.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }
  }
}