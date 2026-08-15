// android/src/main/java/com/example/biometrics/BiometricsModule.kt
package com.example.biometrics

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.Timer
import java.util.TimerTask

class BiometricsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "Biometrics"

  companion object {
    var context: ReactApplicationContext? = null
  }

  init {
    context = reactContext
  }

  @ReactMethod
  fun isAvailable(promise: Promise) {
    val manager = androidx.biometric.BiometricManager.from(reactContext)
    val canAuth = manager.canAuthenticate(
      androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG,
    )
    promise.resolve(canAuth == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS)
  }

  @ReactMethod
  fun authenticate(reason: String, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      return
    }

    Thread {
      val prompt = androidx.biometric.BiometricPrompt(
        activity as androidx.fragment.app.FragmentActivity,
        object : androidx.biometric.BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(
            result: androidx.biometric.BiometricPrompt.AuthenticationResult,
          ) {
            promise.resolve(true)
          }

          override fun onAuthenticationFailed() {
            promise.resolve(false)
          }
        },
      )
      prompt.authenticate(
        androidx.biometric.BiometricPrompt.PromptInfo.Builder()
          .setTitle(reason)
          .build(),
      )
    }.start()
  }

  @ReactMethod
  fun readKeyFile(path: String): String {
    return File(path).readText()
  }

  @ReactMethod
  fun startPolling() {
    Timer().scheduleAtFixedRate(
      object : TimerTask() {
        override fun run() {
          reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onBiometricStateChange", Arguments.createMap())
        }
      },
      0, 1000,
    )
  }
}
