// Intentionally flawed. Do not copy this into a real project.
//
// Demonstrates what the rn-native-modules agent catches: legacy bridge APIs on a
// React Native version where the bridge no longer exists, threading mistakes,
// a promise that can never settle, and listeners that survive every reload.
package com.demo

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.Timer
import java.util.TimerTask

class DeviceInfoModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "DeviceInfo"

  companion object {
    var sharedContext: ReactApplicationContext? = null
  }

  init {
    sharedContext = reactContext
  }

  @ReactMethod
  fun readConfigFile(path: String): String {
    return File(path).readText()
  }

  @ReactMethod
  fun showBanner(message: String, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      return
    }

    Thread {
      activity.runOnUiThread {
        BannerView(activity).show(message)
      }
      promise.resolve(true)
    }.start()
  }

  @ReactMethod
  fun startPolling() {
    Timer().scheduleAtFixedRate(
      object : TimerTask() {
        override fun run() {
          reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onDeviceStateChange", Arguments.createMap())
        }
      },
      0, 500,
    )
  }
}
